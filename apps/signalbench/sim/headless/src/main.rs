//! sbsim - headless SignalBench.
//!
//!   sbsim --firmware build/bin/app --script scenarios/arm_deploy.sbs
//!       run a scenario as fast as possible; exit 1 on any failed expectation
//!   sbsim --firmware build/bin/app [--duration 10000]
//!       run in real time, printing the firmware's UART and bench events
//!   sbsim                                   (wait for a manually started firmware)

use signalbench_core::{script, Command, Sim};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, Instant};

struct Args {
    firmware: Option<PathBuf>,
    scripts: Vec<PathBuf>,
    duration: Option<u64>,
    port: u16,
    quiet: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args { firmware: None, scripts: vec![], duration: None, port: 0, quiet: false };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut val = || it.next().ok_or(format!("{arg} needs a value"));
        match arg.as_str() {
            "--firmware" | "-f" => a.firmware = Some(val()?.into()),
            "--script" | "-s" => a.scripts.push(val()?.into()),
            "--duration" | "-d" => a.duration = Some(val()?.parse().map_err(|_| "bad --duration")?),
            "--port" | "-p" => a.port = val()?.parse().map_err(|_| "bad --port")?,
            "--quiet" | "-q" => a.quiet = true,
            "--help" | "-h" => {
                println!("usage: sbsim [--firmware EXE] [--script FILE]... [--duration MS] [--port N] [--quiet]");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument '{other}'")),
        }
    }
    Ok(a)
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("sbsim: {e}");
            return ExitCode::from(2);
        }
    };
    let port = if args.port == 0 && args.firmware.is_none() { signalbench_core::protocol::DEFAULT_PORT } else { args.port };

    if args.scripts.is_empty() {
        return run_interactive(&args, port);
    }

    let mut failed = 0;
    for path in &args.scripts {
        let src = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("sbsim: {}: {e}", path.display());
                return ExitCode::from(2);
            }
        };
        let steps = match script::parse(&src) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("sbsim: {}: {e}", path.display());
                return ExitCode::from(2);
            }
        };
        // fresh bench + fresh firmware process per scenario
        let mut sim = match Sim::new(port) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("sbsim: cannot listen: {e}");
                return ExitCode::from(2);
            }
        };
        sim.speed = 0.0;
        if let Some(fw) = &args.firmware {
            sim.handle(Command::StartFirmware { path: fw.display().to_string() });
        }
        let quiet = args.quiet;
        let started = Instant::now();
        println!("=== {} ===", path.display());
        match script::run(&mut sim, &steps, |l| {
            if !quiet {
                println!("  {l}");
            }
        }) {
            Ok(out) => {
                if !quiet {
                    for l in sim.uart_history().lines() {
                        println!("  uart| {}", l.trim_end());
                    }
                }
                let sim_s = sim.world.t as f64 / 1000.0;
                println!(
                    "  {} passed, {} failed  ({sim_s:.1} s simulated in {:.2} s)",
                    out.passed,
                    out.failures.len(),
                    started.elapsed().as_secs_f64()
                );
                for f in &out.failures {
                    println!("  FAIL {f}");
                }
                if !out.failures.is_empty() {
                    failed += 1;
                }
            }
            Err(e) => {
                println!("  ERROR {e}");
                failed += 1;
            }
        }
        sim.handle(Command::StopFirmware);
    }
    if failed > 0 {
        println!("{failed} scenario(s) failed");
        ExitCode::from(1)
    } else {
        println!("all scenarios passed");
        ExitCode::SUCCESS
    }
}

fn run_interactive(args: &Args, port: u16) -> ExitCode {
    let mut sim = match Sim::new(port) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("sbsim: cannot listen on {port}: {e}");
            return ExitCode::from(2);
        }
    };
    println!("sbsim listening on 127.0.0.1:{}", sim.port());
    if let Some(fw) = &args.firmware {
        sim.handle(Command::StartFirmware { path: fw.display().to_string() });
    }
    sim.handle(Command::Vehicle { ignition: Some(true), park: Some(true), engine: None, ambient_light: None, ambient_temp: None, soc: None });
    let start = Instant::now();
    let mut next = Duration::ZERO;
    loop {
        sim.service();
        while start.elapsed() >= next {
            sim.tick();
            next += Duration::from_millis(1);
        }
        let snap = sim.snapshot();
        for l in snap.console {
            println!("{l}");
        }
        if !snap.uart.is_empty() {
            print!("{}", snap.uart.replace("\r\n", "\n"));
        }
        if let Some(d) = args.duration {
            if sim.world.t >= d {
                return ExitCode::SUCCESS;
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
