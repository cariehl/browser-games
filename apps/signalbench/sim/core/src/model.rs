//! Plant model: everything outside the MCU, stepped at 1 kHz.
//!
//! Battery/alternator -> SB-PDM8 (8 eFuse outputs, CAN) -> loads:
//! SB-LB12 lightbar (CAN node), siren amp, LED scene light on a motorised
//! arm (DC gear-motor + encoder + limit switches), rear flashers, MDT.
//! Plus the control board's own I/O: keypad (bouncy), vehicle inputs,
//! ADC channels, TMP102 on I2C.
//!
//! Signal definitions must match firmware/sdk/include/{board.h,can_db.h}.

use crate::protocol::{CanFrame, McuOutputs, TickInputs};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const DT: f64 = 0.001;

pub const PDM_NAMES: [&str; 8] =
    ["Lightbar", "Siren amp", "Scene light", "Arm motor", "Rear flashers", "MDT / radio", "AUX 1", "AUX 2"];
pub const PDM_LIMIT_A: [f64; 8] = [15.0, 15.0, 10.0, 20.0, 8.0, 10.0, 10.0, 10.0];
pub const PDM_TRIP_MS: u64 = 250; // over limit this long -> trip
pub const PDM_SHORT_FACTOR: f64 = 3.0; // instant trip above limit x this
pub const PDM_CMD_TIMEOUT_MS: u64 = 500;
pub const LB_CMD_TIMEOUT_MS: u64 = 1000;

// CAN ids (can_db.h)
pub const ID_PDM_CMD: u32 = 0x100;
pub const ID_PDM_FAULT_CLEAR: u32 = 0x101;
pub const ID_PDM_STATUS_A: u32 = 0x180;
pub const ID_PDM_STATUS_B: u32 = 0x181;
pub const ID_PDM_STATUS_C: u32 = 0x182;
pub const ID_LB_CMD: u32 = 0x300;
pub const ID_LB_STATUS: u32 = 0x380;

// GPIO (board.h)
pub const PIN_IGNITION: u32 = 8;
pub const PIN_PARK: u32 = 9;
pub const PIN_LIM_STOWED: u32 = 10;
pub const PIN_LIM_DEPLOYED: u32 = 11;
pub const PIN_LED_HEARTBEAT: u32 = 16;
pub const PIN_ARM_DIR: u32 = 19;

pub const ARM_COUNTS_PER_DEG: f64 = 20.0;
pub const ARM_MAX_DEG: f64 = 95.0;
pub const I2C_TMP102: u8 = 0x48;

pub const SCOPE_SIGNALS: [&str; 8] = [
    "Vbat (V)",
    "Total current (A)",
    "Arm angle (deg)",
    "Arm motor (A)",
    "Siren (kHz)",
    "Lightbar heads lit",
    "Keypad 1 raw",
    "Heartbeat LED",
];

/// Small deterministic PRNG (xorshift64*) - no external crates needed.
#[derive(Clone)]
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo + 1)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Faults {
    pub short: [bool; 8],
    pub open: [bool; 8],
    pub encoder_dead: bool,
    pub arm_jam: bool,
    pub lim_stowed_stuck: bool,
    pub can_ctrl_off: bool,
    pub tmp102_missing: bool,
    pub lb_failed_heads: u16,
    pub alternator_fail: bool,
}

#[derive(Debug, Clone, Default)]
struct Bouncy {
    level: bool,
    raw: bool,
    until: u64,
}

impl Bouncy {
    fn set(&mut self, level: bool, t: u64, rng: &mut Rng, max_ms: u64) {
        if level != self.level {
            self.level = level;
            self.until = t + rng.range(2, max_ms);
        }
    }
    fn sample(&mut self, t: u64, rng: &mut Rng) -> bool {
        self.raw = if t < self.until { rng.unit() < 0.5 } else { self.level };
        self.raw
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PdmChannel {
    pub name: &'static str,
    pub limit: f64,
    pub duty_cmd: u8,
    pub duty_eff: u8,
    pub v_out: f64,
    pub current: f64,
    pub tripped: bool,
    pub open_load: bool,
    #[serde(skip)]
    over_since: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CanLogEntry {
    pub t: u64,
    pub src: &'static str,
    pub id: u32,
    pub dlc: u8,
    pub data: [u8; 8],
}

/// MCU-side state the simulator owns (timebase, latches, FIFOs, watchdog).
#[derive(Debug, Clone, Default)]
pub struct McuState {
    pub ms: u32,
    pub out: McuOutputs,
    pub enc_ref_deg: f64,
    pub enc_frozen: Option<i32>,
    pub wdt_timeout: Option<u32>,
    pub wdt_last_kick: u32,
    pub reset_reason: u8,
    pub rx: VecDeque<CanFrame>,
    pub uart_rx: VecDeque<u8>,
    pub last_inputs: u32,
    pub last_adc: [u16; 4],
}

pub struct World {
    pub t: u64,
    rng: Rng,
    // vehicle
    pub ignition: bool,
    pub park: bool,
    pub engine: bool,
    pub ambient_light: f64, // 0..1
    pub ambient_temp: f64,  // degC
    pub soc: f64,
    pub capacity_ah: f64,
    pub vbat: f64,
    pub i_total: f64,
    // control board inputs
    buttons: [Bouncy; 8],
    limits: [Bouncy; 2],
    // PDM
    pub pdm: [PdmChannel; 8],
    pub pdm_last_cmd: Option<u64>,
    pub pdm_failsafe: bool,
    pub pdm_temp: f64,
    pdm_counter: u8,
    // loads
    pub lb_alive: bool,
    pub lb_mask: u16,
    pub lb_intensity: u8,
    pub lb_lit: u16,
    lb_last_cmd: Option<u64>,
    pub lb_temp: f64,
    pub siren_freq: u32,
    pub siren_sounding: bool,
    pub beeper_freq: u32,
    pub scene_level: f64,
    pub rear_lit: bool,
    pub mdt_on: bool,
    pub arm_deg: f64,
    pub arm_omega: f64,
    pub arm_current: f64,
    pub board_temp: f64,
    tmp102_ptr: u8,
    tmp102_config: u16,
    // faults
    pub faults: Faults,
    // MCU-side
    pub mcu: McuState,
    // telemetry
    pub can_log: Vec<CanLogEntry>,
    pub events: Vec<String>,
    bus_bits: VecDeque<(u64, u32)>,
    pub bus_load: f64,
    pub frames_per_s: usize,
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

impl World {
    pub fn new() -> Self {
        let mut pdm: [PdmChannel; 8] = Default::default();
        for (i, ch) in pdm.iter_mut().enumerate() {
            ch.name = PDM_NAMES[i];
            ch.limit = PDM_LIMIT_A[i];
        }
        World {
            t: 0,
            rng: Rng::new(0x5B_C0FF_EE),
            ignition: false,
            park: true,
            engine: false,
            ambient_light: 0.8,
            ambient_temp: 25.0,
            soc: 0.95,
            capacity_ah: 4.0,
            vbat: 12.6,
            i_total: 0.0,
            buttons: Default::default(),
            // arm starts stowed, so the STOWED switch is already closed at power-on
            limits: [Bouncy { level: true, raw: true, until: 0 }, Bouncy::default()],
            pdm,
            pdm_last_cmd: None,
            pdm_failsafe: true,
            pdm_temp: 25.0,
            pdm_counter: 0,
            lb_alive: false,
            lb_mask: 0,
            lb_intensity: 255,
            lb_lit: 0,
            lb_last_cmd: None,
            lb_temp: 25.0,
            siren_freq: 0,
            siren_sounding: false,
            beeper_freq: 0,
            scene_level: 0.0,
            rear_lit: false,
            mdt_on: false,
            arm_deg: 0.0,
            arm_omega: 0.0,
            arm_current: 0.0,
            board_temp: 25.0,
            tmp102_ptr: 0,
            tmp102_config: 0x60A0,
            faults: Faults::default(),
            mcu: McuState::default(),
            can_log: Vec::new(),
            events: Vec::new(),
            bus_bits: VecDeque::new(),
            bus_load: 0.0,
            frames_per_s: 0,
        }
    }

    fn event(&mut self, msg: impl Into<String>) {
        self.events.push(format!("[{:>8.3}s] {}", self.t as f64 / 1000.0, msg.into()));
    }

    // ------------------------------------------------------------ operator --

    pub fn set_button(&mut self, idx: usize, pressed: bool) {
        if idx < 8 {
            let t = self.t;
            self.buttons[idx].set(pressed, t, &mut self.rng, 8);
        }
    }

    pub fn button_pressed(&self, idx: usize) -> bool {
        self.buttons.get(idx).map(|b| b.level).unwrap_or(false)
    }

    pub fn set_ignition(&mut self, on: bool) {
        self.ignition = on;
        if !on {
            self.engine = false;
        }
    }

    pub fn set_engine(&mut self, on: bool) {
        if on && !self.ignition {
            self.ignition = true;
        }
        self.engine = on;
    }

    // ---------------------------------------------------------------- MCU --

    /// MCU came out of reset: clear its latches and FIFOs.
    pub fn mcu_reset(&mut self, reason: u8) {
        self.mcu = McuState {
            enc_ref_deg: self.arm_deg,
            reset_reason: reason,
            ..Default::default()
        };
        if self.faults.encoder_dead {
            self.mcu.enc_frozen = Some(0);
        }
    }

    pub fn encoder_count(&self) -> i32 {
        if let Some(c) = self.mcu.enc_frozen {
            return c;
        }
        ((self.arm_deg - self.mcu.enc_ref_deg) * ARM_COUNTS_PER_DEG).round() as i32
    }

    fn adc(&mut self) -> [u16; 4] {
        let to_counts = |v: f64| ((v / 3.3) * 4095.0).round().clamp(0.0, 4095.0) as u16;
        let noise = (self.rng.unit() - 0.5) * 0.004;
        [
            to_counts(self.vbat / 6.0 + noise),
            to_counts(self.arm_current.abs() * 0.1),
            to_counts(self.ambient_light * 3.3),
            0,
        ]
    }

    /// Build the TICK for the MCU (drains its RX FIFOs).
    pub fn tick_inputs(&mut self) -> TickInputs {
        let t = self.t;
        let mut gpio = 0u32;
        for i in 0..8 {
            if self.buttons[i].sample(t, &mut self.rng) {
                gpio |= 1 << i;
            }
        }
        if self.ignition {
            gpio |= 1 << PIN_IGNITION;
        }
        if self.park {
            gpio |= 1 << PIN_PARK;
        }
        if self.limits[0].sample(t, &mut self.rng) {
            gpio |= 1 << PIN_LIM_STOWED;
        }
        if self.limits[1].sample(t, &mut self.rng) {
            gpio |= 1 << PIN_LIM_DEPLOYED;
        }
        let adc = self.adc();
        self.mcu.last_inputs = gpio;
        self.mcu.last_adc = adc;
        TickInputs {
            now_ms: self.mcu.ms,
            gpio_in: gpio,
            adc,
            encoder: self.encoder_count(),
            can_rx: self.mcu.rx.drain(..).collect(),
            uart_rx: self.mcu.uart_rx.drain(..).collect(),
        }
    }

    pub fn apply_outputs(&mut self, out: McuOutputs) {
        self.mcu.out = out;
    }

    /// Watchdog bookkeeping. Returns true if it just expired.
    pub fn wdt_op(&mut self, op: u8, timeout_ms: u32) {
        match op {
            0 if self.mcu.wdt_timeout.is_none() => {
                self.mcu.wdt_timeout = Some(timeout_ms.max(1));
                self.mcu.wdt_last_kick = self.mcu.ms;
            }
            1 => self.mcu.wdt_last_kick = self.mcu.ms,
            _ => {}
        }
    }

    pub fn wdt_expired(&self) -> bool {
        match self.mcu.wdt_timeout {
            Some(to) => self.mcu.ms.wrapping_sub(self.mcu.wdt_last_kick) > to,
            None => false,
        }
    }

    // ---------------------------------------------------------------- CAN --

    fn log_frame(&mut self, src: &'static str, f: &CanFrame) {
        self.can_log.push(CanLogEntry { t: self.t, src, id: f.id, dlc: f.dlc, data: f.data });
        let bits = ((47 + 8 * f.dlc as u32) as f64 * 1.15) as u32;
        self.bus_bits.push_back((self.t, bits));
    }

    /// A frame transmitted by the MCU.
    pub fn can_from_mcu(&mut self, f: CanFrame) {
        if self.faults.can_ctrl_off {
            return; // controller is off the bus: nobody hears it
        }
        self.log_frame("CTRL", &f);
        match f.id {
            ID_PDM_CMD => {
                for (i, ch) in self.pdm.iter_mut().enumerate() {
                    ch.duty_cmd = if i < f.dlc as usize { f.data[i] } else { 0 };
                }
                if self.pdm_failsafe && self.pdm_last_cmd.is_some() {
                    self.event("PDM: command received, leaving failsafe");
                }
                self.pdm_last_cmd = Some(self.t);
                self.pdm_failsafe = false;
            }
            ID_PDM_FAULT_CLEAR if f.dlc >= 1 => {
                let mask = f.data[0];
                for i in 0..8 {
                    if mask & (1 << i) != 0 && self.pdm[i].tripped {
                        self.pdm[i].tripped = false;
                        self.pdm[i].over_since = None;
                        let name = PDM_NAMES[i];
                        self.event(format!("PDM: ch{i} ({name}) trip cleared"));
                    }
                }
            }
            ID_LB_CMD if self.lb_alive && f.dlc >= 3 => {
                self.lb_mask = u16::from_le_bytes([f.data[0], f.data[1]]) & 0x0FFF;
                self.lb_intensity = f.data[2];
                self.lb_last_cmd = Some(self.t);
            }
            _ => {}
        }
    }

    fn node_tx(&mut self, src: &'static str, f: CanFrame) {
        self.log_frame(src, &f);
        if !self.faults.can_ctrl_off && self.mcu.rx.len() < 256 {
            self.mcu.rx.push_back(f);
        }
    }

    // ---------------------------------------------------------------- I2C --

    pub fn i2c(&mut self, addr: u8, tx: &[u8], rx_len: usize) -> (u8, Vec<u8>) {
        const OK: u8 = 0;
        const NACK: u8 = 2;
        if addr != I2C_TMP102 || self.faults.tmp102_missing {
            return (NACK, vec![]);
        }
        if let Some(&p) = tx.first() {
            self.tmp102_ptr = p & 0x03;
            if tx.len() >= 3 && self.tmp102_ptr == 1 {
                self.tmp102_config = u16::from_be_bytes([tx[1], tx[2]]);
            }
        }
        let word: u16 = match self.tmp102_ptr {
            0 => {
                let counts = (self.board_temp / 0.0625).round() as i32;
                ((counts.clamp(-2048, 2047) as i16 as u16) << 4) as u16
            }
            1 => self.tmp102_config,
            _ => 0,
        };
        let bytes = word.to_be_bytes();
        (OK, (0..rx_len).map(|i| if i < 2 { bytes[i] } else { 0 }).collect())
    }

    // --------------------------------------------------------------- step --

    pub fn step(&mut self) {
        self.t += 1;
        let t = self.t;

        // ---- battery / alternator (uses last step's load to avoid a loop)
        let charging = self.engine && !self.faults.alternator_fail;
        if charging {
            self.vbat = 14.2 - 0.004 * self.i_total;
            self.soc = (self.soc + 30.0 * DT / 3600.0 / self.capacity_ah).min(1.0);
        } else {
            let ocv = if self.soc > 0.0 { 11.75 + 0.95 * self.soc } else { 10.4 };
            self.vbat = (ocv - 0.025 * self.i_total).max(6.0);
            self.soc = (self.soc - self.i_total * DT / 3600.0 / self.capacity_ah).max(0.0);
        }
        let vbat = self.vbat;

        // ---- PDM output stage
        let failsafe = match self.pdm_last_cmd {
            None => true,
            Some(last) => t - last > PDM_CMD_TIMEOUT_MS,
        };
        if failsafe && !self.pdm_failsafe {
            self.event("PDM: no command for 500 ms -> FAILSAFE, all outputs off");
        }
        self.pdm_failsafe = failsafe;
        for i in 0..8 {
            let ch = &mut self.pdm[i];
            ch.duty_eff = if failsafe || ch.tripped { 0 } else { ch.duty_cmd };
            ch.v_out = if self.faults.open[i] { 0.0 } else { vbat * ch.duty_eff as f64 / 255.0 };
        }
        let vo: [f64; 8] = std::array::from_fn(|i| self.pdm[i].v_out);
        let v = |i: usize| vo[i];
        let scale = |volts: f64| (volts / 13.0).clamp(0.0, 1.2);

        // ---- lightbar (CAN node, needs >= 9 V average supply)
        let lb_v = v(0);
        let alive = lb_v >= 9.0;
        if alive && !self.lb_alive {
            self.lb_last_cmd = None;
            self.event("Lightbar: powered up");
        } else if !alive && self.lb_alive {
            self.event("Lightbar: power lost");
        }
        self.lb_alive = alive;
        let lb_cmd_fresh = matches!(self.lb_last_cmd, Some(c) if t - c <= LB_CMD_TIMEOUT_MS);
        self.lb_lit = if alive && lb_cmd_fresh { self.lb_mask & !self.faults.lb_failed_heads } else { 0 };
        let lb_i = if alive {
            0.25 + 0.45 * self.lb_lit.count_ones() as f64 * self.lb_intensity as f64 / 255.0 * scale(lb_v)
        } else {
            0.0
        };

        // ---- siren amp + keypad beeper
        let (sfreq, sduty) = self.mcu.out.pwm[1];
        let amp_on = v(1) >= 9.0;
        self.siren_freq = if sduty > 0 { sfreq } else { 0 };
        self.siren_sounding = amp_on && self.siren_freq > 0;
        let siren_i = if amp_on { 0.15 + if self.siren_sounding { 7.5 * scale(v(1)) } else { 0.0 } } else { 0.0 };
        let (bfreq, bduty) = self.mcu.out.pwm[2];
        self.beeper_freq = if bduty > 0 { bfreq } else { 0 };

        // ---- scene light, rear flashers, MDT
        self.scene_level = if v(2) > 6.0 { (v(2) / 13.0).min(1.0) } else { 0.0 };
        let scene_i = 7.0 * scale(v(2));
        self.rear_lit = v(4) > 8.0;
        let rear_i = if self.rear_lit { 3.6 * scale(v(4)) } else { 0.0 };
        self.mdt_on = v(5) > 9.5;
        let mdt_i = if self.mdt_on { 4.0 + 0.3 * self.rng.unit() } else { 0.0 };

        // ---- arm: DC gear-motor through the board's H-bridge, worm drive
        let arm_i = self.step_arm(v(3));

        // ---- per-channel currents + eFuse
        let mut loads = [lb_i, siren_i, scene_i, arm_i, rear_i, mdt_i, 0.0, 0.0];
        for i in 0..8 {
            if self.faults.short[i] && self.pdm[i].duty_eff > 0 {
                loads[i] = vbat / 0.05; // dead short through the harness
            }
            if self.faults.open[i] {
                loads[i] = 0.0;
            }
        }
        let mut trips = Vec::new();
        let mut total = 0.0;
        for i in 0..8 {
            let ch = &mut self.pdm[i];
            ch.current = loads[i];
            total += ch.current;
            if ch.tripped {
                continue;
            }
            if ch.current > ch.limit * PDM_SHORT_FACTOR {
                ch.tripped = true;
                trips.push((i, "SHORT CIRCUIT", ch.current));
            } else if ch.current > ch.limit {
                let since = *ch.over_since.get_or_insert(t);
                if t - since >= PDM_TRIP_MS {
                    ch.tripped = true;
                    trips.push((i, "OVERCURRENT", ch.current));
                }
            } else {
                ch.over_since = None;
            }
            ch.open_load = ch.duty_eff > 0 && ch.current < 0.05;
        }
        for (i, why, amps) in trips {
            self.pdm[i].current = 0.0;
            self.event(format!("PDM: ch{i} ({}) TRIPPED - {why} {amps:.1} A", PDM_NAMES[i]));
        }
        self.i_total = total;

        // ---- temperatures (first-order lags)
        let lag = |cur: f64, target: f64, tau_s: f64| cur + (target - cur) * DT / tau_s;
        self.pdm_temp = lag(self.pdm_temp, self.ambient_temp + 0.5 * total, 30.0);
        self.board_temp = lag(self.board_temp, self.ambient_temp + 0.8 * total, 20.0);
        self.lb_temp = lag(self.lb_temp, self.ambient_temp + 3.0 * lb_i, 25.0);

        // ---- limit switches (bounce on change)
        let stowed = self.arm_deg < 0.8 || self.faults.lim_stowed_stuck;
        let deployed = self.arm_deg > 89.2;
        self.limits[0].set(stowed, t, &mut self.rng, 4);
        self.limits[1].set(deployed, t, &mut self.rng, 4);

        // ---- periodic CAN from the PDM and lightbar
        if t % 20 == 0 {
            let cur = |i: usize| ((self.pdm[i].current * 100.0).round().clamp(0.0, 65535.0) as u16).to_le_bytes();
            let mut a = [0u8; 8];
            let mut b = [0u8; 8];
            for k in 0..4 {
                a[k * 2..k * 2 + 2].copy_from_slice(&cur(k));
                b[k * 2..k * 2 + 2].copy_from_slice(&cur(k + 4));
            }
            self.node_tx("PDM", CanFrame::new(ID_PDM_STATUS_A, &a));
            self.node_tx("PDM", CanFrame::new(ID_PDM_STATUS_B, &b));
        }
        if t % 100 == 10 {
            let mv = ((self.vbat * 1000.0).round() as u16).to_le_bytes();
            let tripped = self.pdm.iter().enumerate().fold(0u8, |m, (i, c)| m | ((c.tripped as u8) << i));
            let open = self.pdm.iter().enumerate().fold(0u8, |m, (i, c)| m | ((c.open_load as u8) << i));
            self.pdm_counter = self.pdm_counter.wrapping_add(1);
            let c = [
                mv[0],
                mv[1],
                tripped,
                open,
                self.pdm_temp.round().clamp(-128.0, 127.0) as i8 as u8,
                self.pdm_failsafe as u8,
                self.pdm_counter,
                0,
            ];
            self.node_tx("PDM", CanFrame::new(ID_PDM_STATUS_C, &c));
        }
        if self.lb_alive && t % 100 == 55 {
            let f = self.faults.lb_failed_heads.to_le_bytes();
            let temp = self.lb_temp.round().clamp(-128.0, 127.0) as i8 as u8;
            self.node_tx("LB", CanFrame::new(ID_LB_STATUS, &[0x12, f[0], f[1], temp]));
        }

        // ---- bus statistics (1 s window)
        while matches!(self.bus_bits.front(), Some(&(ft, _)) if t - ft >= 1000) {
            self.bus_bits.pop_front();
        }
        self.frames_per_s = self.bus_bits.len();
        self.bus_load = self.bus_bits.iter().map(|&(_, b)| b as f64).sum::<f64>() / 500_000.0;
    }

    fn step_arm(&mut self, supply: f64) -> f64 {
        const R: f64 = 0.5; // ohm
        const KE: f64 = 0.367; // V per deg/s (through the gearbox)
        const KT: f64 = 0.367;
        const B: f64 = 0.0245; // viscous friction
        const J: f64 = 0.02; // inertia
        const TG: f64 = 0.3; // gravity load at horizontal

        let (freq, duty) = self.mcu.out.pwm[0];
        let dir = if self.mcu.out.gpio_out & (1 << PIN_ARM_DIR) != 0 { 1.0 } else { -1.0 };
        let vm = if freq > 0 { supply * duty as f64 / 1000.0 * dir } else { 0.0 };

        if self.faults.arm_jam {
            self.arm_omega = 0.0;
            self.arm_current = vm / R;
            return self.arm_current.abs();
        }
        if vm.abs() < 0.3 {
            // worm gear is self-locking: unpowered arm holds position
            self.arm_omega = 0.0;
            self.arm_current = 0.0;
            return 0.0;
        }
        let tg = TG * self.arm_deg.to_radians().cos();
        let i = (vm - KE * self.arm_omega) / R;
        let torque = KT * i - B * self.arm_omega - tg;
        self.arm_omega += torque / J * DT;
        // self-locking: the load can never back-drive the motor
        if (vm > 0.0 && self.arm_omega < 0.0) || (vm < 0.0 && self.arm_omega > 0.0) {
            self.arm_omega = 0.0;
        }
        self.arm_deg += self.arm_omega * DT;
        if self.arm_deg <= 0.0 {
            self.arm_deg = 0.0;
            self.arm_omega = self.arm_omega.max(0.0);
        }
        if self.arm_deg >= ARM_MAX_DEG {
            self.arm_deg = ARM_MAX_DEG;
            self.arm_omega = self.arm_omega.min(0.0);
        }
        self.arm_current = (vm - KE * self.arm_omega) / R;
        self.arm_current.abs()
    }

    /// Apply / remove a fault. Returns a description for the event log.
    pub fn set_fault(&mut self, kind: &str, channel: Option<usize>, on: bool) -> Option<String> {
        let ch = channel.unwrap_or(0).min(7);
        let what = match kind {
            "short" => {
                self.faults.short[ch] = on;
                format!("short circuit on ch{ch} ({})", PDM_NAMES[ch])
            }
            "open" => {
                self.faults.open[ch] = on;
                format!("open wire on ch{ch} ({})", PDM_NAMES[ch])
            }
            "encoder" => {
                self.faults.encoder_dead = on;
                self.mcu.enc_frozen = if on { Some(self.encoder_count()) } else { None };
                if !on {
                    // a reconnected incremental encoder has lost position
                    self.mcu.enc_ref_deg = self.arm_deg;
                }
                "arm encoder disconnected".into()
            }
            "jam" => {
                self.faults.arm_jam = on;
                "arm mechanically jammed".into()
            }
            "lim_stuck" => {
                self.faults.lim_stowed_stuck = on;
                "STOWED limit switch stuck closed".into()
            }
            "can_ctrl" => {
                self.faults.can_ctrl_off = on;
                "control board disconnected from CAN".into()
            }
            "tmp102" => {
                self.faults.tmp102_missing = on;
                "TMP102 not responding on I2C".into()
            }
            "lb_head" => {
                let bit = 1u16 << ch.min(11);
                if on {
                    self.faults.lb_failed_heads |= bit;
                } else {
                    self.faults.lb_failed_heads &= !bit;
                }
                format!("lightbar head {} failed", channel.unwrap_or(0))
            }
            "alternator" => {
                self.faults.alternator_fail = on;
                "alternator failed (no charging)".into()
            }
            _ => return None,
        };
        let msg = format!("FAULT {}: {what}", if on { "INJECTED" } else { "removed" });
        self.event(msg.clone());
        Some(msg)
    }

    pub fn clear_faults(&mut self) {
        let enc = self.faults.encoder_dead;
        self.faults = Faults::default();
        if enc {
            self.mcu.enc_frozen = None;
            self.mcu.enc_ref_deg = self.arm_deg;
        }
        self.event("all injected faults removed");
    }

    /// 8 scope channels, matches SCOPE_SIGNALS.
    pub fn scope_sample(&self) -> [f32; 8] {
        [
            self.vbat as f32,
            self.i_total as f32,
            self.arm_deg as f32,
            self.arm_current.abs() as f32,
            self.siren_freq as f32 / 1000.0,
            self.lb_lit.count_ones() as f32,
            (self.mcu.last_inputs & 1) as f32,
            ((self.mcu.out.gpio_out >> PIN_LED_HEARTBEAT) & 1) as f32,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(w: &mut World, duties: [u8; 8]) {
        w.can_from_mcu(CanFrame::new(ID_PDM_CMD, &duties));
    }

    #[test]
    fn pdm_fails_safe_without_commands() {
        let mut w = World::new();
        cmd(&mut w, [0, 0, 255, 0, 0, 0, 0, 0]);
        for _ in 0..100 {
            w.step();
        }
        assert!(w.pdm[2].current > 5.0, "scene light should draw current");
        for _ in 0..600 {
            w.step();
        }
        assert!(w.pdm_failsafe);
        assert_eq!(w.pdm[2].current, 0.0);
    }

    #[test]
    fn short_trips_instantly_and_clears() {
        let mut w = World::new();
        w.set_fault("short", Some(4), true);
        cmd(&mut w, [0, 0, 0, 0, 255, 0, 0, 0]);
        w.step();
        assert!(w.pdm[4].tripped);
        w.set_fault("short", Some(4), false);
        w.can_from_mcu(CanFrame::new(ID_PDM_FAULT_CLEAR, &[0x10]));
        cmd(&mut w, [0, 0, 0, 0, 255, 0, 0, 0]);
        for _ in 0..5 {
            w.step(); // battery recovers from the short-circuit sag
        }
        assert!(!w.pdm[4].tripped);
        assert!(w.pdm[4].current > 1.0);
    }

    #[test]
    fn arm_deploys_then_stall_trips_efuse() {
        let mut w = World::new();
        w.apply_outputs(McuOutputs { gpio_out: 1 << PIN_ARM_DIR, pwm: [(20000, 900), (0, 0), (0, 0), (0, 0)] });
        let mut peak: f64 = 0.0;
        let mut reached_at = None;
        for k in 0..8000u64 {
            if k % 100 == 0 {
                cmd(&mut w, [0, 0, 0, 255, 0, 0, 0, 0]);
            }
            w.step();
            if w.arm_deg >= ARM_MAX_DEG - 0.01 {
                reached_at.get_or_insert(k);
                peak = peak.max(w.arm_current);
            }
        }
        // ~30 deg/s free-running: hard stop reached in a few seconds
        let t = reached_at.expect("arm never reached the hard stop");
        assert!((2500..5000).contains(&t), "travel took {t} ms");
        assert!(peak > 20.0, "stalled motor draws stall current ({peak:.1} A)");
        assert!(w.pdm[3].tripped, "eFuse must trip on a sustained stall");
    }

    #[test]
    fn tmp102_reads_and_nacks() {
        let mut w = World::new();
        let (st, d) = w.i2c(I2C_TMP102, &[0], 2);
        assert_eq!(st, 0);
        assert_eq!(u16::from_be_bytes([d[0], d[1]]) >> 4, (25.0f64 / 0.0625) as u16);
        w.set_fault("tmp102", None, true);
        assert_eq!(w.i2c(I2C_TMP102, &[0], 2).0, 2);
    }
}
