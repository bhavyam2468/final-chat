/**
 * Action guards (pure; unit-tested). Informed by the July 2025 incidents where coding agents destroyed user data
 * (Gemini CLI: a failed mkdir, then mv into a missing folder overwrote every file; Replit: a production DB dropped
 * during a "code freeze"). A rule in the prompt is not a guardrail; these run server-side, whatever the model says.
 *
 *  - destructive(cmd): commands that lose data or are hard to undo → need one click of user approval.
 *  - installTargets(cmd): package names in pip/npm installs → checked against the registry (hallucinated names,
 *    "slopsquatting": ~20% of packages suggested by open models do not exist; USENIX Security 2025).
 */

export type Danger = { reason: string };

const SAFE_RM = /^(?:\.\/)?(?:node_modules|dist|build|out|\.next|\.nuxt|\.turbo|\.cache|\.parcel-cache|target|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv|venv|tmp|\.tmp|\*\.pyc|\*\.log|[\w.-]+\.(?:log|tmp|pyc|o))\/?$|^\/tmp\/[\w./-]+$/;

/** Split a shell line into simple commands (good enough for detection; not a full parser). */
const commands = (cmd: string) => cmd.replace(/\\\n/g, " ").split(/\s*(?:&&|\|\||;|\n|\|(?!\|))\s*/).map((c) => c.trim().replace(/^(?:sudo\s+(?:-\S+\s+)*|env\s+(?:\w+=\S+\s+)*|nohup\s+|time\s+|exec\s+)+/, "")).filter(Boolean);
const words = (c: string) => (c.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ""));

export function destructive(cmd: string, where: "host" | "sandbox"): Danger | null {
  const full = cmd.replace(/\\\n/g, " ");
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(full)) return { reason: "fork bomb" };
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/.test(full) && where === "host") return { reason: "pipes a downloaded script straight into a shell" };
  if (/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i.test(full)) return { reason: "drops or truncates database tables" };
  if (/\bdelete\s+from\s+[\w."`]+\s*(;|$|"|')/i.test(full)) return { reason: "DELETE without WHERE (removes every row)" };
  for (const c of commands(cmd)) {
    const w = words(c), bin = (w[0] || "").split("/").pop()!;
    if (bin === "rm") {
      const flags = w.slice(1).filter((x) => x.startsWith("-")).join(" ");
      const targets = w.slice(1).filter((x) => !x.startsWith("-"));
      const recursive = /(^|\s)-(\w*[rR]\w*)\b|--recursive/.test(flags);
      if (!recursive) continue;
      const bad = targets.filter((t) => !SAFE_RM.test(t));
      const catastrophic = targets.find((t) => /^(\/|~|~\/|\$HOME\/?|\.|\.\.|\*|\/\*|~\/\*|\.\/\*)$/.test(t) || /^\$\{?\w+\}?\/?$/.test(t) || /^\$\{?\w+\}?\/\*?$/.test(t));
      if (catastrophic) return { reason: `recursive delete of ${catastrophic}` };
      if (where === "host" && bad.length) return { reason: `recursive delete: ${bad.slice(0, 3).join(" ")}` };
      if (where === "sandbox" && bad.some((t) => /^(\.\/)?(uploads|notes|system|artifacts)\/?$/.test(t))) return { reason: `deletes the workspace folder ${bad[0]}` };
    }
    if (bin === "git") {
      const s = w.slice(1).join(" ");
      if (/^reset\b.*--hard/.test(s)) return { reason: "git reset --hard discards uncommitted work" };
      if (/^clean\b.*-\w*f/.test(s) && !/\s(-\w*n\w*|--dry-run)\b/.test(s)) return { reason: "git clean deletes untracked files" };
      if (/^push\b.*(\s--force(?!-with-lease)|\s-f\b|\s\+\w)/.test(s)) return { reason: "force push rewrites remote history" };
      if (/^(checkout|restore)\b.*\s(--\s+)?\.(\s|$)/.test(s) && !/--staged/.test(s)) return { reason: "discards all local changes" };
      if (/^branch\b.*\s-D\b/.test(s)) return { reason: "force-deletes a branch" };
      if (/^stash\s+(drop|clear)\b/.test(s)) return { reason: "drops stashed work" };
      if (/^filter-(branch|repo)\b/.test(s)) return { reason: "rewrites repository history" };
    }
    if (/^(mkfs(\.\w+)?|wipefs|fdisk|sfdisk|parted|shred)$/.test(bin)) return { reason: `${bin} can erase disks` };
    if (bin === "dd" && /\bof=\/dev\/(?!null\b|zero\b)/.test(c)) return { reason: "dd writes to a raw device" };
    if (/^(shutdown|reboot|poweroff|halt)$/.test(bin) && where === "host") return { reason: `${bin} the machine` };
    if (bin === "systemctl" && /\b(stop|disable|mask|poweroff|reboot)\b/.test(c) && where === "host") return { reason: "changes system services" };
    if ((bin === "chmod" || bin === "chown") && /-\w*R/.test(c) && /\s(\/|~|\$HOME)(\s|$)/.test(c)) return { reason: `recursive ${bin} on a root/home folder` };
    if (bin === "find" && /\s-delete\b|-exec\s+rm\b/.test(c) && where === "host") return { reason: "find … -delete removes matching files" };
    if (bin === "docker" && /\b(system\s+prune|volume\s+(rm|prune)|compose\s+down\b.*\s-v\b)/.test(c)) return { reason: "removes Docker volumes/data" };
    if ((bin === "kill" && /\s-9\s+-1\b/.test(c)) || (bin === "killall" && where === "host")) return { reason: "kills many processes" };
    if (bin === "mv" && /\s\/dev\/null\s*$/.test(c)) return { reason: "moves files to /dev/null" };
    if (/^>\s*\/dev\/sd/.test(c)) return { reason: "writes to a raw device" };
  }
  return null;
}

export type InstallTarget = { manager: "pypi" | "npm"; name: string };

/** Package names from pip/uv/npm/pnpm/yarn/bun install commands (flags, versions, paths and URLs skipped). */
export function installTargets(cmd: string): InstallTarget[] {
  const out: InstallTarget[] = [];
  for (const c of commands(cmd)) {
    const w = words(c);
    let i = -1, mgr: InstallTarget["manager"] | null = null;
    const bin = (w[0] || "").split("/").pop()!;
    if (/^pip3?$/.test(bin) && w[1] === "install") { i = 2; mgr = "pypi"; }
    else if (/^python3?$/.test(bin) && w[1] === "-m" && /^pip3?$/.test(w[2]) && w[3] === "install") { i = 4; mgr = "pypi"; }
    else if (bin === "uv" && ((w[1] === "pip" && w[2] === "install") || w[1] === "add")) { i = w[1] === "add" ? 2 : 3; mgr = "pypi"; }
    else if (bin === "npm" && /^(install|i|add)$/.test(w[1])) { i = 2; mgr = "npm"; }
    else if (/^(pnpm|bun)$/.test(bin) && /^(add|install|i)$/.test(w[1])) { i = 2; mgr = "npm"; }
    else if (bin === "yarn" && w[1] === "add") { i = 2; mgr = "npm"; }
    if (!mgr) continue;
    for (let k = i; k < w.length; k++) {
      const x = w[k];
      if (/^-(r|e|c|-requirement|-editable|-constraint|-index-url|-extra-index-url|i|-prefix|-target|t)$/.test(x)) { k++; continue; }
      if (x.startsWith("-") || /^[./~]|:\/\/|^git\+|\.whl$|\.tar\.gz$|\.tgz$/.test(x)) continue;
      const name = mgr === "pypi" ? x.split(/[=<>!~\[;@ ]/)[0] : x.replace(/(.)@[^/]*$/, "$1");
      if (name && /^(@[\w.-]+\/)?[\w.-]+$/.test(name)) out.push({ manager: mgr, name: mgr === "pypi" ? name.toLowerCase() : name });
    }
  }
  return out;
}

export type PkgInfo = { name: string; manager: InstallTarget["manager"]; exists: boolean | null; ageDays?: number; versions?: number };

/** Registry lookup with a short timeout. exists=null means the registry could not be reached (offline: allow). */
export async function registryInfo(t: InstallTarget, timeoutMs = 3000): Promise<PkgInfo> {
  const url = t.manager === "pypi" ? `https://pypi.org/pypi/${encodeURIComponent(t.name)}/json` : `https://registry.npmjs.org/${t.name.replace("/", "%2F")}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (r.status === 404) return { ...t, exists: false };
    if (!r.ok) return { ...t, exists: null };
    const j = await r.json();
    let first: string | undefined, versions = 0;
    if (t.manager === "pypi") {
      const rel = (j.releases || {}) as Record<string, { upload_time_iso_8601?: string; upload_time?: string }[]>;
      versions = Object.keys(rel).length;
      first = Object.values(rel).flat().map((f) => f.upload_time_iso_8601 || f.upload_time || "").filter(Boolean).sort()[0];
    } else { first = j.time?.created; versions = Object.keys(j.versions || {}).length; }
    const ageDays = first ? Math.floor((Date.now() - Date.parse(first)) / 86400000) : undefined;
    return { ...t, exists: true, ageDays, versions };
  } catch { return { ...t, exists: null }; }
}

/** Returns a blocking message for missing packages, an approval reason for suspiciously new ones, or null. */
export async function checkInstalls(cmd: string | string[], mgr?: InstallTarget["manager"]): Promise<{ block?: string; approve?: string } | null> {
  const targets = Array.isArray(cmd) ? cmd.map((name) => ({ manager: mgr || "pypi", name: name.split(/[=<>!~\[;@ ]/)[0].toLowerCase() })).filter((t) => /^[\w.-]+$/.test(t.name)) : installTargets(cmd);
  if (!targets.length) return null;
  const infos = await Promise.all(targets.slice(0, 12).map((t) => registryInfo(t)));
  const missing = infos.filter((i) => i.exists === false);
  if (missing.length) return { block: `Not on ${missing[0].manager === "pypi" ? "PyPI" : "npm"}: ${missing.map((m) => m.name).join(", ")}. The name is probably hallucinated; web_search for the real package name. Nothing was installed.` };
  const young = infos.filter((i) => i.exists && i.ageDays !== undefined && i.ageDays < 45 && (i.versions ?? 0) < 5);
  if (young.length) return { approve: `new package${young.length > 1 ? "s" : ""}: ${young.map((y) => `${y.name} (first published ${y.ageDays} days ago, ${y.versions} version${y.versions === 1 ? "" : "s"})`).join(", ")}; could be a typo-squat` };
  return null;
}
