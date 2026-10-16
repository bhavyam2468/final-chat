//! Window behaviour: what "close" means, and the splash's own rules.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::logging;
use crate::shell::{Shell, MAIN_WINDOW, SPLASH_WINDOW};

/// Window events for every window the app creates.
pub fn handle(app: &AppHandle, shell: &Arc<Shell>, label: &str, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            close_requested(app, shell, label, api);
        }
        WindowEvent::Destroyed => {
            if label == MAIN_WINDOW && !shell.shutting_down.load(Ordering::SeqCst) && !shell.tray_available.load(Ordering::SeqCst) {
                // No tray to live in: the last window closing means the app exits. Tauri's
                // default behaviour already quits when no windows remain, so nothing to do.
                logging::info("main window destroyed; no tray, so the app exits with it");
            }
        }
        _ => {}
    }
}

fn close_requested(app: &AppHandle, shell: &Arc<Shell>, label: &str, api: &tauri::CloseRequestApi) {
    if label == SPLASH_WINDOW {
        // The shell closes the splash itself once the main window is on screen. Before that,
        // closing it would leave the user with no window at all while startup carries on, so it is
        // held open — and released the moment there is something to replace it with.
        if app.get_webview_window(MAIN_WINDOW).is_none() {
            api.prevent_close();
        }
        return;
    }
    if label != MAIN_WINDOW {
        return;
    }
    if shell.shutting_down.load(Ordering::SeqCst) {
        return; // quitting: let it close
    }
    if !shell.tray_available.load(Ordering::SeqCst) {
        // Nothing to hide into: closing the window quits (Tauri's default), so let it through.
        logging::info("window close → quitting (no tray available)");
        return;
    }
    // Hide instead of quitting: this is how the app is meant to be used — a background
    // workspace that answers when the window is reopened from the tray.
    api.prevent_close();
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
    logging::info("window hidden; the app is still running in the tray");
}

/// The startup window: shown immediately, closed once the real UI is up (or replaced by an error
/// message the user can act on).
///
/// It is created from the embedded `splash/` assets, which is why `tauri.conf.json` keeps
/// `frontendDist` set even though the main window is loaded from the app server: development and
/// release then behave identically here.
pub fn create_splash(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(SPLASH_WINDOW).is_some() {
        return Ok(());
    }
    let _window = WebviewWindowBuilder::new(app, SPLASH_WINDOW, WebviewUrl::App("index.html".into()))
        .title("Minimalist AI Workspace")
        .inner_size(460.0, 320.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(true)
        .build()?;
    Ok(())
}
