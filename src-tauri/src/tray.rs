//! The tray icon: how the app is reached when its window is closed, and where the "keep it
//! running" controls live.
//!
//! Creation is allowed to fail — on a Linux install without libayatana-appindicator there is no
//! tray host, and the app must still work. The shell records that failure and makes closing the
//! window quit instead of hiding it, so nobody ends up with an invisible process.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::autostart;
use crate::logging;
use crate::search;
use crate::shell::Shell;

const ID_SHOW: &str = "show";
const ID_RESTART: &str = "restart-server";
const ID_DATA: &str = "open-data";
const ID_LOGS: &str = "open-logs";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

pub fn build(app: &AppHandle, shell: &Arc<Shell>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "Open window", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, ID_RESTART, "Restart app server", true, None::<&str>)?;
    let data = MenuItem::with_id(app, ID_DATA, "Open data folder", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, ID_LOGS, "Open logs", true, None::<&str>)?;
    let startup = MenuItem::with_id(app, ID_AUTOSTART, "Start at login", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &restart, &data, &logs, &startup, &separator, &quit])?;

    let shell_for_events = Arc::clone(shell);
    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Minimalist AI Workspace")
        .on_menu_event(move |app, event| {
            // The annotation pins the conversion: MenuId has several `AsRef` impls, and the ids
            // this module writes are `&str`.
            let id: &str = event.id().as_ref();
            handle_menu(app, &shell_for_events, id);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Left click → bring the window back. The menu is on right click.
                let app = tray.app_handle().clone();
                if let Some(window) = app.get_webview_window(crate::shell::MAIN_WINDOW) {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    match builder.build(app) {
        Ok(_tray) => {
            shell.tray_available.store(true, Ordering::SeqCst);
            sync_autostart_label(&startup);
            logging::info("tray icon created");
            Ok(())
        }
        Err(e) => {
            shell.tray_available.store(false, Ordering::SeqCst);
            logging::warn(&format!(
                "no system tray available ({e}); closing the window will quit the app. Install libayatana-appindicator to get the tray."
            ));
            // Not an error for the app as a whole: report it and carry on without a tray.
            Ok(())
        }
    }
}

/// Menu items, as comparisons rather than a `match`: the ids come from the constants above, so a
/// rename can never leave one of them dangling.
fn handle_menu(app: &AppHandle, shell: &Arc<Shell>, id: &str) {
    if id == ID_SHOW {
        shell.show_main_window(app);
        return;
    }

    if id == ID_RESTART {
        logging::info("restart requested from the tray");
        let shell = Arc::clone(shell);
        let app = app.clone();
        std::thread::spawn(move || match shell.restart_server(&app) {
            Ok(port) => logging::info(&format!("restart finished on port {port}")),
            Err(err) => {
                logging::error(&format!("restart failed: {err}"));
                // A restart the user asked for resets the watchdog's crash bookkeeping.
                shell.restart_attempts.store(0, Ordering::SeqCst);
                let message = serde_json::to_string(&err).unwrap_or_else(|_| "\"\"".into());
                if let Some(window) = app.get_webview_window(crate::shell::MAIN_WINDOW) {
                    let _ = window.eval(format!(
                        "window.dispatchEvent(new CustomEvent('desktop-server-error', {{ detail: {message} }}))"
                    ));
                }
            }
        });
        return;
    }

    if id == ID_DATA {
        search::open_path(&shell.layout.data);
        return;
    }

    if id == ID_LOGS {
        search::open_path(&shell.layout.logs);
        if let Some(log) = logging::path() {
            // Let the file manager open the folder first, then select the log file itself.
            std::thread::sleep(Duration::from_millis(200));
            search::open_path(&log);
        }
        return;
    }

    if id == ID_AUTOSTART {
        if !autostart::is_supported() {
            logging::warn("start at login is only wired up for Linux in this build");
            return;
        }
        let enable = !autostart::is_enabled();
        match autostart::set_enabled(enable) {
            Ok(()) => logging::info(&format!("start at login: {}", if enable { "on" } else { "off" })),
            Err(e) => logging::warn(&format!("could not change start at login: {e}")),
        }
        return;
    }

    if id == ID_QUIT {
        logging::info("quit requested from the tray");
        let shell = Arc::clone(shell);
        let app = app.clone();
        std::thread::spawn(move || {
            // Tear the services down here rather than in the exit handler, so the process only
            // ends once the database has been closed cleanly.
            shell.stop_all();
            app.exit(0);
        });
        return;
    }

    logging::warn(&format!("unknown tray item {id}"));
}

/// Show a check mark next to "Start at login" when it is on.
fn sync_autostart_label(item: &MenuItem<tauri::Wry>) {
    if autostart::is_enabled() {
        let _ = item.set_text("Start at login ✓");
    }
}
