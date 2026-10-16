//! A supervised child process: its own process group, its output in the app log, and a stop that
//! takes the whole tree with it.
//!
//! The process group matters: the app server spawns shells, dev servers and a python WSGI
//! server, and killing only the direct child would leave those running (and holding ports).

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child as StdChild, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::logging;

pub struct Child {
    pub name: String,
    pub program: String,
    /// Present while the process is alive; taken out when it is reaped.
    inner: Mutex<Option<StdChild>>,
    /// Started with `process_group(0)`: the pid *is* the group id, so the whole tree can be signalled.
    pub pid: u32,
}

impl Child {
    pub fn spawn(
        name: &str,
        program: &Path,
        args: &[String],
        env: &[(String, String)],
        cwd: Option<&Path>,
        extra_env: &[(&str, String)],
    ) -> std::io::Result<Self> {
        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in env {
            cmd.env(k, v);
        }
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        // A fresh process group per child: signals then reach everything it spawned.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd.spawn()?;
        let pid = child.id();
        let name_owned = name.to_string();
        if let Some(out) = child.stdout.take() {
            tee(name_owned.clone(), out);
        }
        if let Some(err) = child.stderr.take() {
            tee(name_owned.clone(), err);
        }
        logging::info(&format!("started {name} (pid {pid})"));
        Ok(Self {
            name: name.to_string(),
            program: program.display().to_string(),
            inner: Mutex::new(Some(child)),
            pid,
        })
    }

    /// True while the process has not exited. Also reaps it once it has.
    pub fn is_running(&self) -> bool {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    logging::info(&format!("{} exited ({})", self.name, describe_status(status.code())));
                    *guard = None;
                    false
                }
                Ok(None) => true,
                Err(_) => false,
            },
            None => false,
        }
    }

    pub fn exit_code(&self) -> Option<i32> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(child) => child.try_wait().ok().flatten().and_then(|s| s.code()),
            None => None,
        }
    }

    /// Ask the whole process group to stop, then insist. Returns true if it exited in time.
    pub fn stop(&self, grace: Duration) -> bool {
        if !self.is_running() {
            return true;
        }
        signal_group(self.pid, Signal::Term);
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if !self.is_running() {
                logging::info(&format!("{} stopped cleanly", self.name));
                return true;
            }
            std::thread::sleep(Duration::from_millis(120));
        }
        logging::warn(&format!("{} ignored SIGTERM after {:?}; killing", self.name, grace));
        signal_group(self.pid, Signal::Kill);
        for _ in 0..25 {
            if !self.is_running() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }

    /// Take the process out of the supervisor (used when it is replaced by a restart).
    pub fn take(&self) -> Option<StdChild> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).take()
    }
}

fn describe_status(code: Option<i32>) -> String {
    match code {
        Some(0) => "exit 0".into(),
        Some(c) => format!("exit {c}"),
        None => "killed by a signal".into(),
    }
}

pub enum Signal {
    Term,
    Kill,
}

/// Signal a process group (negative pid), falling back to the process itself.
pub fn signal_group(pid: u32, signal: Signal) {
    #[cfg(unix)]
    {
        let sig = match signal {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
        };
        // SAFETY: `kill` is async-signal-safe and only reports errors through its return value.
        unsafe {
            if libc::kill(-(pid as i32), sig) != 0 {
                libc::kill(pid as i32, sig);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = signal;
        // Windows: no process groups here yet — the shell's children are single binaries.
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    }
}

/// Stream a child's output into the app log, one line per record.
fn tee<R: std::io::Read + Send + 'static>(name: String, stream: R) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if !text.trim().is_empty() {
                        logging::child(&name, &text);
                    }
                }
                Err(_) => break,
            }
        }
    });
}
