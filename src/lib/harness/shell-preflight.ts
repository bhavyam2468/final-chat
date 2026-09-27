/** Shell mistakes from the stress-test chats, refused before they run. Not a prompt wish. */

const missing = new Map<string, Set<string>>();
const bannedPkgs = new Map<string, Set<string>>();

export function noteMissing(conv: string, out: string) {
  const set = missing.get(conv) || new Set<string>();
  for (const m of out.matchAll(/([\w.+/-]+): command not found/g)) set.add(m[1].replace(/.*\//, ""));
  missing.set(conv, set);
}

export function banPackages(conv: string, names: string[]) {
  const set = bannedPkgs.get(conv) || new Set<string>();
  for (const n of names) {
    const base = n.split(/[=<>!~\[;@ ]/)[0].toLowerCase();
    if (base) set.add(base);
  }
  bannedPkgs.set(conv, set);
}

export function headBin(cmd: string): string {
  const seg = (cmd.split(/&&|\|\||;|\n/)[0] || "").replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s+&&\s+/, "");
  const tok = seg.trim().replace(/^(?:\w+=\S*\s+)*/, "").split(/\s+/)[0] || "";
  return tok.replace(/.*\//, "");
}

export function installNames(cmd: string): string[] {
  const m = cmd.match(/\b(?:pip3?|python3?\s+-m\s+pip|npm|pnpm|yarn)\s+(?:install|i|add)\s+([^&|;]+)/);
  if (!m) return [];
  return m[1].split(/\s+/).filter((t) => t && !t.startsWith("-"));
}

/** Returns an error string to show the model instead of running the command. */
export function shellPreflight(cmd: string, conv = ""): string | null {
  const cd = cmd.match(/(?:^|&&|\|\||;)\s*cd\s+([^&|;]+)/);
  if (cd && !/["']/.test(cd[1]) && /\s/.test(cd[1].trim())) {
    return `Unquoted path with spaces in cd (${cd[1].trim().slice(0, 90)}). Quote the whole path: cd "the path". Do not retry this line.`;
  }
  const t = cmd.trim();
  if (/^(?:grep|rg|ag)\b/.test(t)) return "Use fs_search, not grep or rg in the shell. It returns path:line.";
  if (/^cat\s+\S+$/.test(t)) return "Use fs_read, not cat.";
  if (/^find\s+\S/.test(t)) return "Use fs_search or fs_list, not find.";
  const bannedBin = cmd.split(/&&|\|\||;|\n/).map((seg) => headBin(seg)).find((bin) => bin && missing.get(conv)?.has(bin));
  if (bannedBin) return `${bannedBin} already came back "command not found" in this chat. Do not call it again. Look up the real command, or use a tool you have.`;
  const banned = installNames(cmd).filter((n) => bannedPkgs.get(conv)?.has(n.toLowerCase().split(/[=<>]/)[0]));
  if (banned.length) return `${banned.join(", ")} was already refused. It is not a real package. Do not install it again. web_search the real name, or stop.`;
  return null;
}

/** A shell fence in a search answer whose flags never appeared in a page the model opened. */
export function unseenCommandFlags(text: string, seen: string): string | null {
  const fences = [...text.matchAll(/```(?:bash|sh|shell|zsh|console)?\n([\s\S]*?)```/gi)].map((m) => m[1]);
  const hit = fences.find((f) => /\b(sudo|pacman|apt-get|apt|dnf|systemctl|npm|pnpm|pip3?|brew|cargo|yay)\b/.test(f));
  if (!hit) return null;
  const low = seen.toLowerCase();
  const flags = [...hit.matchAll(/\s(--[\w-]+)/g)].map((m) => m[1]).filter((f) => f.length > 3 && !low.includes(f.toLowerCase()));
  if (!flags.length) return null;
  return `${hit.trim().slice(0, 220)}\nFlags not seen in any page opened this turn: ${[...new Set(flags)].slice(0, 6).join(" ")}`;
}
