//! Where everything lives: the read-only bundle on one side, the writable app data directory on
//! the other, plus the environment the app server is started with.
//!
//! The shell owns this; the server is told (see src/lib/paths.ts on the other side, which reads
//! exactly these variables and nothing else).

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::logging;

/// Name of the file the shell seeds and then reads every start. Documented in docs/DESKTOP.md.
pub const CONFIG_FILE: &str = "config.env";

/// The app's identity on the platform: names the data/log directory, the autostart entry and the
/// window's WM class. Must match `identifier` in tauri.conf.json.
pub const IDENTIFIER: &str = "dev.bhavyam.minimalist-ai";

#[derive(Clone, Debug)]
pub struct Layout {
    /// Writable root: `~/.local/share/dev.bhavyam.minimalist-ai` on Linux (Tauri's app_data_dir).
    pub data: PathBuf,
    pub logs: PathBuf,
    pub config_file: PathBuf,
    /// Written at startup with the live ports so a second launch can reach the first instance.
    pub runtime_file: PathBuf,
    /// Where the agent works. A folder the user can find, open and back up.
    pub workspace: PathBuf,
    pub pglite: PathBuf,
    pub venv: PathBuf,
    pub searxng_data: PathBuf,
    /// Read-only bundle pieces (may be absent in `tauri dev`, which is fine: dev uses the dev server).
    pub resources: PathBuf,
    pub appserver_dir: PathBuf,
    pub appserver_entry: PathBuf,
    pub node_bin: PathBuf,
    pub searxng_dir: PathBuf,
    pub searxng_src: PathBuf,
    pub searxng_venv_python: PathBuf,
    pub searxng_python_bundled: PathBuf,
    pub searxng_settings_template: PathBuf,
    pub workspace_template: PathBuf,
    pub python_requirements: PathBuf,
    pub build_info: Option<serde_json::Value>,
}

impl Layout {
    /// Resolve the layout.
    ///
    /// Before the Tauri application exists, call this with `None`: the data directory then comes
    /// from `APP_DATA_DIR` or from the platform convention (exactly what Tauri derives from the
    /// bundle identifier a moment later), which is what lets the log file and the single-instance
    /// check work before any window exists. The resolved data directory is pinned in the
    /// environment so both calls agree.
    pub fn resolve(app: Option<&AppHandle>) -> Result<Self, String> {
        let data = std::env::var("APP_DATA_DIR")
            .ok()
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(|| app.and_then(|app| app.path().app_data_dir().ok()))
            .or_else(convention_data_dir)
            .ok_or_else(|| "no home directory found (set APP_DATA_DIR to choose one)".to_string())?;
        std::env::set_var("APP_DATA_DIR", &data);

        // Tauri's log dir is `<data>/logs` on Linux and Windows, `~/Library/Logs/<id>` on macOS;
        // either way a file next to the data it describes.
        let logs = std::env::var("APP_LOG_DIR")
            .ok()
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(|| app.and_then(|app| app.path().app_log_dir().ok()))
            .unwrap_or_else(|| data.join("logs"));
        Ok(Self::from_dirs(data, logs, resolve_resources(app)))
    }

    /// Split out from `resolve` so tests and the CLI-free code paths can build a layout from
    /// plain directories.
    pub fn from_dirs(data: PathBuf, logs: PathBuf, resources: PathBuf) -> Self {
        let searxng_dir = resources.join("searxng");
        let appserver_dir = resources.join("appserver");
        let build_info = fs::read_to_string(resources.join("BUILD-INFO.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        Self {
            config_file: data.join(CONFIG_FILE),
            runtime_file: data.join("runtime.json"),
            workspace: data.join("workspace"),
            pglite: data.join("data").join("pglite"),
            venv: data.join("venv"),
            searxng_data: data.join("searxng"),
            appserver_entry: appserver_dir.join("server.js"),
            node_bin: resources.join("runtime").join("bin").join("node"),
            searxng_src: searxng_dir.join("src"),
            searxng_venv_python: searxng_dir.join("venv").join("bin").join("python"),
            searxng_python_bundled: searxng_dir.join("python").join("bin").join("python3"),
            searxng_settings_template: searxng_dir.join("settings.yml"),
            workspace_template: resources.join("workspace-template"),
            python_requirements: resources.join("python-requirements.txt"),
            data,
            logs,
            resources,
            appserver_dir,
            searxng_dir,
            build_info,
        }
    }

    pub fn version(&self) -> String {
        self.build_info
            .as_ref()
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("0.0.0")
            .to_string()
    }

    /// Create every directory the app writes to. Failing here is fatal and reported to the user.
    pub fn ensure_dirs(&self) -> Result<(), String> {
        for dir in [&self.data, &self.logs, &self.workspace, &self.pglite, &self.searxng_data] {
            fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        }
        Ok(())
    }

    /// Seed `<data>/config.env` on first run so there is a documented file to edit. Advanced
    /// settings (a real Postgres, a different workspace folder, a fixed port) live here.
    pub fn seed_config(&self) -> Result<(), String> {
        if self.config_file.exists() {
            return Ok(());
        }
        let template = format!(
            "# Minimalist AI Workspace — configuration\n\
             #\n\
             # Written once and never overwritten. Every line is optional; delete one to fall back\n\
             # to the default. Real environment variables take precedence over this file, so the\n\
             # paths and ports the desktop app sets for itself cannot be changed from here —\n\
             # except the ones documented as overridable below.\n\
             #\n\
             # Chat model. Any OpenAI-compatible endpoint. The same settings can be changed at\n\
             # runtime in Settings → Model, which is the recommended way.\n\
             #   LLM_PROVIDER=gemini\n\
             #   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\n\
             #   LLM_API_KEY=…\n\
             #   LLM_MODEL=gemini-3.5-flash-lite\n\
             #\n\
             # Use a real PostgreSQL instead of the embedded database (advanced):\n\
             #   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db\n\
             #\n\
             # Point at a SearXNG you run yourself instead of the bundled one:\n\
             #   SEARXNG_URL=http://127.0.0.1:8080\n\
             #\n\
             # Python interpreter for the agent's run_python tool (default: <data>/venv, else python3):\n\
             #   PYTHON_BIN=/usr/bin/python3\n\
             #\n\
             # Access defaults (the switches in Settings → Access still apply):\n\
             #   ACCESS_MODE=sandbox\n\
             #   TERMINAL_MODE=sandbox\n\
             #   ALLOW_SUDO=0\n\
             #\n\
             # Developer mode: offline mock model, sample files, window.__dev in the console.\n\
             #   DEV_MODE=1\n\
             #\n\
             # Where the app keeps its data (move it, e.g. to another disk):\n\
             #   APP_DATA_DIR={data}\n\
             #\n\
             # The desktop shell keeps logging to {logs}\n\
             PGLITE_DIR={pglite}\n\
             WORKSPACE_DIR={workspace}\n\
             WORKSPACE_TEMPLATE_DIR={template}\n\
             VENV_DIR={venv}\n",
            data = self.data.display(),
            logs = self.logs.display(),
            pglite = self.pglite.display(),
            workspace = self.workspace.display(),
            template = self.workspace_template.display(),
            venv = self.venv.display(),
        );
        fs::write(&self.config_file, template).map_err(|e| format!("could not write {}: {e}", self.config_file.display()))
    }

    /// Parse `config.env`: `KEY=value` / `# comment` / quoted values. Missing file → empty map.
    pub fn read_config(&self) -> Vec<(String, String)> {
        let Ok(text) = fs::read_to_string(&self.config_file) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let line = line.strip_prefix("export ").unwrap_or(line);
            let Some((key, value)) = line.split_once('=') else { continue };
            let key = key.trim();
            if key.is_empty() || !key.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') {
                continue;
            }
            let mut value = value.trim().to_string();
            if value.len() >= 2 && ((value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\''))) {
                value = value[1..value.len() - 1].to_string();
            } else if let Some(idx) = value.find(" #") {
                value.truncate(idx);
                value = value.trim().to_string();
            }
            out.push((key.to_string(), value));
        }
        out
    }

    pub fn write_runtime(&self, port: u16, pid: u32) {
        let body = serde_json::json!({ "port": port, "pid": pid, "startedAt": crate::now_ms() });
        let _ = fs::write(&self.runtime_file, serde_json::to_vec_pretty(&body).unwrap_or_default());
    }

    /// Read the live port from the runtime file (used by `scripts/minimalist-ai` and the tray).
    pub fn read_runtime_port(&self) -> Option<u16> {
        fs::read_to_string(&self.runtime_file)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|json| json.get("port").and_then(|p| p.as_u64()))
            .map(|p| p as u16)
    }

    /// True when the app server asked to be restarted (`POST /api/desktop {action:"restart"}`
    /// writes `restart: true` into the runtime file before exiting). Clears the request, so the
    /// flag can never make a later crash look intentional.
    pub fn take_restart_request(&self) -> bool {
        let Ok(text) = fs::read_to_string(&self.runtime_file) else { return false };
        let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
        if json.get("restart").and_then(|v| v.as_bool()) != Some(true) {
            return false;
        }
        if let Some(object) = json.as_object_mut() {
            object.remove("restart");
            object.remove("restartAt");
        }
        let _ = fs::write(&self.runtime_file, serde_json::to_vec_pretty(&json).unwrap_or_default());
        true
    }
}

/// Where the platform keeps per-app data when nothing else says otherwise.
fn convention_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME").ok().map(|h| PathBuf::from(h).join("Library").join("Application Support"));

    #[cfg(windows)]
    let base = std::env::var("APPDATA").ok().filter(|v| !v.is_empty()).map(PathBuf::from);

    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local").join("share")));

    base.map(|dir| dir.join(IDENTIFIER))
}

/// Locate the resources directory — the read-only half of the app: `appserver/`, `runtime/`,
/// `searxng/`, `workspace-template/`.
///
/// Inside a bundle, `resource_dir()` is exact: `/usr/lib/<name>` for deb/rpm, `${APPDIR}/usr/lib`
/// in an AppImage, `${exe_dir}/../Resources` in a .app, the executable's own directory on Windows.
/// Under `cargo run` nothing is bundled, so the candidates walk back to `src-tauri/resources` and
/// the caller finds the payload missing in exactly the place it wrote it.
fn resolve_resources(app: Option<&AppHandle>) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(app) = app {
        if let Ok(dir) = app.path().resource_dir() {
            candidates.push(dir.join("resources"));
            candidates.push(dir);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources"));
            candidates.push(dir.to_path_buf());
            // src-tauri/target/{debug,release}/minimalist-ai → src-tauri/resources
            candidates.push(dir.join("..").join("..").join("resources"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));

    for candidate in &candidates {
        if candidate.join("appserver").is_dir() || candidate.join("workspace-template").is_dir() {
            return candidate.canonicalize().unwrap_or_else(|_| candidate.clone());
        }
    }
    let fallback = candidates.pop().unwrap_or_else(|| PathBuf::from("resources"));
    logging::warn(&format!(
        "no bundled resources found (looked in {}); using {} if it exists",
        candidates.iter().map(|c| c.display().to_string()).collect::<Vec<_>>().join(", "),
        fallback.display()
    ));
    fallback
}

/// True when the window should be pointed at an already-running dev server instead of the bundled
/// app server. Defaults to "yes in debug builds", and `DESKTOP_MODE=dev|desktop` overrides it —
/// which is how a debug build can still be exercised against the real bundle.
pub fn is_dev() -> bool {
    match std::env::var("DESKTOP_MODE").ok().as_deref() {
        Some("desktop") | Some("release") => false,
        Some("dev") => true,
        _ => cfg!(debug_assertions),
    }
}

/// The port the dev server listens on (Next's default for `npm run dev -- -p 3100`).
pub fn dev_port() -> u16 {
    std::env::var("DESKTOP_DEV_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(3100)
}

pub fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}
