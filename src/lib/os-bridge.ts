import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

/**
 * The desktop bridge: the few things the app does on the user's own machine — a notification, a
 * file opened in its real app, the clipboard, and the summon window.
 *
 * Every call is a fixed argv, never a shell string, because these run outside the sandbox on
 * purpose. One path serves every caller: the AI's os_notify tool, /api/os, the palette's Summon
 * command and the desktop CLI (scripts/desktop.mjs, which only asks /api/os what to run).
 * HOST_ACCESS=off (hostLocked) switches the whole bridge off — a hosted deployment has no user
 * session to talk to, and a container's notifications would go nowhere.
 */

export const APP_NAME = "Minimalist AI Workspace";
/** the summon window's page title, and how a running one is recognised */
export const SUMMON_TITLE = "Ask · Workspace";
const DEFAULT_SIZE = "620,320";

const executable = (p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };

/** First of `names` found in PATH. Takes the PATH string and a probe so it stays testable. */
export function findBin(names: string[], pathEnv = process.env.PATH || "", probe: (p: string) => boolean = executable): string | null {
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const n of names) for (const d of dirs) { if (!n.includes(path.sep)) { const p = path.join(d, n); if (probe(p)) return p; } }
  return null;
}

export type SessionInfo = {
  platform: string;
  /** wayland | x11 | none — decides which clipboard and focus tools make sense */
  type: "wayland" | "x11" | "none";
  /** the desktop/session name as the session reports it (niri, Hyprland, GNOME, KDE…) */
  de: string;
  display: string | null;
};

export function sessionInfo(env: NodeJS.ProcessEnv = process.env): SessionInfo {
  const raw = `${env.XDG_CURRENT_DESKTOP || ""} ${env.DESKTOP_SESSION || ""} ${env.XDG_SESSION_DESKTOP || ""}`.toLowerCase();
  const de = ["niri", "hyprland", "sway", "gnome", "kde", "plasma", "xfce", "cinnamon", "mate", "i3", "openbox"].find((d) => raw.includes(d)) || raw.trim().split(/[:;\s]+/)[0] || "unknown";
  const type = env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : env.XDG_SESSION_TYPE === "wayland" ? "wayland" : env.XDG_SESSION_TYPE === "x11" ? "x11" : "none";
  return { platform: process.platform, type, de: de === "plasma" ? "kde" : de, display: env.WAYLAND_DISPLAY || env.DISPLAY || null };
}

export type OsTools = { notify: string | null; open: string | null; clipboard: string | null; session: SessionInfo };

/** What this machine can actually do, cached for the process: PATH probing is cheap but not free. */
let cached: OsTools | null = null;
export function tools(): OsTools {
  if (cached) return cached;
  const s = sessionInfo();
  const find = (n: string[]) => findBin(n);
  if (s.platform === "darwin") cached = { notify: find(["osascript"]), open: find(["open"]), clipboard: find(["pbcopy"]), session: s };
  else if (s.platform === "win32") cached = { notify: find(["powershell"]), open: null, clipboard: find(["clip"]), session: s };
  else {
    // wl-copy only works under Wayland and xclip only under X11; prefer the one this session can use
    const clip = s.type === "wayland" ? find(["wl-copy", "xclip", "xsel"]) : find(["xclip", "xsel", "wl-copy"]);
    cached = { notify: find(["notify-send", "kdialog"]), open: find(["xdg-open"]), clipboard: clip, session: s };
  }
  return cached;
}

// ---------------------------------------------------------------- argv builders (pure)

const appleStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const psStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

function winToast(title: string, body: string) {
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null",
    "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    `$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode(${psStr(title)})) > $null; $x.Item(1).AppendChild($t.CreateTextNode(${psStr(body)})) > $null`,
    "$n = [Windows.UI.Notifications.ToastNotification]::new($t)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psStr(APP_NAME)}).Show($n)`,
  ].join("; ");
}

export type Argv = { cmd: string; args: string[] };

export function notifyArgv(platform: string, tool: string | null, n: { title: string; body?: string; urgency?: string }): Argv | null {
  if (!tool) return null;
  const title = n.title || APP_NAME;
  const body = n.body || "";
  const urgency = ["low", "normal", "critical"].includes(n.urgency || "") ? n.urgency! : "normal";
  if (platform === "darwin") return { cmd: "osascript", args: ["-e", `display notification ${appleStr(body)} with title ${appleStr(title)}`] };
  if (platform === "win32") return { cmd: "powershell", args: ["-NoProfile", "-Command", winToast(title, body)] };
  if (tool.endsWith("kdialog")) return { cmd: tool, args: ["--passivepopup", body || title, "8", "--title", title] };
  return { cmd: tool, args: ["-a", APP_NAME, "-u", urgency, "-t", "8000", title, body] };
}

export function openArgv(platform: string, tool: string | null, target: string): Argv | null {
  if (platform === "darwin") return tool ? { cmd: tool, args: [target] } : null;
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", target] };
  return tool ? { cmd: tool, args: [target] } : null;
}

export function clipboardArgv(platform: string, tool: string | null, text: string): (Argv & { input: string }) | null {
  if (!tool) return null;
  if (platform === "darwin") return { cmd: tool, args: [], input: text };
  if (platform === "win32") return { cmd: tool, args: [], input: text };
  if (tool.endsWith("wl-copy")) return { cmd: tool, args: [], input: text };
  if (tool.endsWith("xclip")) return { cmd: tool, args: ["-selection", "clipboard", "-loops", "1"], input: text };
  return { cmd: tool, args: ["-ib"], input: text }; // xsel
}

/** Chrome/Chromium app window: no tabs, no URL bar — a desktop window, not a browser. */
export function summonArgv(url: string, size = DEFAULT_SIZE): string[] {
  return [`--app=${url}`, "--class=minimalist-chat", `--window-size=${size}`, "--no-first-run", "--no-default-browser-check"];
}

export function findBrowser(find: (n: string[]) => string | null = (n) => findBin(n)): string | null {
  return find(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "vivaldi", "chrome"]);
}

/** The window a compositor reports, as far as matching needs to know. */
export type WinRow = { id: string | number; title?: string; class?: string };

/** Id of the summon window among `rows`, or null. Pure: the JSON/list parsers feed it. */
export function pickSummon(rows: WinRow[], prefix = SUMMON_TITLE.split(" ·")[0] + " ·"): string | null {
  for (const r of rows) {
    const t = r.title || "";
    const c = r.class || "";
    if ((t.startsWith(prefix) || t.includes("Workspace") && t.startsWith("Ask")) || c === "minimalist-chat") return String(r.id);
  }
  return null;
}

export type HotkeyPlan = { de: string; file: string | null; snippet: string; how: string };

/** How this desktop binds a global hotkey. Snippets are literal config; `how` is what to do by hand. */
export function hotkeyPlan(bin = "minimalist-chat", env: NodeJS.ProcessEnv = process.env, find: (n: string[]) => string | null = (n) => findBin(n)): HotkeyPlan {
  const home = os.homedir();
  const s = sessionInfo(env);
  const has = (n: string) => !!find([n]);
  const de = s.de === "unknown" ? (has("hyprctl") ? "hyprland" : has("niri") ? "niri" : has("swaymsg") ? "sway" : "unknown") : s.de;
  const spawn = `"${bin}" summon`;
  if (de === "niri")
    return {
      de, file: path.join(home, ".config/niri/config.kdl"),
      snippet: `binds {\n    Mod+Shift+Space { spawn ${spawn}; }\n}`,
      how: "Niri reads binds from ~/.config/niri/config.kdl; `niri msg action do-screen-transition` style reload happens on save (or run `niri validate`).",
    };
  if (de === "hyprland")
    return { de, file: path.join(home, ".config/hypr/hyprland.conf"), snippet: `bind = SUPER SHIFT, SPACE, exec, ${bin} summon`, how: "Append the line to ~/.config/hypr/hyprland.conf; Hyprland reloads it on save." };
  if (de === "sway")
    return { de, file: path.join(home, ".config/sway/config"), snippet: `bindsym $mod+Shift+space exec ${bin} summon`, how: "Append the line to ~/.config/sway/config, then `swaymsg reload`." };
  if (de === "gnome")
    return {
      de, file: null,
      snippet: [
        `gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/summon/']"`,
        `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/summon/ name 'Summon workspace'`,
        `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/summon/ command '${bin} summon'`,
        `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/summon/ binding '<Super><Shift>space'`,
      ].join("\n"),
      how: "Run these four gsettings lines (Settings → Keyboard → Custom Shortcuts shows the result).",
    };
  if (de === "kde")
    return { de, file: null, snippet: `Command: ${bin} summon\nKey: Meta+Shift+Space`, how: "System Settings → Shortcuts → Add → Command, paste the command, bind Meta+Shift+Space." };
  return {
    de, file: null,
    snippet: `Mod+Shift+Space → ${bin} summon`,
    how: "Your desktop did not identify itself. Add a shortcut in its settings that runs `minimalist-chat summon` (X11: `setup.sh` can use wmctrl/xdotool to focus an existing window).",
  };
}

// ---------------------------------------------------------------- running

export type OsResult = { ok: boolean; error?: string; out?: string };

function run(cmd: string, args: string[], o: { input?: string; timeout?: number } = {}): Promise<OsResult> {
  return new Promise((res) => {
    let out = "";
    let done = false;
    const p = spawn(cmd, args, { env: process.env, stdio: [o.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* already gone */ } }, o.timeout ?? 6000);
    const cap = (d: Buffer) => { if (out.length < 4000) out += d.toString(); };
    p.stdout?.on("data", cap); p.stderr?.on("data", cap);
    if (o.input !== undefined) { p.stdin?.write(o.input); p.stdin?.end(); }
    p.on("error", (e) => { if (done) return; done = true; clearTimeout(t); res({ ok: false, error: e.message }); });
    p.on("close", (code) => { if (done) return; done = true; clearTimeout(t); res(code === 0 ? { ok: true, out: out.trim() } : { ok: false, error: out.trim() || `exit ${code}`, out: out.trim() }); });
  });
}

/** Detached: opening a file or a window must not keep the request (or the app) waiting on another program. */
function launch(cmd: string, args: string[]): OsResult {
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function notify(title: string, body = "", urgency = "normal"): Promise<OsResult> {
  const argv = notifyArgv(process.platform, tools().notify, { title, body, urgency });
  if (!argv) return { ok: false, error: "No notification tool on this machine (looked for notify-send and kdialog)." };
  return run(argv.cmd, argv.args);
}

export async function openPath(target: string): Promise<OsResult> {
  const argv = openArgv(process.platform, tools().open, target);
  if (!argv) return { ok: false, error: process.platform === "linux" ? "xdg-open is not installed." : "Cannot open files on this platform." };
  if (!/^(https?:|mailto:|file:)/i.test(target) && !fs.existsSync(target)) return { ok: false, error: `Nothing at ${target}` };
  return launch(argv.cmd, argv.args);
}

export async function copyText(text: string): Promise<OsResult> {
  const argv = clipboardArgv(process.platform, tools().clipboard, text);
  if (!argv) return { ok: false, error: "No clipboard tool (wl-copy, xclip, xsel, pbcopy or clip)." };
  return run(argv.cmd, argv.args, { input: argv.input, timeout: 4000 });
}

/** Is a summon window already open? (Chrome's command line is the only handle a window leaves.) */
async function summonRunning(url: string) {
  const r = await run("pgrep", ["-f", `app=${url}`], { timeout: 3000 });
  return r.ok;
}

/** Focus the window the compositor knows about, when the session exposes one. */
async function focusSummon(): Promise<OsResult> {
  const j = async (cmd: string, args: string[]) => { const r = await run(cmd, args, { timeout: 3000 }); return r.ok ? r.out || "" : ""; };
  const s = tools().session;
  if (s.de === "niri" || findBin(["niri"])) {
    const out = await j("niri", ["msg", "--json", "windows"]);
    if (out) {
      try {
        const rows = (JSON.parse(out) as { id: number; title?: string; app_id?: string }[]).map((w) => ({ id: w.id, title: w.title, class: w.app_id }));
        const id = pickSummon(rows);
        if (id) return run("niri", ["msg", "action", "focus-window", "--id", id], { timeout: 3000 });
      } catch { /* not our JSON */ }
    }
  }
  if (s.de === "hyprland" || findBin(["hyprctl"])) {
    const out = await j("hyprctl", ["clients", "-j"]);
    if (out) { try { const rows = (JSON.parse(out) as { address: string; title?: string; class?: string }[]).map((w) => ({ id: w.address, title: w.title, class: w.class })); const id = pickSummon(rows); if (id) return run("hyprctl", ["dispatch", "focuswindow", `address:${id}`], { timeout: 3000 }); } catch { /* not our JSON */ } }
  }
  const wm = findBin(["wmctrl"]);
  if (wm) {
    const out = await j(wm, ["-l"]);
    const row = out.split("\n").map((l) => l.trim()).find((l) => l.includes("Ask ·"));
    if (row) return run(wm, ["-ia", row.split(/\s+/)[0]], { timeout: 3000 });
  }
  const xdo = findBin(["xdotool"]);
  if (xdo) {
    const out = await j(xdo, ["search", "--name", "Ask ·"]);
    const id = out.split("\n").filter(Boolean).pop();
    if (id) return run(xdo, ["windowactivate", id], { timeout: 3000 });
  }
  return { ok: false, error: "no window tool" };
}

/**
 * The summon button: focus the window if one is open, else open one as an app window (Chrome,
 * Chromium, Brave, Edge), else hand the page to the desktop's default browser.
 */
export async function summon(port = process.env.PORT || "3000"): Promise<OsResult & { how?: string }> {
  const url = `http://localhost:${port}/summon`;
  if (await summonRunning(url)) {
    const f = await focusSummon();
    if (f.ok) return { ok: true, how: "focused" };
  }
  const browser = findBrowser();
  if (browser) {
    const r = launch(browser, summonArgv(url));
    return r.ok ? { ok: true, how: "launched" } : r;
  }
  const t = tools();
  if (t.open) { const r = launch(t.open, [url]); return r.ok ? { ok: true, how: "opened" } : r; }
  return { ok: false, error: "No browser to open a summon window with. Install Chrome/Chromium, or use /summon inside the app." };
}

/** Everything a caller (the CLI, the palette, the settings page) needs to describe the desktop layer. */
export function describe() {
  const t = tools();
  const summonUrl = `http://localhost:${process.env.PORT || "3000"}/summon`;
  const browser = findBrowser();
  return {
    platform: process.platform,
    session: t.session,
    tools: { notify: t.notify, open: t.open, clipboard: t.clipboard, browser },
    app: { name: APP_NAME, title: SUMMON_TITLE, url: summonUrl, argv: browser ? [browser, ...summonArgv(summonUrl)] : null },
    hotkey: hotkeyPlan(),
  };
}
