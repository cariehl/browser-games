//! Launches the firmware executable ("flashing" the virtual MCU), captures
//! its stdout/stderr, and restarts it when the MCU resets.

use crate::protocol::EXIT_CODE_RESET;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

pub struct Supervisor {
    port: u16,
    child: Option<Child>,
    exe: Option<PathBuf>,
    lines: Arc<Mutex<Vec<String>>>,
}

impl Supervisor {
    pub fn new(port: u16) -> Self {
        Supervisor { port, child: None, exe: None, lines: Arc::new(Mutex::new(Vec::new())) }
    }

    pub fn exe(&self) -> Option<&Path> {
        self.exe.as_deref()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|c| c.id())
    }

    pub fn running(&self) -> bool {
        self.child.is_some()
    }

    fn log(&self, s: impl Into<String>) {
        if let Ok(mut l) = self.lines.lock() {
            l.push(s.into());
        }
    }

    /// Lines printed by the firmware process (and supervisor notices).
    pub fn take_lines(&self) -> Vec<String> {
        self.lines.lock().map(|mut l| std::mem::take(&mut *l)).unwrap_or_default()
    }

    pub fn start(&mut self, exe: &Path) -> Result<(), String> {
        self.stop();
        if !exe.is_file() {
            return Err(format!("firmware not found: {}", exe.display()));
        }
        self.exe = Some(exe.to_path_buf());
        self.spawn()
    }

    fn spawn(&mut self) -> Result<(), String> {
        let exe = self.exe.clone().ok_or("no firmware selected")?;
        let mut cmd = Command::new(&exe);
        cmd.env("SIGNALBENCH_SUPERVISED", "1")
            .env("SIGNALBENCH_ADDR", format!("127.0.0.1:{}", self.port))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("failed to start {}: {e}", exe.display()))?;
        for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
                     child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .flatten()
        {
            let lines = self.lines.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if let Ok(mut l) = lines.lock() {
                        l.push(line);
                    }
                }
            });
        }
        self.log(format!("[flash] started {} (pid {})", exe.display(), child.id()));
        self.child = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
            self.log("[flash] firmware stopped");
        }
    }

    /// Kill and relaunch (used when a hung MCU must be reset).
    pub fn force_restart(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        if self.exe.is_some() {
            if let Err(e) = self.spawn() {
                self.log(format!("[flash] restart failed: {e}"));
            }
        }
    }

    /// Reap an exited child; relaunch it if it exited because of an MCU reset.
    pub fn poll(&mut self) {
        let status = match self.child.as_mut().map(|c| c.try_wait()) {
            Some(Ok(Some(st))) => st,
            _ => return,
        };
        self.child = None;
        match status.code() {
            Some(EXIT_CODE_RESET) => {
                if let Err(e) = self.spawn() {
                    self.log(format!("[flash] restart failed: {e}"));
                }
            }
            Some(code) => self.log(format!("[flash] firmware exited (code {code})")),
            None => self.log("[flash] firmware terminated"),
        }
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
        }
    }
}
