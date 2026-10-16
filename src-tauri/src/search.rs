//! The bundled SearXNG: no Docker, no service manager, no ports to configure.
//!
//! Started as `venv/bin/python -m granian --interface wsgi searx.webapp:app` — the same server
//! SearXNG's own container uses. Two details make this work from inside a read-only bundle:
//!
//!   * `python -m granian`, never `venv/bin/granian`: a venv's console scripts carry the absolute
//!     build-time path in their shebang and break the moment the bundle is installed elsewhere,
//!     while `-m` resolves everything from the interpreter's own location.
//!   * SearXNG's settings live in the *data* directory (copied from the bundled template, with a
//!     fresh secret per install) because the bundle itself may be read-only (AppImage) and would
//!     otherwise have to write into itself.
//!
//! Failure is never fatal: if no interpreter is found or the port stays silent, the app starts
//! anyway and the search adapter falls back to its keyless engines (src/lib/web.ts).

use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::child::Child;
use crate::layout::Layout;
use crate::logging;
use crate::net;

pub struct Search {
    pub child: Child,
    pub url: String,
    pub engine: String,
}

/// Candidate interpreters, most self-contained first. All are invoked with `-m granian`.
fn interpreter_candidates(layout: &Layout) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    // 1. the interpreter installed into the bundle by `npm run desktop:searxng`
    if layout.searxng_venv_python.exists() {
        out.push((layout.searxng_venv_python.clone(), "bundled venv".into()));
    }
    // 2. a relocatable CPython shipped with the bundle (used on systems without python3)
    if layout.searxng_python_bundled.exists() {
        out.push((layout.searxng_python_bundled.clone(), "bundled interpreter".into()));
    }
    // 3. whatever python the system has (Arch always has one)
    for name in ["python3", "python"] {
        if let Some(path) = which_path(name) {
            out.push((path, format!("system {name}")));
        }
    }
    out
}

/// `command -v`: first executable named `name` on PATH.
pub fn which_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in paths.split(separator) {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(name);
        if crate::layout::is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Write `<data>/searxng/settings.yml` from the bundle's template, with a stable random secret.
fn settings_file(layout: &Layout) -> Result<PathBuf, String> {
    let target = layout.searxng_data.join("settings.yml");
    if target.exists() {
        return Ok(target);
    }
    let template = std::fs::read_to_string(&layout.searxng_settings_template)
        .map_err(|e| format!("no searxng settings template ({}): {e}", layout.searxng_settings_template.display()))?;
    let secret = random_secret();
    let text = template.replace("REPLACED_AT_FIRST_RUN", &secret);
    std::fs::create_dir_all(&layout.searxng_data).map_err(|e| e.to_string())?;
    std::fs::write(&target, text).map_err(|e| format!("could not write {}: {e}", target.display()))?;
    logging::info(&format!("searxng settings written to {}", target.display()));
    Ok(target)
}

/// A secret with enough entropy for SearXNG's session signing, without pulling in rand.
fn random_secret() -> String {
    let mut out = String::with_capacity(64);
    let seed = format!("{}{}{}", crate::now_ms(), std::process::id(), std::env::var("HOME").unwrap_or_default());
    let mut state = 0x243F_6A88_85A3_08D3u64 ^ fnv1a(seed.as_bytes());
    for _ in 0..48 {
        // xorshift64*: fine for a per-install session key that never leaves the machine.
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let value = (state.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 56) as u8;
        out.push(char::from(b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(value as usize) % 62]));
    }
    out
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
}

/// Start SearXNG on a free port and wait until its JSON API answers.
///
/// `on_progress` is called with status lines for the splash window.
pub fn start(layout: &Layout, on_progress: &dyn Fn(&str)) -> Result<Search, String> {
    if !layout.searxng_src.join("searx").join("webapp.py").exists() {
        return Err(format!("SearXNG is not part of this build ({})", layout.searxng_src.display()));
    }
    let settings = settings_file(layout)?;
    let candidates = interpreter_candidates(layout);
    if candidates.is_empty() {
        return Err("no python interpreter found (install python3, or rebuild with a bundled one)".into());
    }

    let mut last_error = String::new();
    for (python, label) in candidates {
        on_progress(&format!("Starting search ({label})"));
        match try_start(layout, &python, &label, &settings) {
            Ok(search) => return Ok(search),
            Err(err) => {
                logging::warn(&format!("searxng via {label} did not start: {err}"));
                last_error = format!("{label}: {err}");
            }
        }
    }
    Err(last_error)
}

fn try_start(layout: &Layout, python: &PathBuf, label: &str, settings: &PathBuf) -> Result<Search, String> {
    let port = net::free_port().map_err(|e| e.to_string())?;
    let src = layout.searxng_src.display().to_string();
    let args = vec![
        "-m".to_string(),
        "granian".to_string(),
        "--interface".to_string(),
        "wsgi".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--workers".to_string(),
        // One worker: granian's WSGI worker count multiplies python memory for no benefit at the
        // query volume a single desktop app produces.
        "1".to_string(),
        "searx.webapp:app".to_string(),
    ];
    // No __pycache__ inside the (possibly read-only) bundle; no inherited proxies.
    let env = vec![
        ("PYTHONPATH".to_string(), src.clone()),
        ("PYTHONDONTWRITEBYTECODE".to_string(), "1".to_string()),
        ("PYTHONUNBUFFERED".to_string(), "1".to_string()),
        ("SEARXNG_SETTINGS_PATH".to_string(), settings.display().to_string()),
        ("SEARXNG_SECRET".to_string(), settings_file_secret(settings)),
        ("GRANIAN_BACKPRESSURE".to_string(), "8".to_string()),
    ];
    let child = Child::spawn(
        "searxng",
        python,
        &args,
        &env,
        Some(&layout.searxng_src),
        &[("HOME", layout.searxng_data.display().to_string())],
    )
    .map_err(|e| format!("spawn failed: {e}"))?;

    let url = format!("http://127.0.0.1:{port}");
    let health = format!("{url}/search?q=startup&format=json");
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if !child.is_running() {
            return Err("process exited during startup (see the log)".into());
        }
        if let Ok((200, body)) = net::http_get(&health, Duration::from_millis(1500)) {
            if body.contains("\"results\"") {
                logging::info(&format!("searxng ready on {url} ({label})"));
                return Ok(Search {
                    child,
                    url,
                    engine: label.to_string(),
                });
            }
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    let _ = child.stop(Duration::from_secs(3));
    Err("no JSON answer within 60s".into())
}

/// Search the settings file for the secret we generated, so the child gets the same one.
fn settings_file_secret(settings: &PathBuf) -> String {
    std::fs::read_to_string(settings)
        .ok()
        .and_then(|text| {
            text.lines()
                .find(|l| l.trim_start().starts_with("secret_key:"))
                .and_then(|l| l.split(':').nth(1))
                .map(|v| v.trim().trim_matches('"').to_string())
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(random_secret)
}

/// `xdg-open` (or `open` on macOS) for a path or a URL.
fn open_with_default(target: &str) {
    let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    match Command::new(program).arg(target).spawn() {
        Ok(_) => logging::info(&format!("opened {target}")),
        Err(e) => logging::warn(&format!("could not open {target}: {e}")),
    }
}

/// Open a folder or file with the desktop's default handler (tray's folder/log items).
pub fn open_path(path: &std::path::Path) {
    open_with_default(&path.display().to_string());
}

/// Open a URL in the user's browser (used when a second instance is launched).
pub fn open_url(url: &str) {
    open_with_default(url);
}
