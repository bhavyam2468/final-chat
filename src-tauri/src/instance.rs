//! Single instance.
//!
//! A desktop app that owns ports and a database must not be started twice: the second copy would
//! fight over the same data directory. Instead of pulling in an IPC plugin, the first instance
//! holds a loopback port for its whole lifetime; a second launch fails to bind it, reads the
//! running instance's port from `<data>/runtime.json`, brings that window up in the user's
//! browser as a courtesy (it cannot raise another process's window from here), and exits.

use std::net::{Ipv4Addr, TcpListener};
use std::path::Path;

use crate::logging;

/// Deliberately unusual, still inside the dynamic range, and never used for the app itself.
const LOCK_PORT: u16 = 47_819;

pub struct InstanceLock {
    _listener: TcpListener,
}

impl InstanceLock {
    /// Returns `Ok(Some(lock))` when this process is the first instance, `Ok(None)` when another
    /// one is already running (and this process should exit), `Err` on an unexpected failure.
    pub fn acquire() -> std::io::Result<Option<Self>> {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, LOCK_PORT)) {
            Ok(listener) => Ok(Some(Self { _listener: listener })),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => Ok(None),
            Err(e) => Err(e),
        }
    }
}

/// Send the user to the instance that is already running, if it can be located.
pub fn focus_existing(data_dir: &Path) {
    let runtime = data_dir.join("runtime.json");
    let port = std::fs::read_to_string(&runtime)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json.get("port").and_then(|p| p.as_u64()))
        .map(|p| p as u16);
    match port {
        Some(port) => {
            let url = format!("http://127.0.0.1:{port}");
            logging::info(&format!("another instance is running on {url}; opening it and exiting"));
            crate::search::open_url(&url);
        }
        None => logging::info("another instance is running; exiting"),
    }
}
