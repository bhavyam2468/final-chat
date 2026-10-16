//! The tray icon: how the app is reached when its window is closed, and where the "keep it
//! running" controls live.
//!
//! Creation is allowed to fail — on a Linux install without libayatana-appindicator there is no
//! tray host, and the app must still work. The shell records that failure and makes closing the
//! window quit instead of hiding it, so nobody ends up with an invisible process.

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
            let id = event.id().as_ref().to_string();
            handle_menu(app, &shell_for_events, &id);
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
            shell.tray_available.store(true, std::sync::atomic::Ordering::SeqCst);
            sync_autostart_label(app, &startup);
            logging::info("tray icon created");
            Ok(())
        }
        Err(e) => {
            shell.tray_available.store(false, std::sync::atomic::Ordering::SeqCst);
            logging::warn(&format!(
                "no system tray available ({e}); closing the window will quit the app. Install libayatana-appindicator to get the tray."
            ));
            // Not an error for the app as a whole: report and continue.
            Ok(())
        }
    }
}

fn handle_menu(app: &AppHandle, shell: &Arc<Shell>, id: &str) {
    match id {
        ID_SHOW => shell.show_main_window(app),
        ID_RESTART => {
            logging::info("restart requested from the tray");
            let shell = Arc::clone(shell);
            let app = app.clone();
            std::thread::spawn(move || {
                match shell.restart_server(&app) {
                    Ok(port) => logging::info(&format!("restart finished on port {port}")),
                    Err(err) => {
                        logging::error(&format!("restart failed: {err}"));
                        // A restart the user asked for bypasses the watchdog's backoff bookkeeping.
                        shell.restart_attempts.store(0, std::sync::atomic::Ordering::SeqCst);
                        if let Some(window) = app.get_webview_window(crate::shell::MAIN_WINDOW) {
                            let message = serde_json::to_string(&err).unwrap_or_else(|_| "\"\"".into());
                            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('desktop-server-error', {{ detail: {message} }}))"));
                        }
                    }
                }
            });
        }
        ID_DATA => search::open_path(&shell.layout.data),
        ID_LOGS => {
            search::open_path(&shell.layout.logs);
            if let Some(log) = logging::path() {
                std::thread::sleep(Duration::from_millis(200));
                search::open_path(&log);
            }
        }
        ID_AUTOSTART => {
            let enable = !autostart::is_enabled();
            match autostart::set_enabled(enable) {
                Ok(()) => logging::info(&format!("start at login: {}", if enable { "on" } else { "off" })),
                Err(e) => logging::warn(&format!("could not change start at login: {e}")),
            }
        }
        ID_QUIT => {
            logging::info("quit requested from the tray");
            let shell = Arc::clone(shell);
            let app = app.clone();
            std::thread::spawn(move || {
                shell.stop_all();
                app.exit(0);
            });
        }
        other => logging::warn(&format!("unknown tray item {other}")),
    }
}

/// Show a check mark next to "Start at login" when it is on.
fn sync_autostart_label(app: &AppHandle, item: &MenuItem<tauri::Wry>) {
    if autostart::is_enabled() {
        let _ = item.set_text("Start at login ✓");
    }
    let _ = app;
}
