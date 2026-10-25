//! Simulation engine: owns the plant model, the TCP link to the virtual MCU,
//! and the firmware supervisor. Runs lock-step at 1 kHz.
//!
//! Lock-step: each sim tick the engine sends TICK (input snapshot), the
//! firmware runs one tick and replies TICK_DONE (output latches). If the
//! firmware stops answering (busy loop, crash, debugger), the MCU is treated
//! as hung: its outputs freeze while the world keeps running - exactly what
//! happens on real hardware - and the watchdog, if started, resets it.
//! With "debug freeze" on, the world instead pauses while the MCU is halted
//! (like DBGMCU freezing timers under a debugger).

use crate::model::{CanLogEntry, Faults, PdmChannel, World, SCOPE_SIGNALS};
use crate::protocol::*;
use crate::script::{self, Action};
use crate::supervisor::Supervisor;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::time::{Duration, Instant};

pub const RESET_POWER_ON: u8 = 0;
pub const RESET_WATCHDOG: u8 = 1;
pub const RESET_SOFTWARE: u8 = 2;

const STALL_AFTER: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    Button { idx: usize, pressed: bool },
    Vehicle {
        ignition: Option<bool>,
        park: Option<bool>,
        engine: Option<bool>,
        ambient_light: Option<f64>,
        ambient_temp: Option<f64>,
        soc: Option<f64>,
    },
    Fault { kind: String, channel: Option<usize>, on: bool },
    ClearFaults,
    Speed { speed: f64 },
    Pause { paused: bool },
    Step { ms: u64 },
    DebugFreeze { on: bool },
    UartSend { text: String },
    ResetMcu,
    ResetWorld,
    StartFirmware { path: String },
    StopFirmware,
    /// Play a scenario script (same format as the headless SIL tests) live.
    RunScript { name: String, source: String },
    StopScript,
}

/// A scenario being played back against the live bench.
struct LiveScript {
    name: String,
    t0: u64,
    steps: Vec<script::Step>,
    idx: usize,
    releases: Vec<(u64, usize)>,
    uart_from: usize,
    passed: usize,
    failed: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct FwStatus {
    pub state: &'static str, // disconnected | running | stalled
    pub name: String,
    pub supervised: bool,
    pub exe: Option<String>,
    pub pid: Option<u32>,
    pub resets: u32,
    pub last_reset: &'static str,
    pub wdt_ms: Option<u32>,
    pub wdt_left: Option<i64>,
    pub mcu_ms: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub t_ms: u64,
    pub speed: f64,
    pub paused: bool,
    pub debug_freeze: bool,
    pub rt_factor: f64,
    pub fw: FwStatus,
    pub ignition: bool,
    pub park: bool,
    pub engine: bool,
    pub ambient_light: f64,
    pub ambient_temp: f64,
    pub vbat: f64,
    pub soc: f64,
    pub i_total: f64,
    pub buttons: [bool; 8],
    pub gpio_in: u32,
    pub gpio_out: u32,
    pub pwm: [(u32, u16); 4],
    pub adc: [u16; 4],
    pub encoder: i32,
    pub pdm: Vec<PdmChannel>,
    pub pdm_failsafe: bool,
    pub pdm_temp: f64,
    pub lb_alive: bool,
    pub lb_lit: u16,
    pub lb_intensity: u8,
    pub siren_freq: u32,
    pub siren_sounding: bool,
    pub beeper_freq: u32,
    pub scene_level: f64,
    pub rear_lit: bool,
    pub mdt_on: bool,
    pub arm_deg: f64,
    pub arm_current: f64,
    pub board_temp: f64,
    pub faults: Faults,
    pub bus_load: f64,
    pub frames_per_s: usize,
    pub can: Vec<CanLogEntry>,
    pub uart: String,
    pub console: Vec<String>,
    pub scope_names: [&'static str; 8],
    pub scope: Vec<[f32; 8]>,
}

struct Link {
    stream: TcpStream,
    reader: FrameReader,
    name: String,
    awaiting_done: bool,
    sent_at: Instant,
    stalled: bool,
    nonblocking: bool,
}

pub struct Sim {
    pub world: World,
    port: u16,
    incoming: Receiver<TcpStream>,
    link: Option<Link>,
    pub supervisor: Supervisor,
    pub speed: f64, // 0 = as fast as possible
    pub paused: bool,
    step_budget: u64,
    pub debug_freeze: bool,
    next_reset_reason: u8,
    resets: u32,
    last_reset: &'static str,
    // telemetry accumulators, drained by snapshot()
    uart_out: String,
    console: Vec<String>,
    scope: Vec<[f32; 8]>,
    uart_history: String,
    rt_factor: f64,
    live: Option<LiveScript>,
}

fn reset_name(r: u8) -> &'static str {
    match r {
        RESET_WATCHDOG => "watchdog",
        RESET_SOFTWARE => "software",
        _ => "power-on",
    }
}

impl Sim {
    /// Bind the MCU link listener on 127.0.0.1:port (0 = pick a free port).
    pub fn new(port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let port = listener.local_addr()?.port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                if tx.send(s).is_err() {
                    break;
                }
            }
        });
        Ok(Sim {
            world: World::new(),
            port,
            incoming: rx,
            link: None,
            supervisor: Supervisor::new(port),
            speed: 1.0,
            paused: false,
            step_budget: 0,
            debug_freeze: false,
            next_reset_reason: RESET_POWER_ON,
            resets: 0,
            last_reset: "power-on",
            uart_out: String::new(),
            console: Vec::new(),
            scope: Vec::new(),
            uart_history: String::new(),
            rt_factor: 0.0,
            live: None,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn connected(&self) -> bool {
        self.link.is_some()
    }

    pub fn resets_count(&self) -> u32 {
        self.resets
    }

    /// Everything the firmware has printed on its UART so far (for scripts).
    pub fn uart_history(&self) -> &str {
        &self.uart_history
    }

    fn note(&mut self, s: impl Into<String>) {
        let s = s.into();
        self.console.push(format!("[{:>8.3}s] {s}", self.world.t as f64 / 1000.0));
    }

    // ------------------------------------------------------------ commands --

    pub fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Button { idx, pressed } => self.world.set_button(idx, pressed),
            Command::Vehicle { ignition, park, engine, ambient_light, ambient_temp, soc } => {
                if let Some(v) = ignition {
                    self.world.set_ignition(v);
                }
                if let Some(v) = engine {
                    self.world.set_engine(v);
                }
                if let Some(v) = park {
                    self.world.park = v;
                }
                if let Some(v) = ambient_light {
                    self.world.ambient_light = v.clamp(0.0, 1.0);
                }
                if let Some(v) = ambient_temp {
                    self.world.ambient_temp = v.clamp(-40.0, 85.0);
                }
                if let Some(v) = soc {
                    self.world.soc = v.clamp(0.0, 1.0);
                }
            }
            Command::Fault { kind, channel, on } => {
                self.world.set_fault(&kind, channel, on);
            }
            Command::ClearFaults => self.world.clear_faults(),
            Command::Speed { speed } => self.speed = speed.clamp(0.0, 100.0),
            Command::Pause { paused } => {
                self.paused = paused;
                self.step_budget = 0;
            }
            Command::Step { ms } => {
                self.paused = true;
                self.step_budget += ms.min(60_000);
            }
            Command::DebugFreeze { on } => self.debug_freeze = on,
            Command::UartSend { text } => {
                self.world.mcu.uart_rx.extend(text.bytes());
                if !text.ends_with('\n') {
                    self.world.mcu.uart_rx.push_back(b'\n');
                }
            }
            Command::ResetMcu => self.reset_mcu(RESET_POWER_ON, "reset button"),
            Command::ResetWorld => {
                if let Some(ls) = self.live.as_mut() {
                    ls.t0 = 0; // keep a running scenario's clock consistent
                }
                self.world = World::new();
                self.reset_mcu(RESET_POWER_ON, "bench power-cycled");
            }
            Command::StartFirmware { path } => {
                self.drop_link();
                self.next_reset_reason = RESET_POWER_ON;
                match self.supervisor.start(&PathBuf::from(&path)) {
                    Ok(()) => self.note(format!("flashing {path}")),
                    Err(e) => self.note(format!("flash failed: {e}")),
                }
            }
            Command::StopFirmware => {
                self.supervisor.stop();
                self.drop_link();
            }
            Command::RunScript { name, source } => match script::parse(&source) {
                Ok(steps) => {
                    self.note(format!("scenario '{name}': started ({} steps)", steps.len()));
                    self.live = Some(LiveScript {
                        name,
                        t0: self.world.t,
                        steps,
                        idx: 0,
                        releases: Vec::new(),
                        uart_from: self.uart_history.len(),
                        passed: 0,
                        failed: 0,
                    });
                }
                Err(e) => self.note(format!("scenario '{name}': {e}")),
            },
            Command::StopScript => {
                if let Some(ls) = self.live.take() {
                    for (_, b) in ls.releases {
                        self.world.set_button(b, false);
                    }
                    self.note(format!("scenario '{}': stopped", ls.name));
                }
            }
        }
    }

    /// Execute any scenario steps that are due at the current sim time.
    fn run_live_script(&mut self) {
        let Some(mut ls) = self.live.take() else { return };
        let rel = self.world.t.saturating_sub(ls.t0);
        while ls.idx < ls.steps.len() && ls.steps[ls.idx].t <= rel {
            let action = ls.steps[ls.idx].action.clone();
            ls.idx += 1;
            match action {
                Action::Cmd(Command::RunScript { .. }) => {}
                Action::Cmd(c) => self.handle(c),
                Action::Press(b) => {
                    self.world.set_button(b, true);
                    ls.releases.push((rel + 150, b));
                }
                Action::Expect { field, op, value, line } => {
                    match script::field(self, &field).and_then(|got| script::compare(got, &op, value).map(|ok| (got, ok))) {
                        Some((got, true)) => {
                            ls.passed += 1;
                            self.note(format!("PASS line {line}: {field} {op} {value} (got {got:.2})"));
                        }
                        Some((got, false)) => {
                            ls.failed += 1;
                            self.note(format!("FAIL line {line}: expected {field} {op} {value}, got {got:.2}"));
                        }
                        None => {
                            ls.failed += 1;
                            self.note(format!("FAIL line {line}: cannot evaluate '{field} {op}'"));
                        }
                    }
                }
                Action::ExpectUart { text, present, line } => {
                    let hay = self.uart_history.get(ls.uart_from.min(self.uart_history.len())..).unwrap_or(&self.uart_history);
                    if hay.contains(text.as_str()) == present {
                        ls.passed += 1;
                        self.note(format!("PASS line {line}: UART {} \"{text}\"", if present { "shows" } else { "never shows" }));
                    } else {
                        ls.failed += 1;
                        self.note(format!("FAIL line {line}: UART {} \"{text}\"", if present { "missing" } else { "unexpectedly shows" }));
                    }
                }
            }
        }
        ls.releases.retain(|&(t, b)| {
            if t <= rel {
                self.world.set_button(b, false);
                false
            } else {
                true
            }
        });
        if ls.idx >= ls.steps.len() && ls.releases.is_empty() {
            let verdict = if ls.failed == 0 { "PASSED" } else { "FAILED" };
            self.note(format!("scenario '{}': {verdict} - {} passed, {} failed", ls.name, ls.passed, ls.failed));
        } else {
            self.live = Some(ls);
        }
    }

    // ---------------------------------------------------------------- link --

    fn drop_link(&mut self) {
        if self.link.take().is_some() {
            self.world.mcu.out = McuOutputs::default();
            self.world.mcu.wdt_timeout = None;
        }
    }

    /// Reset the virtual MCU. The firmware process exits on MSG_RESET and is
    /// relaunched (by the supervisor, or by itself when run manually).
    pub fn reset_mcu(&mut self, reason: u8, why: &str) {
        let hung = self.link.as_ref().map(|l| l.stalled).unwrap_or(false);
        if let Some(link) = self.link.as_mut() {
            let _ = write_msg(&mut link.stream, MSG_RESET, &[reason]);
            let _ = link.stream.flush();
        }
        self.drop_link();
        self.world.mcu_reset(reason);
        self.next_reset_reason = reason;
        self.resets += 1;
        self.last_reset = reset_name(reason);
        self.note(format!("MCU RESET ({}) - {why}", reset_name(reason)));
        if hung || (self.supervisor.running() && reason == RESET_POWER_ON) {
            self.supervisor.force_restart();
        }
    }

    fn accept_connections(&mut self) {
        loop {
            let stream = match self.incoming.try_recv() {
                Ok(s) => s,
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => return,
            };
            match self.handshake(stream) {
                Ok(link) => {
                    self.drop_link();
                    self.world.mcu_reset(self.next_reset_reason);
                    self.note(format!(
                        "MCU '{}' connected ({} boot)",
                        link.name,
                        reset_name(self.next_reset_reason)
                    ));
                    self.next_reset_reason = RESET_POWER_ON;
                    self.link = Some(link);
                }
                Err(e) => self.note(format!("rejected MCU connection: {e}")),
            }
        }
    }

    fn handshake(&self, mut stream: TcpStream) -> std::io::Result<Link> {
        stream.set_nodelay(true)?;
        stream.set_read_timeout(Some(Duration::from_millis(20)))?;
        let mut reader = FrameReader::default();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if !reader.fill(&mut stream)? {
                return Err(std::io::Error::other("closed during handshake"));
            }
            if let Some((kind, p)) = reader.next() {
                if let FwMsg::Hello { version, name } = decode(kind, &p)? {
                    if version != PROTO_VERSION {
                        return Err(std::io::Error::other(format!("protocol v{version} != v{PROTO_VERSION}")));
                    }
                    let mut w = PROTO_VERSION.to_le_bytes().to_vec();
                    w.push(self.next_reset_reason);
                    write_msg(&mut stream, MSG_WELCOME, &w)?;
                    stream.set_read_timeout(Some(Duration::from_millis(2)))?;
                    return Ok(Link {
                        stream,
                        reader,
                        name,
                        awaiting_done: false,
                        sent_at: Instant::now(),
                        stalled: false,
                        nonblocking: false,
                    });
                }
            }
            if Instant::now() > deadline {
                return Err(std::io::Error::other("no HELLO"));
            }
        }
    }

    /// Exchange messages with the MCU until TICK_DONE or `wait` elapses.
    /// Returns true if the tick completed.
    fn pump(&mut self, wait: Duration) -> bool {
        let deadline = Instant::now() + wait;
        loop {
            // drain everything already buffered
            loop {
                let next = match self.link.as_mut() {
                    Some(l) => l.reader.next(),
                    None => return false,
                };
                let Some((kind, payload)) = next else { break };
                let msg = match decode(kind, &payload) {
                    Ok(m) => m,
                    Err(e) => {
                        let e = e.to_string();
                        self.note(format!("protocol error: {e}"));
                        self.drop_link();
                        return false;
                    }
                };
                match msg {
                    FwMsg::CanTx(f) => self.world.can_from_mcu(f),
                    FwMsg::UartTx(bytes) => {
                        let s = String::from_utf8_lossy(&bytes);
                        self.uart_out.push_str(&s);
                        self.uart_history.push_str(&s);
                        if self.uart_history.len() > 1 << 20 {
                            let cut = self.uart_history.len() - (1 << 19);
                            let cut = (cut..self.uart_history.len())
                                .find(|&i| self.uart_history.is_char_boundary(i))
                                .unwrap_or(0);
                            self.uart_history.drain(..cut);
                        }
                    }
                    FwMsg::I2cXfer { addr, tx, rx_len } => {
                        let (st, data) = self.world.i2c(addr, &tx, rx_len as usize);
                        let mut p = vec![st];
                        p.extend_from_slice(&data);
                        let link = self.link.as_mut().unwrap();
                        if write_msg(&mut link.stream, MSG_I2C_RESULT, &p).is_err() {
                            self.drop_link();
                            return false;
                        }
                    }
                    FwMsg::Wdt { op, timeout_ms } => self.world.wdt_op(op, timeout_ms),
                    FwMsg::SysReset => {
                        self.reset_mcu(RESET_SOFTWARE, "firmware requested reset");
                        return false;
                    }
                    FwMsg::TickDone(out) => {
                        self.world.apply_outputs(out);
                        self.world.mcu.ms = self.world.mcu.ms.wrapping_add(1);
                        let link = self.link.as_mut().unwrap();
                        link.awaiting_done = false;
                        let was_stalled = std::mem::replace(&mut link.stalled, false);
                        if was_stalled {
                            self.note("MCU responding again");
                        }
                        return true;
                    }
                    FwMsg::Hello { .. } | FwMsg::Unknown(_) => {}
                }
            }
            let Some(link) = self.link.as_mut() else { return false };
            // Zero-wait polls must not block: Windows rounds socket read
            // timeouts up to its ~15.6 ms timer tick.
            let poll_only = Instant::now() >= deadline;
            if poll_only != link.nonblocking {
                let _ = link.stream.set_nonblocking(poll_only);
                link.nonblocking = poll_only;
            }
            match link.reader.fill(&mut link.stream) {
                Ok(true) => {}
                Ok(false) | Err(_) => {
                    let name = link.name.clone();
                    self.drop_link();
                    self.note(format!("MCU '{name}' disconnected"));
                    return false;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
        }
    }

    // ---------------------------------------------------------------- tick --

    /// Advance one millisecond. Returns false if the world did not advance
    /// (debug freeze while the MCU is halted).
    pub fn tick(&mut self) -> bool {
        self.run_live_script();
        if let Some(link) = self.link.as_mut() {
            if !link.awaiting_done {
                let inputs = self.world.tick_inputs();
                let link = self.link.as_mut().unwrap();
                if write_msg(&mut link.stream, MSG_TICK, &encode_tick(&inputs)).is_err() {
                    self.drop_link();
                    self.note("MCU disconnected");
                } else {
                    link.awaiting_done = true;
                    link.sent_at = Instant::now();
                }
            }
        }

        if let Some(link) = self.link.as_ref() {
            let wait = if self.debug_freeze {
                Duration::from_millis(20)
            } else if link.stalled {
                Duration::ZERO
            } else {
                STALL_AFTER.saturating_sub(link.sent_at.elapsed())
            };
            let done = self.pump(wait);
            if !done && self.link.is_some() {
                if self.debug_freeze {
                    return false; // world waits for the halted core
                }
                let link = self.link.as_mut().unwrap();
                let newly_stalled = !link.stalled && link.sent_at.elapsed() >= STALL_AFTER;
                if newly_stalled {
                    link.stalled = true;
                }
                let stalled = link.stalled;
                if newly_stalled {
                    self.note("MCU not answering - core hung? (outputs frozen)");
                }
                if stalled {
                    self.world.mcu.ms = self.world.mcu.ms.wrapping_add(1);
                }
            }
        }

        if self.link.is_some() && self.world.wdt_expired() {
            self.reset_mcu(RESET_WATCHDOG, "watchdog timeout");
        }

        self.world.step();
        let s = self.world.scope_sample();
        self.scope.push(s);
        true
    }

    /// Housekeeping that doesn't depend on time stepping.
    pub fn service(&mut self) {
        self.accept_connections();
        self.supervisor.poll();
        for l in self.supervisor.take_lines() {
            self.console.push(l);
        }
        let events = std::mem::take(&mut self.world.events);
        self.console.extend(events);
    }

    /// Drain accumulated telemetry into a snapshot for the UI.
    pub fn snapshot(&mut self) -> Snapshot {
        let w = &mut self.world;
        let wdt_left = w.mcu.wdt_timeout.map(|to| to as i64 - w.mcu.ms.wrapping_sub(w.mcu.wdt_last_kick) as i64);
        let fw = FwStatus {
            state: match &self.link {
                None => "disconnected",
                Some(l) if l.stalled => "stalled",
                Some(_) => "running",
            },
            name: self.link.as_ref().map(|l| l.name.clone()).unwrap_or_default(),
            supervised: self.supervisor.running(),
            exe: self.supervisor.exe().map(|p| p.display().to_string()),
            pid: self.supervisor.pid(),
            resets: self.resets,
            last_reset: self.last_reset,
            wdt_ms: w.mcu.wdt_timeout,
            wdt_left,
            mcu_ms: w.mcu.ms,
        };
        let mut buttons = [false; 8];
        for (i, b) in buttons.iter_mut().enumerate() {
            *b = w.button_pressed(i);
        }
        // Cap the per-snapshot payload when running much faster than real time.
        let mut scope = std::mem::take(&mut self.scope);
        if scope.len() > 2000 {
            scope.drain(..scope.len() - 2000);
        }
        let mut can = std::mem::take(&mut w.can_log);
        if can.len() > 400 {
            can.drain(..can.len() - 400);
        }
        Snapshot {
            t_ms: w.t,
            speed: self.speed,
            paused: self.paused,
            debug_freeze: self.debug_freeze,
            rt_factor: self.rt_factor,
            fw,
            ignition: w.ignition,
            park: w.park,
            engine: w.engine,
            ambient_light: w.ambient_light,
            ambient_temp: w.ambient_temp,
            vbat: w.vbat,
            soc: w.soc,
            i_total: w.i_total,
            buttons,
            gpio_in: w.mcu.last_inputs,
            gpio_out: w.mcu.out.gpio_out,
            pwm: w.mcu.out.pwm,
            adc: w.mcu.last_adc,
            encoder: w.encoder_count(),
            pdm: w.pdm.to_vec(),
            pdm_failsafe: w.pdm_failsafe,
            pdm_temp: w.pdm_temp,
            lb_alive: w.lb_alive,
            lb_lit: w.lb_lit,
            lb_intensity: w.lb_intensity,
            siren_freq: w.siren_freq,
            siren_sounding: w.siren_sounding,
            beeper_freq: w.beeper_freq,
            scene_level: w.scene_level,
            rear_lit: w.rear_lit,
            mdt_on: w.mdt_on,
            arm_deg: w.arm_deg,
            arm_current: w.arm_current,
            board_temp: w.board_temp,
            faults: w.faults.clone(),
            bus_load: w.bus_load,
            frames_per_s: w.frames_per_s,
            can,
            uart: std::mem::take(&mut self.uart_out),
            console: std::mem::take(&mut self.console),
            scope_names: SCOPE_SIGNALS,
            scope,
        }
    }

    // -------------------------------------------------------------- runner --

    /// Run the real-time loop on a background thread. `publish` is called at
    /// ~30 Hz with a fresh snapshot. Send commands through the returned handle.
    pub fn spawn<F>(mut self, mut publish: F) -> SimHandle
    where
        F: FnMut(Snapshot) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<Command>();
        let port = self.port;
        std::thread::Builder::new()
            .name("signalbench-sim".into())
            .spawn(move || {
                let mut anchor_wall = Instant::now();
                let mut anchor_sim = self.world.t;
                let mut last_pub = Instant::now();
                let mut rt_window = (Instant::now(), self.world.t);
                loop {
                    let mut reanchor = false;
                    loop {
                        match rx.try_recv() {
                            Ok(cmd) => {
                                reanchor |= matches!(
                                    cmd,
                                    Command::Speed { .. } | Command::Pause { .. } | Command::ResetWorld
                                );
                                if matches!(cmd, Command::ResetWorld) {
                                    rt_window = (Instant::now(), 0);
                                }
                                self.handle(cmd);
                            }
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => return,
                        }
                    }
                    self.service();
                    if reanchor {
                        anchor_wall = Instant::now();
                        anchor_sim = self.world.t;
                    }

                    let budget: u64 = if self.paused {
                        let n = self.step_budget.min(200);
                        self.step_budget -= n;
                        n
                    } else if self.speed == 0.0 {
                        200
                    } else {
                        let target = anchor_sim + (anchor_wall.elapsed().as_secs_f64() * 1000.0 * self.speed) as u64;
                        let behind = target.saturating_sub(self.world.t);
                        if behind > 250 {
                            // can't keep up (slow firmware or debugger): drop the backlog
                            anchor_wall = Instant::now();
                            anchor_sim = self.world.t;
                            50
                        } else {
                            behind.min(100)
                        }
                    };

                    let start = Instant::now();
                    for _ in 0..budget {
                        if !self.tick() || start.elapsed() > Duration::from_millis(30) {
                            break;
                        }
                    }

                    if last_pub.elapsed() >= Duration::from_millis(33) {
                        let dt = rt_window.0.elapsed().as_secs_f64();
                        if dt >= 0.5 {
                            self.rt_factor = self.world.t.saturating_sub(rt_window.1) as f64 / 1000.0 / dt;
                            rt_window = (Instant::now(), self.world.t);
                        }
                        publish(self.snapshot());
                        last_pub = Instant::now();
                    }
                    if budget == 0 {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            })
            .expect("spawn sim thread");
        SimHandle { tx, port }
    }
}

#[derive(Clone)]
pub struct SimHandle {
    tx: Sender<Command>,
    pub port: u16,
}

impl SimHandle {
    pub fn send(&self, cmd: Command) {
        let _ = self.tx.send(cmd);
    }
}
