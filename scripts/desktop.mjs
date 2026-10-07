#!/usr/bin/env node
/*
 * The desktop side of the workspace: summon its window, ask a question from anywhere, bind a
 * hotkey. It only talks to the app's HTTP API — the desktop layer never drives the app's UI, so it
 * keeps working while the UI changes and works the same on a phone or a script.
 *
 *   minimalist-chat summon            focus the summon window, or open one
 *   minimalist-chat ask "…"           one question, streamed to the terminal
 *   minimalist-chat hotkey [--write]  what to bind, and (with --write) write it
 *   minimalist-chat desktop           what this machine can do (tools, browser, session)
 *
 * Called by scripts/minimalist-chat, which starts the service first.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFromFile = (k) => { try { return (fs.readFileSync(path.join(APP, ".env"), "utf8").match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1].trim(); } catch { return ""; } };
const PORT = envFromFile("PORT") || process.env.PORT || "3000";
const BASE = `http://localhost:${PORT}`;
const argv = process.argv.slice(2);
const cmd = argv[0] || "status";
const rest = argv.slice(1);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const words = rest.filter((a) => !a.startsWith("--"));

const say = (...a) => console.log(...a);
const die = (msg) => { console.error(msg); process.exit(1); };

async function api(pathname, init) {
  const res = await fetch(BASE + pathname, init).catch(() => null);
  if (!res) die(`The workspace is not answering on ${BASE}. Start it with: minimalist-chat start`);
  return res;
}
const json = async (pathname, init) => (await api(pathname, init)).json().catch(() => ({}));
const post = (body) => json("/api/os", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** One question, streamed. The chat is a normal conversation, so it is in the app afterwards. */
async function ask() {
  const q = words.join(" ").trim();
  if (!q) {
    const piped = fs.readFileSync(0, "utf8").trim(); // `echo "…" | minimalist-chat ask`
    if (!piped) die('Usage: minimalist-chat ask "your question" [--notify] [--open]');
    return send(piped);
  }
  return send(q);
}

async function send(content) {
  const ac = new AbortController();
  const onSig = () => { ac.abort(); void post({ action: "notify", title: "Stopped", body: "The ask was stopped.", urgency: "low" }); process.exit(130); };
  process.once("SIGINT", onSig);
  let conv = null, text = "";
  let res;
  try {
    res = await fetch(BASE + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ conversationId: null, parentId: null, mode: "general", user: { content } }),
    });
  } catch { die(`The workspace is not answering on ${BASE}.`); }
  if (!res.ok || !res.body) die(`The app answered ${res.status}: ${await res.text().catch(() => "")}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.t === "meta") conv = e.conversationId;
      else if (e.t === "text") { text += e.d; process.stdout.write(e.d); }
      else if (e.t === "retext") { text = e.text; process.stdout.write(`\n${e.text}`); }
      else if (e.t === "toolStart" && !flags.has("--quiet")) process.stderr.write(`\n· ${e.name}\n`);
      else if (e.t === "error") process.stderr.write(`\n! ${e.text}\n`);
    }
  }
  process.removeListener("SIGINT", onSig);
  process.stdout.write("\n");
  if (conv) process.stderr.write(`\nchat: ${BASE}/?chat=${conv}\n`);
  if (flags.has("--notify")) {
    const line = text.replace(/[#*`>_\n]+/g, " ").trim().slice(0, 160);
    await post({ action: "notify", title: "Workspace", body: line || "Answer ready" });
  }
  if (flags.has("--open") && conv) await post({ action: "open", path: `${BASE}/?chat=${conv}` });
  return conv;
}

async function summon() {
  const r = await post({ action: "summon" });
  if (!r.ok) die(r.error || "Could not open the summon window.");
  say(r.how === "focused" ? "Summon window focused." : r.how === "opened" ? "Opened the ask page in your browser." : "Summon window opened.");
}

async function hotkey() {
  const d = await json("/api/os");
  const hk = d.hotkey || {};
  if (!flags.has("--write")) {
    say(`${hk.how || ""}\n`);
    say(hk.file ? `${hk.file}:\n${hk.snippet}` : hk.snippet);
    return;
  }
  if (!hk.file) die(`Nothing to write for ${hk.de || "this desktop"} — set it up by hand:\n\n${hk.snippet}\n${hk.how || ""}`);
  const file = hk.file.replace(/^~/, os.homedir());
  if (!fs.existsSync(file)) die(`No config file at ${file} — create it first, then add:\n\n${hk.snippet}`);
  const body = fs.readFileSync(file, "utf8");
  if (body.includes("minimalist-chat")) { say(`${file} already mentions minimalist-chat — leaving it alone.`); return; }
  const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(file, bak);
  const marker = "// minimalist-chat: summon the assistant (added by `minimalist-chat hotkey --write`)";
  const line = (hk.snippet.match(/^(.*\{.*spawn.*|bind.*|bindsym.*)$/m) || [])[1] || hk.snippet;
  let next;
  if (/^binds\s*\{/m.test(body)) next = body.replace(/^(binds\s*\{[^\n]*\n)/m, `$1    ${line}\n${marker}\n`);
  else next = `${body.replace(/\s*$/, "")}\n\n${marker}\n${hk.snippet}\n`;
  fs.writeFileSync(file, next);
  say(`Wrote ${file} (backup: ${bak}).\n${hk.how || ""}`);
}

async function status() {
  const d = await json("/api/os");
  if (!d.ok) die(d.error || "The desktop bridge is off (HOST_ACCESS=off).");
  say(`app        ${d.name} — ${d.app?.url}`);
  say(`platform   ${d.platform} · ${d.session?.type}${d.session?.de && d.session.de !== "unknown" ? " · " + d.session.de : ""}`);
  say(`notify     ${d.tools?.notify || "—"}${d.tools?.notify ? "" : "  (install libnotify-bin / notify-send)"}`);
  say(`open       ${d.tools?.open || "—"}`);
  say(`clipboard  ${d.tools?.clipboard || "—"}`);
  say(`browser    ${d.tools?.browser ? `${d.tools.browser} (app window)` : "—  (install Chrome/Chromium for a window, otherwise the default browser opens a tab)"}`);
  say(`hotkey     ${d.hotkey?.de === "unknown" ? "add a shortcut running `minimalist-chat summon`" : `${d.hotkey?.de} — \`minimalist-chat hotkey\``}`);
}

const table = { summon, ask, hotkey, status, desktop: status };
if (!table[cmd]) die(`Usage: minimalist-chat [summon|ask "…"|hotkey [--write]|desktop]`);
await table[cmd]();
