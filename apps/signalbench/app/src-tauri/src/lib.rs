//! Tauri shell: hosts the simulation engine on a background thread, streams
//! snapshots to the web UI, and builds/flashes firmware with CMake.

use serde::Serialize;
use signalbench_core::{protocol::DEFAULT_PORT, Command, Sim, SimHandle};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    sim: SimHandle,
}

#[derive(Serialize)]
struct Scenario {
    name: String,
    source: String,
}

#[derive(Serialize)]
struct AppInfo {
    port: u16,
    firmware_dir: Option<String>,
    exe_suffix: &'static str,
    scenarios: Vec<Scenario>,
    /// SIGNALBENCH_AUTOFLASH=<target>: build + flash this target at startup.
    autoflash: Option<String>,
    /// SIGNALBENCH_AUTOSCRIPT=<scenario file name>: play it once firmware runs.
    autoscript: Option<String>,
}

fn load_scenarios(fw: &Path) -> Vec<Scenario> {
    let mut out: Vec<Scenario> = std::fs::read_dir(fw.join("scenarios"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "sbs"))
        .filter_map(|e| {
            Some(Scenario {
                name: e.path().file_stem()?.to_string_lossy().into_owned(),
                source: std::fs::read_to_string(e.path()).ok()?,
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[derive(Serialize, Clone)]
struct BuildDone {
    ok: bool,
    exe: Option<String>,
    target: String,
}

/// Look for `firmware/CMakeLists.txt` above the working dir or the executable.
fn find_firmware_dir() -> Option<PathBuf> {
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    for start in starts.into_iter().flatten() {
        for dir in start.ancestors() {
            let candidate = dir.join("firmware");
            if candidate.join("CMakeLists.txt").is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
fn sim_command(state: State<AppState>, cmd: Command) {
    state.sim.send(cmd);
}

#[tauri::command]
fn app_info(state: State<AppState>) -> AppInfo {
    let fw = find_firmware_dir();
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    AppInfo {
        port: state.sim.port,
        scenarios: fw.as_deref().map(load_scenarios).unwrap_or_default(),
        firmware_dir: fw.map(|p| p.display().to_string()),
        exe_suffix: std::env::consts::EXE_SUFFIX,
        autoflash: env("SIGNALBENCH_AUTOFLASH"),
        autoscript: env("SIGNALBENCH_AUTOSCRIPT"),
    }
}

fn run_streaming(app: &AppHandle, program: &str, args: &[String], cwd: &Path) -> bool {
    let _ = app.emit("build-log", format!("$ {program} {}", args.join(" ")));
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("build-log", format!("could not run {program}: {e} (is it on PATH?)"));
            return false;
        }
    };
    let mut readers = Vec::new();
    for pipe in [
        child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let app = app.clone();
        readers.push(std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit("build-log", line);
            }
        }));
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    for r in readers {
        let _ = r.join();
    }
    ok
}

/// Windows won't let the linker overwrite an executable that is running (the
/// firmware currently on the virtual MCU, or one started from a terminal),
/// but it does allow renaming it. Move the old image aside so the build can
/// write a fresh one; the old firmware keeps running until the new one is
/// flashed. Copies left by earlier builds are deleted once nothing runs them.
fn move_aside_running_image(app: &AppHandle, exe: &Path) {
    let (Some(dir), Some(name)) = (exe.parent(), exe.file_name().and_then(|n| n.to_str())) else { return };
    let stale_prefix = format!("{name}.old-");
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with(&stale_prefix) {
            let _ = std::fs::remove_file(entry.path()); // fails harmlessly if still running
        }
    }
    if !exe.is_file() {
        return;
    }
    // Only needed if the file is locked; a plain overwrite test tells us.
    if std::fs::OpenOptions::new().write(true).open(exe).is_ok() {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let aside = dir.join(format!("{stale_prefix}{stamp}"));
    match std::fs::rename(exe, &aside) {
        Ok(()) => {
            let _ = app.emit("build-log", format!("{name} is running; moved it aside so the new image can be linked"));
        }
        Err(e) => {
            let _ = app.emit("build-log", format!("warning: {name} is locked and could not be moved aside ({e}); stop the firmware and retry"));
        }
    }
}

/// Configure (first time) and build one firmware target, then report the
/// path of the produced image. Runs on a worker thread.
#[tauri::command]
fn build_firmware(app: AppHandle, dir: String, target: String) -> Result<(), String> {
    let src = PathBuf::from(&dir);
    if !src.join("CMakeLists.txt").is_file() {
        return Err(format!("no CMakeLists.txt in {dir}"));
    }
    std::thread::spawn(move || {
        let build = src.join("build");
        let exe = build.join("bin").join(format!("{target}{}", std::env::consts::EXE_SUFFIX));
        move_aside_running_image(&app, &exe);
        let mut ok = true;
        if !build.join("CMakeCache.txt").is_file() {
            let mut args = vec!["-S".into(), src.display().to_string(), "-B".into(), build.display().to_string()];
            if cfg!(windows) {
                args.extend(["-G".to_string(), "MinGW Makefiles".to_string()]);
            }
            ok = run_streaming(&app, "cmake", &args, &src);
        }
        if ok {
            let args = vec!["--build".into(), build.display().to_string(), "--target".into(), target.clone(), "-j".into(), "8".into()];
            ok = run_streaming(&app, "cmake", &args, &src);
        }
        let exe = (ok && exe.is_file()).then(|| exe.display().to_string());
        let _ = app.emit("build-log", if exe.is_some() { "build succeeded".to_string() } else { "build FAILED".to_string() });
        let _ = app.emit("build-done", BuildDone { ok: exe.is_some(), exe, target });
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let sim = Sim::new(DEFAULT_PORT).or_else(|_| Sim::new(0))?;
            let handle = app.handle().clone();
            let sim = sim.spawn(move |snap| {
                let _ = handle.emit("snapshot", &snap);
            });
            app.manage(AppState { sim });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sim_command, app_info, build_firmware])
        .run(tauri::generate_context!())
        .expect("error while running SignalBench");
}
