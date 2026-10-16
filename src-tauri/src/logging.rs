//! One log file for the whole app, and one place that writes it.
//!
//! Everything the shell does (startup steps, child process output, restarts, tray actions) lands
//! in `<data>/logs/desktop.log` with a timestamp and an origin tag, because a desktop app has no
//! terminal to watch. `desktop.log` rotates at ~4 MB into `desktop.log.1`, so the file can be
//! attached to a bug report without growing forever.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Point the logger at a directory. Called once during setup; later calls are ignored.
pub fn init(dir: &PathBuf) {
    let _ = fs::create_dir_all(dir);
    let _ = LOG_PATH.set(dir.join("desktop.log"));
    info(&format!("--- desktop shell starting (pid {}) ---", std::process::id()));
}

pub fn path() -> Option<PathBuf> {
    LOG_PATH.get().cloned()
}

fn mmss() -> String {
    // Local time formatted by the `date` binary: avoids a chrono/time dependency for one line,
    // and every platform this ships on has it (macOS/Linux; Windows future work swaps this out).
    std::process::Command::new("date")
        .arg("+%Y-%m-%d %H:%M:%S")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "-------- --:--:--".to_string())
}

/// Append one line to the log file. Never panics: logging must not be able to break the app.
pub fn write(level: &str, tag: &str, message: &str) {
    let line = format!("{} [{}] {}{}\n", mmss(), level, if tag.is_empty() { String::new() } else { format!("{tag}: ") }, message);
    // A terminal (dev runs) gets it too, so `npm run desktop:dev` output is useful.
    if cfg!(debug_assertions) {
        print!("{line}");
        let _ = std::io::stdout().flush();
    }
    let Some(path) = LOG_PATH.get() else { return };
    let _guard = LOCK.lock();
    rotate_if_needed(path);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

fn rotate_if_needed(path: &PathBuf) {
    let too_big = fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    if too_big {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
}

pub fn info(message: &str) {
    write("INFO", "", message);
}
pub fn child(program: &str, message: &str) {
    write("INFO", program, message);
}
pub fn warn(message: &str) {
    write("WARN", "", message);
}
pub fn error(message: &str) {
    write("ERROR", "", message);
}
