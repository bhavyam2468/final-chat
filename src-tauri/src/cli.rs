//! Command line: small on purpose. The app is a GUI; these flags exist for the login autostart
//! entry, for people who keep several data directories, and for scripted checks.

use std::path::PathBuf;

const USAGE: &str = "\
Minimalist AI Workspace

Usage: minimalist-ai [options]

Options:
  --data-dir <path>   Use <path> for conversations, workspace and logs
                      (default: the platform app-data directory)
  --port <port>       App server port (default: a free port chosen at launch)
  --background        Start without showing the window (used by Start at login)
  --version, -V       Print the version and exit
  --help, -h          Print this help and exit
";

#[derive(Debug, Default)]
pub struct Cli {
    pub data_dir: Option<PathBuf>,
    pub port: Option<u16>,
    pub background: bool,
    pub version: bool,
    pub help: bool,
}

/// Parse `args` (including argv[0]). Unknown flags are ignored: the same command line is handed
/// to WebKit and to Tauri, which have their own flags to look at.
pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Cli {
    let mut cli = Cli::default();
    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) => (f.to_string(), Some(v.to_string())),
            None => (arg.clone(), None),
        };
        let mut take_value = |iter: &mut dyn Iterator<Item = String>| inline.clone().or_else(|| iter.next());
        match flag.as_str() {
            "--data-dir" | "--datadir" => cli.data_dir = take_value(&mut iter).map(PathBuf::from),
            "--port" => cli.port = take_value(&mut iter).and_then(|v| v.parse().ok()),
            "--background" | "--hidden" => cli.background = true,
            "--version" | "-V" => cli.version = true,
            "--help" | "-h" => cli.help = true,
            _ => {}
        }
    }
    cli
}

impl Cli {
    /// Flags that change process-wide environment used by `Layout::resolve`.
    pub fn apply_env(&self) {
        if let Some(dir) = &self.data_dir {
            std::env::set_var("APP_DATA_DIR", dir);
        }
        if let Some(port) = self.port {
            std::env::set_var("DESKTOP_APP_PORT", port.to_string());
        }
        if self.background {
            std::env::set_var("DESKTOP_BACKGROUND", "1");
        }
    }

    pub fn print_help() {
        print!("{USAGE}");
    }
}
