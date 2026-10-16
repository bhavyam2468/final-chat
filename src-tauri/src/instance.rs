//! Single instance.
//!
//! A desktop app that owns ports and a database must not be started twice: the second copy would
//! fight over the same data directory. Instead of pulling in an IPC plugin, the first instance
//! holds a loopback port for its whole lifetime; a second launch fails to bind it, reads the
//! running instance's port from `<data>/runtime.json`, brings that window up in the user's
//! browser as a courtesy (it cannot raise another process's window from here), and exits.

use std::net::{Ipv4Addr, TcpListener};

use crate::layout::Layout;
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

/// Hand over to the instance that is already running, if there really is one.
///
/// The lock port can also be held by an unrelated program, in which case starting our own app is
/// the right answer rather than refusing to launch. So "another instance" is only believed when
/// the port recorded in `runtime.json` answers `/api/health` — that is our app, and nothing else.
///
/// Returns true when the caller should exit (the running app was opened for the user).
pub fn focus_existing(layout: &Layout) -> bool {
    let Some(port) = layout.read_runtime_port() else {
        logging::warn("the single-instance port is in use but no running app was found");
        return false;
    };
    let url = format!("http://127.0.0.1:{port}");
    match crate::net::http_get(&format!("{url}/api/health"), std::time::Duration::from_millis(1500)) {
        Ok((200, _)) => {
            logging::info(&format!("another instance is running on {url}; opening it and exiting"));
            crate::search::open_url(&url);
            true
        }
        _ => {
            logging::warn(&format!(
                "the single-instance port is in use, but nothing answers on {url} — starting anyway"
            ));
            false
        }
    }
}
