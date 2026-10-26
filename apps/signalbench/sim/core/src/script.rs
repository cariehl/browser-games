//! Scenario scripts for headless software-in-the-loop (SIL) tests.
//!
//! ```text
//! # time(ms)  action
//! @0      ignition on
//! @100    press arm                 # press + release after 150 ms
//! @6000   expect arm.angle > 88
//! @6000   expect uart "arm: deploying -> deployed"
//! @6500   fault short 2 on
//! @9000   expect pdm.2.tripped == 1
//! ```
//!
//! Actions: `ignition|park|engine on|off`, `press|hold|release <button>`,
//! `fault <kind> [channel] on|off`, `clear_faults`, `soc <0..1>`,
//! `ambient_light <0..1>`, `ambient_temp <C>`, `uart <text...>`,
//! `reset`, `expect <field> <op> <number>`, `expect uart "<text>"`,
//! `expect_not uart "<text>"`.

use crate::engine::{Command, Sim};
use std::time::{Duration, Instant};

const BUTTONS: [&str; 8] = ["lights", "siren", "horn", "scene", "arm", "takedown", "rear", "aux"];

#[derive(Debug, Clone)]
pub enum Action {
    Cmd(Command),
    Press(usize),
    Expect { field: String, op: String, value: f64, line: usize },
    ExpectUart { text: String, present: bool, line: usize },
}

#[derive(Debug, Clone)]
pub struct Step {
    pub t: u64,
    pub action: Action,
}

fn parse_button(s: &str) -> Result<usize, String> {
    if let Ok(n) = s.parse::<usize>() {
        if (1..=8).contains(&n) {
            return Ok(n - 1);
        }
    }
    BUTTONS.iter().position(|b| *b == s).ok_or_else(|| format!("unknown button '{s}'"))
}

fn on_off(s: Option<&&str>) -> Result<bool, String> {
    match s.copied() {
        Some("on") | Some("1") | Some("true") => Ok(true),
        Some("off") | Some("0") | Some("false") => Ok(false),
        other => Err(format!("expected on/off, got {other:?}")),
    }
}

fn quoted(rest: &str) -> String {
    rest.trim().trim_matches('"').to_string()
}

pub fn parse(src: &str) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    for (n, raw) in src.lines().enumerate() {
        let line_no = n + 1;
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let err = |m: String| format!("line {line_no}: {m}");
        let (time, rest) = line.split_once(char::is_whitespace).ok_or_else(|| err("missing action".into()))?;
        let t: u64 = time.trim_start_matches('@').parse().map_err(|_| err(format!("bad time '{time}'")))?;
        let rest = rest.trim();
        let words: Vec<&str> = rest.split_whitespace().collect();
        let veh = |f: &dyn Fn(bool) -> Command| on_off(words.get(1)).map(f).map(Action::Cmd);
        let action = match words[0] {
            "ignition" => veh(&|v| Command::Vehicle { ignition: Some(v), park: None, engine: None, ambient_light: None, ambient_temp: None, soc: None }),
            "park" => veh(&|v| Command::Vehicle { ignition: None, park: Some(v), engine: None, ambient_light: None, ambient_temp: None, soc: None }),
            "engine" => veh(&|v| Command::Vehicle { ignition: None, park: None, engine: Some(v), ambient_light: None, ambient_temp: None, soc: None }),
            "press" => parse_button(words.get(1).unwrap_or(&"")).map(Action::Press),
            "hold" | "release" => parse_button(words.get(1).unwrap_or(&""))
                .map(|idx| Action::Cmd(Command::Button { idx, pressed: words[0] == "hold" })),
            "fault" => {
                let kind = words.get(1).ok_or("fault needs a kind")?.to_string();
                let (channel, state) = match words.len() {
                    3 => (None, words.get(2)),
                    _ => (words.get(2).and_then(|c| c.parse().ok()), words.get(3)),
                };
                on_off(state).map(|on| Action::Cmd(Command::Fault { kind, channel, on }))
            }
            "clear_faults" => Ok(Action::Cmd(Command::ClearFaults)),
            "reset" => Ok(Action::Cmd(Command::ResetMcu)),
            "soc" | "ambient_light" | "ambient_temp" => {
                let v: f64 = words.get(1).and_then(|v| v.parse().ok()).ok_or("needs a number")?;
                Ok(Action::Cmd(Command::Vehicle {
                    ignition: None,
                    park: None,
                    engine: None,
                    soc: (words[0] == "soc").then_some(v),
                    ambient_light: (words[0] == "ambient_light").then_some(v),
                    ambient_temp: (words[0] == "ambient_temp").then_some(v),
                }))
            }
            "uart" => Ok(Action::Cmd(Command::UartSend { text: rest[4..].trim().to_string() })),
            "expect" | "expect_not" if words.get(1) == Some(&"uart") => {
                let text = quoted(rest.splitn(3, char::is_whitespace).nth(2).unwrap_or(""));
                Ok(Action::ExpectUart { text, present: words[0] == "expect", line: line_no })
            }
            "expect" => {
                if words.len() != 4 {
                    return Err(err("expect <field> <op> <value>".into()));
                }
                let value = words[3].parse().map_err(|_| err(format!("bad number '{}'", words[3])))?;
                Ok(Action::Expect { field: words[1].into(), op: words[2].into(), value, line: line_no })
            }
            other => Err(format!("unknown action '{other}'")),
        }
        .map_err(|e: String| if e.starts_with("line") { e } else { err(e) })?;
        steps.push(Step { t, action });
    }
    steps.sort_by_key(|s| s.t);
    Ok(steps)
}

/// Read a named numeric field from the live simulation.
pub fn field(sim: &Sim, name: &str) -> Option<f64> {
    let w = &sim.world;
    let b = |v: bool| if v { 1.0 } else { 0.0 };
    let parts: Vec<&str> = name.split('.').collect();
    Some(match parts.as_slice() {
        ["vbat"] => w.vbat,
        ["soc"] => w.soc,
        ["i_total"] => w.i_total,
        ["board_temp"] => w.board_temp,
        ["arm", "angle"] => w.arm_deg,
        ["arm", "current"] => w.arm_current.abs(),
        ["pdm", "failsafe"] => b(w.pdm_failsafe),
        ["pdm", ch, f] => {
            let c = w.pdm.get(ch.parse::<usize>().ok()?)?;
            match *f {
                "current" => c.current,
                "tripped" => b(c.tripped),
                "duty" => c.duty_eff as f64,
                "open_load" => b(c.open_load),
                _ => return None,
            }
        }
        ["lightbar", "alive"] => b(w.lb_alive),
        ["lightbar", "lit"] => w.lb_lit.count_ones() as f64,
        ["lightbar", "intensity"] => w.lb_intensity as f64,
        ["siren", "freq"] => w.siren_freq as f64,
        ["siren", "sounding"] => b(w.siren_sounding),
        ["scene", "level"] => w.scene_level,
        ["rear", "lit"] => b(w.rear_lit),
        ["mdt", "on"] => b(w.mdt_on),
        ["gpio_out", bit] => ((w.mcu.out.gpio_out >> bit.parse::<u32>().ok()?) & 1) as f64,
        ["fw", "connected"] => b(sim.connected()),
        ["fw", "resets"] => sim_resets(sim) as f64,
        _ => return None,
    })
}

fn sim_resets(sim: &Sim) -> u32 {
    // resets are only exposed through the snapshot struct; recompute cheaply
    sim.resets_count()
}

/// Evaluate `got <op> value`; None for an unknown operator.
pub fn compare(got: f64, op: &str, value: f64) -> Option<bool> {
    Some(match op {
        ">" => got > value,
        ">=" => got >= value,
        "<" => got < value,
        "<=" => got <= value,
        "==" => (got - value).abs() < 1e-6,
        "!=" => (got - value).abs() >= 1e-6,
        _ => return None,
    })
}

pub struct Outcome {
    pub passed: usize,
    pub failures: Vec<String>,
}

/// Run a parsed script against a Sim whose firmware is already launched.
pub fn run(sim: &mut Sim, steps: &[Step], mut on_line: impl FnMut(&str)) -> Result<Outcome, String> {
    // wait (real time) for the firmware to connect
    let start = Instant::now();
    let mut log = Vec::new();
    while !sim.connected() {
        sim.service();
        for l in sim.snapshot().console {
            on_line(&l);
            log.push(l);
        }
        if start.elapsed() > Duration::from_secs(20) {
            // surface the launch log even in --quiet mode
            let tail = log.iter().rev().take(5).rev().cloned().collect::<Vec<_>>().join("\n    ");
            return Err(format!("firmware never connected\n    {tail}"));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let t0 = sim.world.t;
    let end = steps.last().map(|s| s.t).unwrap_or(0) + 1;
    let mut releases: Vec<(u64, usize)> = Vec::new();
    let mut idx = 0;
    let mut out = Outcome { passed: 0, failures: Vec::new() };
    let mut rel_t = 0;
    let mut stalled_since: Option<Instant> = None;

    while rel_t <= end {
        while idx < steps.len() && steps[idx].t <= rel_t {
            match &steps[idx].action {
                Action::Cmd(c) => sim.handle(c.clone()),
                Action::Press(b) => {
                    sim.handle(Command::Button { idx: *b, pressed: true });
                    releases.push((rel_t + 150, *b));
                }
                Action::Expect { field: f, op, value, line } => {
                    let got = field(sim, f).ok_or_else(|| format!("line {line}: unknown field '{f}'"))?;
                    let ok = compare(got, op, *value).ok_or_else(|| format!("line {line}: bad operator '{op}'"))?;
                    if ok {
                        out.passed += 1;
                    } else {
                        out.failures.push(format!("line {line} @{rel_t}ms: expected {f} {op} {value}, got {got:.3}"));
                    }
                }
                Action::ExpectUart { text, present, line } => {
                    let found = sim.uart_history().contains(text.as_str());
                    if found == *present {
                        out.passed += 1;
                    } else {
                        out.failures.push(format!(
                            "line {line} @{rel_t}ms: UART {} contain \"{text}\"",
                            if *present { "did not" } else { "should not" }
                        ));
                    }
                }
            }
            idx += 1;
        }
        releases.retain(|&(t, b)| {
            if t <= rel_t {
                sim.handle(Command::Button { idx: b, pressed: false });
                false
            } else {
                true
            }
        });
        sim.service();
        for l in sim.snapshot().console {
            on_line(&l);
        }
        // After an MCU reset the supervised firmware relaunches in real time;
        // like a HIL rig, wait for the DUT to boot instead of racing ahead.
        let wait_start = Instant::now();
        while !sim.connected() && sim.supervisor.running() {
            if wait_start.elapsed() > Duration::from_secs(10) {
                return Err("firmware did not come back after reset".into());
            }
            std::thread::sleep(Duration::from_millis(2));
            sim.service();
        }
        if sim.tick() {
            stalled_since = None;
        } else if stalled_since.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(10) {
            return Err("simulation frozen (debug freeze with halted MCU)".into());
        }
        rel_t = sim.world.t - t0;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_scenario() {
        let s = parse(
            "# demo\n@0 ignition on\n@100 press arm\n@200 fault short 2 on\n@300 fault jam on\n\
             @400 expect arm.angle >= 88.5\n@500 expect uart \"deployed\"\n@600 uart status\n",
        )
        .unwrap();
        assert_eq!(s.len(), 7);
        assert!(matches!(s[1].action, Action::Press(4)));
        assert!(matches!(&s[2].action, Action::Cmd(Command::Fault { channel: Some(2), on: true, .. })));
        assert!(matches!(&s[3].action, Action::Cmd(Command::Fault { channel: None, on: true, .. })));
        assert!(matches!(&s[5].action, Action::ExpectUart { text, .. } if text == "deployed"));
        assert!(matches!(&s[6].action, Action::Cmd(Command::UartSend { text }) if text == "status"));
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("@0 launch rockets").is_err());
        assert!(parse("@x ignition on").is_err());
        assert!(parse("@0 press button99").is_err());
    }
}
