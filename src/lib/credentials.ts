import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { HOME } from "./workspace";
import { hostLocked, type Settings } from "./settings";

/**
 * Credential resolution for MCP servers and skills: app secret → environment → the user's native CLI logins.
 * Native logins (gh, huggingface, …) are only read when the user granted host access (home files or host
 * terminal), so a sandboxed/hosted install never touches the machine's credentials.
 */
type Detector = { names: string[]; label: string; read: () => string };
const run = (cmd: string, args: string[]) => { try { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 4000 }); return r.status === 0 ? r.stdout.trim() : ""; } catch { return ""; } };
const file = (p: string) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return ""; } };

const DETECTORS: Detector[] = [
  { names: ["GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN", "GH_TOKEN"], label: "gh CLI", read: () => run("gh", ["auth", "token"]) },
  { names: ["GITLAB_TOKEN", "GITLAB_PERSONAL_ACCESS_TOKEN"], label: "glab CLI", read: () => (run("glab", ["auth", "status", "-t"]).match(/Token:\s*(\S+)/)?.[1] || "") },
  { names: ["HF_TOKEN", "HUGGINGFACE_TOKEN"], label: "huggingface-cli", read: () => file(path.join(HOME, ".cache/huggingface/token")) },
  { names: ["NPM_TOKEN"], label: "~/.npmrc", read: () => file(path.join(HOME, ".npmrc")).match(/_authToken=(\S+)/)?.[1] || "" },
];

export const nativeAllowed = (st: Settings) => !hostLocked() && (st.terminal === "host" || st.access !== "sandbox");

const cache = new Map<string, { v: string; at: number }>();
function detect(d: Detector) {
  const c = cache.get(d.label);
  if (c && Date.now() - c.at < 120_000) return c.v;
  const v = d.read();
  cache.set(d.label, { v, at: Date.now() });
  return v;
}

export type CredSource = "secret" | "env" | string;
/** Resolve one variable. Returns value and where it came from. */
export function resolveVar(st: Settings, name: string): { value: string; source: CredSource } | null {
  if (st.secrets?.[name]) return { value: st.secrets[name], source: "secret" };
  if (process.env[name]) return { value: process.env[name]!, source: "env" };
  if (nativeAllowed(st)) for (const d of DETECTORS) if (d.names.includes(name)) { const v = detect(d); if (v) return { value: v, source: d.label }; }
  // aliases: a GITHUB_TOKEN secret also satisfies GITHUB_PERSONAL_ACCESS_TOKEN, etc.
  for (const d of DETECTORS) if (d.names.includes(name)) for (const alt of d.names) if (alt !== name && (st.secrets?.[alt] || process.env[alt])) return { value: st.secrets?.[alt] || process.env[alt]!, source: st.secrets?.[alt] ? "secret" : "env" };
  return null;
}

/** Variables for ${NAME} expansion in MCP configs. */
export function varsFor(st: Settings, names: string[]) {
  const out: Record<string, string> = { ...st.secrets };
  for (const n of names) { const r = resolveVar(st, n); if (r) out[n] = r.value; }
  return out;
}

/** Status for UI badges (no values). */
export function credStatus(st: Settings, names: string[]) {
  return Object.fromEntries(names.map((n) => [n, resolveVar(st, n)?.source || null]));
}

export const varsIn = (x: unknown): string[] => [...new Set([...JSON.stringify(x ?? "").matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]))];
