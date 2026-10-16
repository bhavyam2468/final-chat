//! "Start at login" without a plugin.
//!
//! Linux (this build): an XDG autostart entry in `~/.config/autostart`. The executable path is
//! taken from `$APPIMAGE` when the app runs as an AppImage — `current_exe()` would point inside
//! the transient mount and stop working after the next launch.

use std::path::PathBuf;

use crate::logging;

const ENTRY_NAME: &str = "dev.bhavyam.minimalist-ai.desktop";

#[cfg(target_os = "linux")]
fn entry_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".config").join("autostart").join(ENTRY_NAME))
}

/// macOS and Windows are future work: both have their own login-item mechanisms (LaunchAgent /
/// registry Run key) and neither is a plain file in `~/.config`. Report "not available" rather
/// than writing an XDG entry that nothing reads.
#[cfg(not(target_os = "linux"))]
fn entry_path() -> Option<PathBuf> {
    None
}

/// The command that should be started at login.
fn exec_command() -> std::io::Result<String> {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            return Ok(appimage);
        }
    }
    Ok(std::env::current_exe()?.display().to_string())
}

pub fn is_enabled() -> bool {
    entry_path().map(|p| p.exists()).unwrap_or(false)
}

/// False where the tray item should be hidden instead of offered.
pub fn is_supported() -> bool {
    entry_path().is_some()
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let Some(path) = entry_path() else {
        return Err("no HOME directory".into());
    };
    if !enabled {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        }
        logging::info("autostart disabled");
        return Ok(());
    }
    let exec = exec_command().map_err(|e| format!("cannot determine the executable path: {e}"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    // `--background`: start hidden in the tray and open the window only when the user asks. The
    // shell reads the flag itself; Tauri ignores unknown arguments.
    // Desktop-entry `Exec` values are split on spaces, so a path with spaces has to be quoted
    // (backslashes and quotes inside it are escaped the way the spec says).
    let quoted = format!("\"{}\"", exec.replace('\\', "\\\\").replace('"', "\\\""));
    let body = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name=Minimalist AI Workspace\n\
         Comment=Local AI workspace\n\
         Exec={quoted} --background\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n\
         Categories=Utility;Development;\n"
    );
    std::fs::write(&path, body).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    logging::info(&format!("autostart enabled ({})", path.display()));
    Ok(())
}
