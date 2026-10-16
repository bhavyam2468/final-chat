//! The shell's brain: bring the services up, keep them up, and put the UI in a window.
//!
//! Startup order matters and is not arbitrary:
//!   1. the data directories and `<data>/config.env` (everything else writes into them),
//!   2. SearXNG on a free loopback port — optional, the app works without it,
//!   3. the app server, told where the bundled search landed, on its own free port,
//!   4. `/api/health` green → the main window opens on that URL and the splash closes,
//!   5. the python environment is provisioned in the background (never blocks the window).
//!
//! After that a watchdog keeps the two services alive: the app is meant to sit in the tray and
//! stay usable, so a crashed server is restarted (on the same port when it is still free, so the
//! window's URL stays valid) with backoff, and a dead SearXNG comes back on its own.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::child::Child;
use crate::layout::{self, Layout};
use crate::logging;
use crate::net;
use crate::search::{self, Search};
use crate::server::{self, AppServer};

pub const MAIN_WINDOW: &str = "main";
pub const SPLASH_WINDOW: &str = "splash";

pub struct Shell {
    pub layout: Layout,
    pub searxng: Mutex<Option<Search>>,
    pub server: Mutex<Option<AppServer>>,
    /// Short-lived helper processes (python venv/pip), by pid. Tracked so quitting mid-install
    /// does not leave a pip running in the background with no way to stop it.
    pub background: Mutex<Vec<u32>>,
    pub shutting_down: AtomicBool,
    /// False when the tray could not be created (missing libayatana-appindicator): closing the
    /// window must then quit the app instead of hiding it into an invisible tray.
    pub tray_available: AtomicBool,
    /// Consecutive failed restarts, so a permanently broken server backs off instead of spinning.
    pub restart_attempts: AtomicU32,
}

impl Shell {
    pub fn new(layout: Layout) -> Self {
        Self {
            layout,
            searxng: Mutex::new(None),
            server: Mutex::new(None),
            background: Mutex::new(Vec::new()),
            shutting_down: AtomicBool::new(false),
            tray_available: AtomicBool::new(false),
            restart_attempts: AtomicU32::new(0),
        }
    }

    pub fn searxng_url(&self) -> Option<String> {
        self.searxng.lock().ok().and_then(|g| g.as_ref().map(|s| s.url.clone()))
    }

    /// Where the main window should point. In development that is the server the developer runs
    /// (`npm run desktop:dev` waits for it instead of starting one); otherwise it is the bundled
    /// app server this shell started.
    pub fn server_url(&self) -> Option<String> {
        if let Some(url) = self.server.lock().ok().and_then(|g| g.as_ref().map(|s| s.url.clone())) {
            return Some(url);
        }
        if layout::is_dev() {
            return Some(format!("http://127.0.0.1:{}", layout::dev_port()));
        }
        None
    }

    pub fn server_port(&self) -> Option<u16> {
        self.server.lock().ok().and_then(|g| g.as_ref().map(|s| s.port))
    }

    /// Remember a helper process (by pid) so `stop_all` can end it.
    pub fn track(&self, pid: u32) {
        if let Ok(mut guard) = self.background.lock() {
            guard.push(pid);
        }
    }

    /// Forget a helper that finished on its own.
    pub fn untrack(&self, pid: u32) {
        if let Ok(mut guard) = self.background.lock() {
            guard.retain(|p| *p != pid);
        }
    }

    /// Splash → services → window, on a background thread. `show_window` is false when the app
    /// was started by the login session, where the tray is the way in.
    pub fn boot(self: &Arc<Self>, app: &AppHandle, show_window: bool) {
        let shell = Arc::clone(self);
        let app = app.clone();
        std::thread::spawn(move || {
            splash_version(&app, &shell.layout.version());
            if let Err(err) = shell.start_services(&app) {
                logging::error(&format!("startup failed: {err}"));
                splash(&app, "Could not start", "error");
                splash_detail(&app, &err);
                return;
            }
            // Without a tray there would be no way to reach a hidden window, so show it anyway.
            let show = show_window || !shell.tray_available.load(Ordering::SeqCst);
            if show {
                if let Some(url) = shell.server_url() {
                    shell.open_main_window(&app, &url);
                }
            } else {
                logging::info("started in the background; open the window from the tray");
                if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
                    let _ = splash.close();
                }
            }
            if !layout::is_dev() {
                server::provision_python(&shell);
            }
        });
    }

    fn start_services(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let layout = &self.layout;
        splash(app, "Preparing folders", "working");
        splash_detail(app, &layout.data.display().to_string());
        layout.ensure_dirs()?;
        layout.seed_config()?;

        if layout::is_dev() {
            let port = layout::dev_port();
            splash(app, "Waiting for the dev server", "working");
            if !server::wait_for_dev_server(port, Duration::from_secs(180), &|text| splash_detail(app, text)) {
                return Err(format!(
                    "no dev server answered on port {port}.\nStart one with:  npm run dev -- -p {port}\nthen relaunch the shell.",
                ));
            }
            // Record the port the window is on, so the tools that read `runtime.json` (the ctl
            // script, chatsync, the single-instance handover) point at the dev server rather than
            // at whatever a packaged run left behind.
            layout.write_runtime(port, std::process::id());
            return Ok(());
        }

        splash(app, "Starting search", "working");
        match search::start(layout, &|text| splash_detail(app, text)) {
            Ok(search) => {
                logging::info(&format!("search engine ready on {} ({})", search.url, search.engine));
                *self.searxng.lock().map_err(|e| e.to_string())? = Some(search);
            }
            Err(err) => {
                // Not fatal: the search tool falls back to its keyless adapters.
                logging::warn(&format!("bundled search is unavailable ({err}); search falls back to the keyless adapters"));
                splash_detail(app, "Search unavailable — continuing");
            }
        }

        let searx_url = self.searxng_url();
        splash(app, "Starting the app server", "working");
        let started = server::start_on_port(layout, searx_url.as_deref(), layout::app_port(), &|text| splash_detail(app, text))?;
        let port = started.port;
        let ready = server::wait_ready(&started, &started.child, Duration::from_secs(120), &|text| splash_detail(app, text));
        if !ready {
            let _ = started.child.stop(Duration::from_secs(5));
            return Err(format!(
                "the app server did not become healthy on port {port}.\nSee {}.",
                logging::path().map(|p| p.display().to_string()).unwrap_or_default()
            ));
        }
        layout.write_runtime(port, std::process::id());
        *self.server.lock().map_err(|e| e.to_string())? = Some(started);
        Ok(())
    }

    /// Create the real window against the running server and close the splash.
    pub fn open_main_window(self: &Arc<Self>, app: &AppHandle, url: &str) {
        let handle = app.clone();
        let url = url.to_string();
        let _ = app.run_on_main_thread(move || {
            if let Some(existing) = handle.get_webview_window(MAIN_WINDOW) {
                let _ = existing.show();
                let _ = existing.set_focus();
                return;
            }
            let parsed = match url.parse() {
                Ok(u) => u,
                Err(e) => {
                    logging::error(&format!("bad app url {url}: {e}"));
                    return;
                }
            };
            logging::info(&format!("opening the main window on {url}"));
            match WebviewWindowBuilder::new(&handle, MAIN_WINDOW, WebviewUrl::External(parsed))
                .title("Minimalist AI Workspace")
                .inner_size(1320.0, 880.0)
                .min_inner_size(700.0, 480.0)
                .center()
                .resizable(true)
                .visible(true)
                .zoom_hotkeys_enabled(true)
                .build()
            {
                Ok(window) => {
                    let _ = window.set_focus();
                    if let Some(splash) = handle.get_webview_window(SPLASH_WINDOW) {
                        let _ = splash.close();
                    }
                }
                Err(e) => {
                    logging::error(&format!("could not open the main window: {e}"));
                    splash(&handle, "Could not open the window", "error");
                    splash_detail(&handle, &e.to_string());
                }
            }
        });
    }

    pub fn show_main_window(self: &Arc<Self>, app: &AppHandle) {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            return;
        }
        if let Some(url) = self.server_url() {
            self.open_main_window(app, &url);
        }
    }

    /// Bring the app server back after it died, ideally on the same port so the window URL stands.
    pub fn restart_server(self: &Arc<Self>, app: &AppHandle) -> Result<u16, String> {
        if layout::is_dev() {
            // The dev server is the developer's own process in another terminal: replacing it here
            // would fight the watcher that is already rebuilding it.
            return Err("the dev server is not owned by the shell; restart it in your terminal".into());
        }
        let old_port = self.server_port();
        if let Ok(mut guard) = self.server.lock() {
            if let Some(server) = guard.take() {
                let _ = server.child.stop(Duration::from_secs(5));
            }
        }
        let searx_url = self.searxng_url();
        // Reuse the old port when nothing took it; otherwise let the OS choose and navigate.
        let started = match old_port.filter(|p| !net::port_in_use(*p)) {
            Some(port) => server::start_on_port(&self.layout, searx_url.as_deref(), Some(port), &|_| {})?,
            None => server::start(&self.layout, searx_url.as_deref(), &|_| {})?,
        };
        let port = started.port;
        if !server::wait_ready(&started, &started.child, Duration::from_secs(120), &|_| {}) {
            let _ = started.child.stop(Duration::from_secs(5));
            return Err("restarted server never became healthy".into());
        }
        self.layout.write_runtime(port, std::process::id());
        *self.server.lock().map_err(|e| e.to_string())? = Some(started);
        logging::info(&format!("app server restarted on port {port}"));

        if let Some(previous) = old_port.filter(|p| *p != port) {
            logging::warn(&format!("server moved from port {previous} to {port}; the window follows"));
        }
        if let Ok(url) = format!("http://127.0.0.1:{port}").parse() {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                if let Err(e) = window.navigate(url) {
                    logging::warn(&format!("could not navigate the window: {e}"));
                }
            }
        }
        Ok(port)
    }

    fn restart_searxng(self: &Arc<Self>) {
        {
            let Ok(mut guard) = self.searxng.lock() else { return };
            if let Some(old) = guard.take() {
                let _ = old.child.stop(Duration::from_secs(2));
            }
        }
        match search::start(&self.layout, &|_| {}) {
            Ok(search) => {
                logging::info(&format!("search engine restarted: {}", search.url));
                if let Ok(mut guard) = self.searxng.lock() {
                    *guard = Some(search);
                }
            }
            Err(err) => logging::warn(&format!("could not restart the bundled search: {err}")),
        }
    }

    /// Keep the services alive for as long as the app runs.
    pub fn watchdog(self: &Arc<Self>, app: &AppHandle) {
        let shell = Arc::clone(self);
        let app = app.clone();
        std::thread::spawn(move || {
            // Give startup its own window before judging anything dead.
            std::thread::sleep(Duration::from_secs(15));
            let mut searxng_backoff = Duration::from_secs(5);
            while !shell.shutting_down.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(2));

                let server_dead = shell
                    .server
                    .lock()
                    .map(|guard| guard.as_ref().map(|s| !s.child.is_running()).unwrap_or(false))
                    .unwrap_or(false);
                if server_dead && !shell.shutting_down.load(Ordering::Relaxed) {
                    // `POST /api/desktop {action:"stop"}` is a request to end the app, not a crash:
                    // without this the watchdog would dutifully start the server again.
                    if shell.layout.take_quit_request() {
                        logging::info("app server asked to quit; stopping the app");
                        shell.stop_all();
                        app.exit(0);
                        return;
                    }
                    // The server can also ask to be *replaced* (POST /api/desktop {action:"restart"}):
                    // that is not a crash either, so it neither warns nor counts against the backoff.
                    let requested = shell.layout.take_restart_request();
                    let attempts = if requested {
                        shell.restart_attempts.store(0, Ordering::Relaxed);
                        logging::info("app server asked for a restart; restarting it");
                        0
                    } else {
                        let attempt = shell.restart_attempts.fetch_add(1, Ordering::Relaxed) + 1;
                        logging::warn(&format!("app server is not running; restart attempt {attempt}"));
                        attempt
                    };
                    match shell.restart_server(&app) {
                        Ok(_) => shell.restart_attempts.store(0, Ordering::Relaxed),
                        Err(err) => {
                            logging::error(&format!("restart failed: {err}"));
                            // Back off linearly, then settle at a slow retry: a broken install
                            // should not spin the CPU, but the app should still recover on its own
                            // once the cause is gone (a freed port, a file the user fixed).
                            let wait = Duration::from_secs((5 * attempts.clamp(1, 12) as u64).min(60));
                            for _ in 0..wait.as_secs() {
                                if shell.shutting_down.load(Ordering::Relaxed) {
                                    return;
                                }
                                std::thread::sleep(Duration::from_secs(1));
                            }
                        }
                    }
                }

                let searxng_dead = shell
                    .searxng
                    .lock()
                    .map(|guard| guard.as_ref().map(|s| !s.child.is_running()).unwrap_or(false))
                    .unwrap_or(false);
                if searxng_dead && !shell.shutting_down.load(Ordering::Relaxed) {
                    std::thread::sleep(searxng_backoff);
                    searxng_backoff = (searxng_backoff * 2).min(Duration::from_secs(120));
                    shell.restart_searxng();
                } else {
                    searxng_backoff = Duration::from_secs(5);
                }
            }
        });
    }

    /// Stop everything. Called on exit; idempotent, and safe from any thread.
    pub fn stop_all(&self) {
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        logging::info("stopping services");
        if let Some(port) = self.server_port() {
            // Best effort: ask the server to close PGlite and its children, then escalate.
            let _ = net::request_shutdown(port);
            std::thread::sleep(Duration::from_millis(400));
        }
        if let Ok(mut guard) = self.server.lock() {
            if let Some(server) = guard.take() {
                stop_child(&server.child, Duration::from_secs(8));
            }
        }
        if let Ok(mut guard) = self.searxng.lock() {
            if let Some(search) = guard.take() {
                stop_child(&search.child, Duration::from_secs(4));
            }
        }
        if let Ok(mut guard) = self.background.lock() {
            // Helpers (venv, pip) are owned by the thread that started them, which is what escalates
            // to SIGKILL and untracks the pid — here they only get an immediate nudge, so quitting
            // during a pip install does not wait for the poll interval. A pid that has already
            // exited is still a zombie at worst: nothing reaps it before its own thread does.
            for pid in guard.drain(..) {
                logging::info(&format!("stopping helper process {pid}"));
                crate::child::signal_group(pid, crate::child::Signal::Term);
            }
        }
        logging::info("services stopped");
    }
}

fn stop_child(child: &Child, grace: Duration) {
    if !child.stop(grace) {
        logging::warn(&format!("{} could not be stopped", child.name));
    }
}

/// Update the splash window's headline.
pub fn splash(app: &AppHandle, text: &str, state: &str) {
    logging::info(text);
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = window.eval(format!("window.setStatus({}, {})", json(text), json(state)));
    }
}

/// Fill in the splash's version line (the window is created before the layout is read).
pub fn splash_version(app: &AppHandle, version: &str) {
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = window.eval(format!("window.setVersion({})", json(&format!("v{version}"))));
    }
}

/// Update the splash window's second line (progress detail).
pub fn splash_detail(app: &AppHandle, text: &str) {
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = window.eval(format!("window.setDetail({})", json(text)));
        let _ = window.eval(format!("window.setLogPath({})", json(&logging::path().map(|p| p.display().to_string()).unwrap_or_default())));
    }
}

fn json(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}
