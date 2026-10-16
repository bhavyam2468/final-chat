//! Minimalist AI Workspace — the desktop shell.
//!
//! What this crate is responsible for, and nothing more:
//!
//!   * finding the writable data directory and seeding it (see `layout`),
//!   * starting the bundled services on loopback ports: SearXNG, then the app server (`search`,
//!     `server`), and keeping them alive (`shell::Shell::watchdog`),
//!   * putting the UI in a native window once the server reports healthy (`window`, `shell`),
//!   * living in the system tray, starting at login, and making sure only one copy runs
//!     (`tray`, `autostart`, `instance`),
//!   * writing one log file that explains everything above (`logging`).
//!
//! The application itself — UI, agent, tools, database — is the Node/Next.js server in the bundle.
//! The window talks to it over HTTP on `127.0.0.1`, exactly like a browser would, so the desktop
//! shell adds no IPC surface to the app.
//!
//! Deliberately plugin-free: one crate with a small dependency graph builds fast, cannot be broken
//! by a plugin's version skew, and keeps every behaviour of the app in this repository.

mod autostart;
mod child;
mod cli;
mod instance;
mod layout;
mod logging;
mod net;
mod search;
mod server;
mod shell;
mod tray;
mod window;

use std::sync::{Arc, OnceLock};

use tauri::{Manager, RunEvent};

use crate::shell::Shell;

/// Milliseconds since the Unix epoch. Used where a monotonic clock would not survive a restart
/// (the runtime file, autostart timestamps).
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Entry point used by `src/main.rs` and by the integration tests.
pub fn run() {
    let cli = cli::parse(std::env::args().collect::<Vec<_>>());
    if cli.help {
        cli::print_help();
        return;
    }
    if cli.version {
        println!("Minimalist AI Workspace {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    cli.apply_env();

    // Resolved before the Tauri app exists so the log file and the single-instance check work
    // even when startup fails later.
    let early = match layout::Layout::resolve(None) {
        Ok(layout) => layout,
        Err(err) => {
            eprintln!("minimalist-ai: cannot work out where to keep data: {err}");
            std::process::exit(2);
        }
    };
    logging::init(&early.logs);
    logging::info(&format!(
        "Minimalist AI Workspace {} starting ({}, pid {})",
        early.version(),
        if layout::is_dev() { "development" } else { "desktop" },
        std::process::id()
    ));
    logging::info(&format!("data directory: {}", early.data.display()));

    // One instance only: a second launch would fight over the data directory and the ports.
    let lock = match instance::InstanceLock::acquire() {
        Ok(Some(lock)) => Some(lock),
        Ok(None) => {
            // Another instance (or an unrelated program on our lock port — `focus_existing` checks
            // which, by asking the recorded port for a health answer).
            if instance::focus_existing(&early) {
                return;
            }
            None
        }
        Err(err) => {
            logging::warn(&format!("could not check for another instance ({err}); continuing"));
            None
        }
    };
    drop(early);

    // The shell is built in `setup`, where Tauri's own path resolver is available; the closures
    // below only need to know whether it exists yet.
    let shell_cell: Arc<OnceLock<Arc<Shell>>> = Arc::new(OnceLock::new());
    let background = cli.background;

    let setup_cell = Arc::clone(&shell_cell);
    let app = tauri::Builder::default()
        .setup(move |app| {
            let layout = match layout::Layout::resolve(Some(app.handle())) {
                Ok(layout) => layout,
                Err(err) => {
                    logging::error(&format!("cannot start: {err}"));
                    return Err(err.into());
                }
            };
            if layout::is_dev() {
                logging::info(&format!("development mode: expecting the dev server on port {}", layout::dev_port()));
            }
            let shell = Arc::new(Shell::new(layout));
            if setup_cell.set(Arc::clone(&shell)).is_err() {
                logging::warn("setup ran twice; keeping the first shell");
            }
            if let Err(err) = window::create_splash(app.handle()) {
                logging::warn(&format!("no splash window: {err}"));
            }
            if let Err(err) = tray::build(app.handle(), &shell) {
                logging::warn(&format!("tray unavailable: {err}"));
            }
            // Never show the window when started by the login session; the tray opens it.
            shell.boot(app.handle(), !background);
            shell.watchdog(app.handle());
            Ok(())
        })
        .on_window_event({
            let cell = Arc::clone(&shell_cell);
            move |window, event| {
                if let Some(shell) = cell.get() {
                    window::handle(window.app_handle(), shell, window.label(), event);
                }
            }
        })
        .build(tauri::generate_context!());

    // A GUI app has no console to print to: report a build failure to both the log and stderr.
    let app = match app {
        Ok(app) => app,
        Err(err) => {
            logging::error(&format!("could not build the desktop application: {err}"));
            eprintln!("minimalist-ai: could not build the desktop application: {err}");
            std::process::exit(1);
        }
    };

    let run_cell = Arc::clone(&shell_cell);
    app.run(move |_app, event| match event {
        // Both paths end here: the tray's Quit, the window closing without a tray, a signal.
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            if let Some(shell) = run_cell.get() {
                if let Some(port) = shell.server_port() {
                    logging::info(&format!("shutting down the app server on port {port}"));
                }
                shell.stop_all();
            }
        }
        _ => {}
    });

    drop(lock);
}
