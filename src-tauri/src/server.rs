//! The app server (Next.js standalone) as a child process.
//!
//! The shell picks the port, hands the server every path it may write, waits for `/api/health`,
//! and restarts it if it dies. In development the server is `npm run dev` (started by the Tauri
//! CLI through `beforeDevCommand`, or by hand), so this module only *waits* for it.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::child::Child;
use crate::layout::{self, Layout};
use crate::logging;
use crate::net;

pub struct AppServer {
    pub child: Child,
    pub port: u16,
    pub url: String,
}

/// Start the bundled server on a free port.
pub fn start(layout: &Layout, searxng_url: Option<&str>, on_progress: &dyn Fn(&str)) -> Result<AppServer, String> {
    start_on_port(layout, searxng_url, None, on_progress)
}

/// Start the bundled server, preferring `port` when it is given and free (a restart reuses the
/// port the window is already on). Falls back to an OS-chosen port; the caller decides whether a
/// port change is acceptable.
pub fn start_on_port(layout: &Layout, searxng_url: Option<&str>, port: Option<u16>, on_progress: &dyn Fn(&str)) -> Result<AppServer, String> {
    if !layout.appserver_entry.exists() {
        return Err(format!(
            "the app server is not part of this build ({} missing). Run `npm run desktop:prepare`.",
            layout.appserver_entry.display()
        ));
    }
    if !crate::layout::is_executable(&layout.node_bin) {
        return Err(format!("no Node runtime at {}", layout.node_bin.display()));
    }

    let mut last_error = String::new();
    let mut candidates: Vec<Option<u16>> = Vec::new();
    if let Some(preferred) = port.filter(|p| !net::port_in_use(*p)) {
        candidates.push(Some(preferred));
    }
    candidates.push(None);

    for (attempt, candidate) in candidates.into_iter().enumerate() {
        on_progress("Starting the app server");
        // A port can be taken between choosing it and the child binding it, hence the retry.
        let chosen = match candidate {
            Some(p) => p,
            None => match net::free_port() {
                Ok(p) => p,
                Err(e) => return Err(format!("no free port: {e}")),
            },
        };
        match try_start(layout, chosen, searxng_url) {
            Ok(server) => return Ok(server),
            Err(err) => {
                last_error = err;
                logging::warn(&format!("app server start attempt {} failed: {last_error}", attempt + 1));
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    }
    Err(last_error)
}

fn try_start(layout: &Layout, port: u16, searxng_url: Option<&str>) -> Result<AppServer, String> {
    let entry = layout.appserver_entry.display().to_string();
    let args = vec![entry];
    let mut env: Vec<(String, String)> = vec![
        ("NODE_ENV".into(), "production".into()),
        ("HOSTNAME".into(), "127.0.0.1".into()),
        ("PORT".into(), port.to_string()),
        // Tells the server it is running inside the desktop shell: writable paths come from here,
        // never from its own directory (see src/lib/paths.ts).
        ("APP_MODE".into(), "desktop".into()),
        ("APP_ROOT".into(), layout.appserver_dir.display().to_string()),
        ("APP_DATA_DIR".into(), layout.data.display().to_string()),
        ("APP_LOG_DIR".into(), layout.logs.display().to_string()),
        ("WORKSPACE_DIR".into(), layout.workspace.display().to_string()),
        ("WORKSPACE_TEMPLATE_DIR".into(), layout.workspace_template.display().to_string()),
        ("PGLITE_DIR".into(), layout.pglite.display().to_string()),
        ("VENV_DIR".into(), layout.venv.display().to_string()),
        ("PY_REQUIREMENTS".into(), layout.python_requirements.display().to_string()),
        ("ENV_FILE".into(), layout.config_file.display().to_string()),
        ("RUNTIME_FILE".into(), layout.runtime_file.display().to_string()),
        ("APP_VERSION".into(), layout.version()),
        ("APP_URL".into(), format!("http://127.0.0.1:{port}")),
    ];
    // User configuration from <data>/config.env. Real environment variables (ours, above) win
    // over the file, so the ports and paths the shell set cannot be broken from a stale file.
    for (key, value) in layout.read_config() {
        if !env.iter().any(|(k, _)| k == &key) {
            env.push((key, value));
        }
    }
    if let Some(url) = searxng_url {
        env.retain(|(k, _)| k != "SEARXNG_URL");
        env.push(("SEARXNG_URL".into(), url.to_string()));
    }

    let child = Child::spawn("app-server", &layout.node_bin, &args, &env, Some(&layout.appserver_dir), &[]).map_err(|e| format!("spawn failed: {e}"))?;
    Ok(AppServer {
        child,
        port,
        url: format!("http://127.0.0.1:{port}"),
    })
}

/// Wait for `/api/health` to answer 200. Reports elapsed time through `on_progress` so the splash
/// can show that something is happening (PGlite migrations plus a cold start can take a while).
pub fn wait_ready(server: &AppServer, server_child: &Child, timeout: Duration, on_progress: &dyn Fn(&str)) -> bool {
    let url = format!("{}/api/health", server.url);
    let deadline = Instant::now() + timeout;
    let started = Instant::now();
    while Instant::now() < deadline {
        if !server_child.is_running() {
            return false;
        }
        if let Ok((200, body)) = net::http_get(&url, Duration::from_millis(2000)) {
            if body.contains("\"ok\":true") {
                logging::info(&format!("app server ready on {} after {:?}", server.url, started.elapsed()));
                return true;
            }
        }
        on_progress(&format!("Waiting for the app server ({:.0}s)", started.elapsed().as_secs_f32()));
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

/// In development the server is started outside the shell; wait for it to appear.
pub fn wait_for_dev_server(port: u16, timeout: Duration, on_progress: &dyn Fn(&str)) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    on_progress(&format!("Waiting for the dev server on port {port}"));
    let started = Instant::now();
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if net::wait_for_http(&url, 200, Duration::from_millis(2500)) {
            logging::info(&format!("dev server ready after {:?}", started.elapsed()));
            return true;
        }
        on_progress(&format!("Waiting for the dev server on port {port} ({:.0}s)", started.elapsed().as_secs_f32()));
    }
    false
}

/// Provision `<data>/venv` (python for run_python / pip / office previews) in the background.
///
/// Not part of startup: the app is fully usable without python, and installing ~300 MB of wheels
/// must never delay the window. Runs as a tracked child process, so quitting during the install
/// takes pip down with it instead of leaving an orphan writing into the data directory.
pub fn provision_python(shell: &std::sync::Arc<crate::shell::Shell>) {
    let layout = &shell.layout;
    let venv_python = venv_interpreter(layout);
    if crate::layout::is_executable(&venv_python) {
        logging::info("python environment already present");
        return;
    }
    let Some(python) = which_python() else {
        logging::warn("no python3 on PATH: run_python and office previews will be unavailable");
        return;
    };
    if !layout.python_requirements.exists() {
        logging::warn("no python requirements shipped: skipping the python environment");
        return;
    }
    let shell = std::sync::Arc::clone(shell);
    std::thread::spawn(move || {
        let layout = shell.layout.clone();
        logging::info(&format!("provisioning the python environment in {}", layout.venv.display()));
        let venv_args = vec!["-m".to_string(), "venv".to_string(), layout.venv.display().to_string()];
        if !run_tracked(&shell, "python-venv", &python, &venv_args) {
            logging::warn("could not create the python environment (is python3-venv installed?)");
            return;
        }
        if shell.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        let pip_args = vec![
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--quiet".to_string(),
            "--disable-pip-version-check".to_string(),
            "-r".to_string(),
            layout.python_requirements.display().to_string(),
        ];
        if run_tracked(&shell, "python-pip", &venv_interpreter(&layout), &pip_args) {
            logging::info("python environment ready (numpy, pandas, matplotlib, sympy, office format support)");
        } else {
            logging::warn("python packages did not install; run_python will use the system interpreter");
        }
    });
}

/// Spawn a helper through the shell's process supervisor and wait for it to finish.
fn run_tracked(shell: &std::sync::Arc<crate::shell::Shell>, name: &str, program: &PathBuf, args: &[String]) -> bool {
    let child = match Child::spawn(name, program, args, &[], Some(&shell.layout.data), &[]) {
        Ok(child) => child,
        Err(e) => {
            logging::warn(&format!("{name} did not start: {e}"));
            return false;
        }
    };
    let mut child = child;
    loop {
        if !child.is_running() {
            return child.exit_code() == Some(0);
        }
        if shell.shutting_down.load(Ordering::Relaxed) {
            child.stop(Duration::from_secs(2));
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// `<venv>/bin/python` (POSIX) or `<venv>/Scripts/python.exe` (Windows).
fn venv_interpreter(layout: &Layout) -> PathBuf {
    if cfg!(windows) {
        layout.venv.join("Scripts").join("python.exe")
    } else {
        layout.venv.join("bin").join("python")
    }
}

fn which_python() -> Option<PathBuf> {
    for name in ["python3", "python"] {
        if let Some(path) = crate::search::which_path(name) {
            return Some(path);
        }
    }
    None
}
