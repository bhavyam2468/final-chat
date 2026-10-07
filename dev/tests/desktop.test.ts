/*
 * The desktop bridge, unit by unit: PATH lookup, the argv it builds for notifications, opening,
 * the clipboard and the summon window, how a window is recognised among a compositor's list, and
 * what the hotkey plan says per desktop.
 *
 * Nothing here runs a process or touches a session: every input is passed in, which is exactly why
 * these are pure functions in the first place. Whether the machine really has notify-send, and
 * whether a window really opens, is checked in dev/desktop-e2e.mjs.
 */
import {
  clipboardArgv, describe, findBin, findBrowser, hotkeyPlan, notifyArgv, openArgv, pickSummon,
  sessionInfo, summonArgv, APP_NAME, SUMMON_TITLE,
} from "../../src/lib/os-bridge.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, diag?: unknown) => {
  if (cond) { pass++; console.log("ok  ", name); }
  else { fail++; console.log("FAIL", name, diag === undefined ? "" : `→ ${typeof diag === "string" ? diag : JSON.stringify(diag).slice(0, 300)}`); }
};

// ---------------------------------------------------------------- PATH lookup
const probe = (existing: string[]) => (p: string) => existing.includes(p);
ok("findBin finds the first match in PATH order", findBin(["notify-send"], "/usr/bin:/opt/bin", probe(["/opt/bin/notify-send"])) === "/opt/bin/notify-send");
ok("findBin prefers the earlier name", findBin(["wl-copy", "xclip"], "/usr/bin", probe(["/usr/bin/wl-copy", "/usr/bin/xclip"])) === "/usr/bin/wl-copy");
ok("findBin is null when nothing matches", findBin(["nope"], "/usr/bin", probe([])) === null);
ok("findBin ignores empty PATH entries", findBin(["ls"], ":/bin", probe(["/bin/ls"])) === "/bin/ls");

// ---------------------------------------------------------------- notifications
const linux = notifyArgv("linux", "/usr/bin/notify-send", { title: "Done", body: "3 files", urgency: "critical" });
ok("linux notify uses notify-send with the app name", linux?.cmd === "/usr/bin/notify-send" && linux.args.includes(APP_NAME), linux);
ok("linux notify keeps the urgency", linux?.args.includes("critical") === true, linux?.args);
ok("a bogus urgency falls back to normal", notifyArgv("linux", "/usr/bin/notify-send", { title: "x", urgency: "whenever" })?.args.includes("normal") === true);
const kdialog = notifyArgv("linux", "/usr/bin/kdialog", { title: "Hi", body: "there" });
ok("kdialog gets its own shape", kdialog?.args[0] === "--passivepopup" && kdialog.args.includes("--title"), kdialog);
ok("no tool means no argv", notifyArgv("linux", null, { title: "x" }) === null);
const mac = notifyArgv("darwin", "/usr/bin/osascript", { title: 'He said "hi"', body: "it's fine" });
ok("macOS escapes quotes for AppleScript", mac?.cmd === "osascript" && mac.args[1].includes('\\"hi\\"'), mac?.args[1]);
const win = notifyArgv("win32", "powershell", { title: "It's done", body: "ok" });
ok("Windows doubles apostrophes for PowerShell", win?.cmd === "powershell" && win.args[2].includes("'It''s done'"), win?.args[2]);

// ---------------------------------------------------------------- open + clipboard
ok("open uses the Linux tool with the target", openArgv("linux", "/usr/bin/xdg-open", "/tmp/a.pdf")?.args[0] === "/tmp/a.pdf");
ok("open without a tool is null on Linux", openArgv("linux", null, "/tmp/a.pdf") === null);
ok("open on Windows goes through cmd start", openArgv("win32", null, "C:\\a.pdf")?.args[0] === "/c");
const wl = clipboardArgv("linux", "/usr/bin/wl-copy", "hello");
ok("wl-copy takes the text on stdin", wl?.args.length === 0 && wl.input === "hello", wl);
const xc = clipboardArgv("linux", "/usr/bin/xclip", "hello");
ok("xclip holds the selection for one paste", xc?.args.join(" ") === "-selection clipboard -loops 1" && xc.input === "hello", xc);
ok("xsel uses -ib", clipboardArgv("linux", "/usr/bin/xsel", "hi")?.args[0] === "-ib");
ok("pbcopy takes stdin too", clipboardArgv("darwin", "/usr/bin/pbcopy", "hi")?.input === "hi");
ok("no clipboard tool is null", clipboardArgv("linux", null, "hi") === null);

// ---------------------------------------------------------------- summon
const argv = summonArgv("http://localhost:3000/summon");
ok("the summon window is an app window, not a tab", argv[0] === "--app=http://localhost:3000/summon", argv[0]);
ok("it carries a class the compositor can match", argv.includes("--class=minimalist-chat"), argv);
ok("it opens at the summon size", argv.includes("--window-size=620,320"), argv);
ok("a browser is found by name", findBrowser(() => "/usr/bin/chromium") === "/usr/bin/chromium");
ok("no browser is null", findBrowser(() => null) === null);

// ---------------------------------------------------------------- windows the compositor reports
const rows = [
  { id: 3, title: "firefox", class: "firefox" },
  { id: 9, title: `${SUMMON_TITLE}`, class: "Google-chrome" },
];
ok("the summon window is recognised by title", pickSummon(rows) === "9", pickSummon(rows));
ok("…and by class alone", pickSummon([{ id: "0xab", title: "whatever", class: "minimalist-chat" }]) === "0xab");
ok("an unrelated list yields null", pickSummon([{ id: 1, title: "Notes", class: "gnome-text-editor" }]) === null);

// ---------------------------------------------------------------- hotkeys per desktop
const niri = hotkeyPlan("minimalist-chat", { XDG_CURRENT_DESKTOP: "niri", WAYLAND_DISPLAY: "wayland-1" } as NodeJS.ProcessEnv);
ok("niri gets a binds block in config.kdl", niri.de === "niri" && niri.file?.endsWith(".config/niri/config.kdl") === true, niri);
ok("…that spawns the launcher", niri.snippet.includes(`spawn "minimalist-chat" summon`), niri.snippet);
const hypr = hotkeyPlan("minimalist-chat", { XDG_CURRENT_DESKTOP: "Hyprland", WAYLAND_DISPLAY: "wayland-1" } as NodeJS.ProcessEnv);
ok("hyprland gets a bind line", hypr.snippet.startsWith("bind = SUPER SHIFT"), hypr.snippet);
const sway = hotkeyPlan("minimalist-chat", { XDG_CURRENT_DESKTOP: "sway", WAYLAND_DISPLAY: "wayland-1" } as NodeJS.ProcessEnv);
ok("sway gets a bindsym", sway.snippet.startsWith("bindsym $mod+Shift+space"), sway.snippet);
const gnome = hotkeyPlan("minimalist-chat", { XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" } as NodeJS.ProcessEnv);
ok("gnome gets the four gsettings lines", gnome.snippet.split("\n").length === 4 && gnome.snippet.includes("custom-keybinding"), gnome.snippet.split("\n").length);
ok("kde is told what to paste, not told a file", hotkeyPlan("minimalist-chat", { XDG_CURRENT_DESKTOP: "KDE" } as NodeJS.ProcessEnv).file === null);
ok("an unknown desktop still gets a command", hotkeyPlan("minimalist-chat", {} as NodeJS.ProcessEnv).snippet.includes("minimalist-chat summon"));

// ---------------------------------------------------------------- session + describe
ok("wayland is detected from the session", sessionInfo({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "niri" } as NodeJS.ProcessEnv).type === "wayland");
ok("x11 is detected from DISPLAY", sessionInfo({ DISPLAY: ":0", XDG_CURRENT_DESKTOP: "XFCE" } as NodeJS.ProcessEnv).type === "x11");
ok("a headless box says none", sessionInfo({} as NodeJS.ProcessEnv).type === "none");
ok("kde names are normalised", sessionInfo({ XDG_CURRENT_DESKTOP: "KDE" } as NodeJS.ProcessEnv).de === "kde");
const d = describe();
ok("describe() carries the plan the CLI needs", !!d.app?.url && Array.isArray(d.app.argv || []) && !!d.hotkey?.snippet && !!d.tools, Object.keys(d));
ok("…and the summon url", d.app.url.endsWith("/summon"), d.app.url);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
