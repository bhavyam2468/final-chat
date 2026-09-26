/**
 * Stuck detection for the tool loop (after OpenHands' StuckDetector): the same call returning the same result,
 * the same call failing repeatedly, or two calls ping-ponging. First hit → one nudge; continuing → stop the turn.
 * Pure; unit-tested.
 */
export type ToolStep = { name: string; args: unknown; result: string; ok: boolean };

const canon = (v: unknown): string => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`) : JSON.stringify(v));
const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.slice(0, 200) || "";

export class StuckDetector {
  private steps: { call: string; out: string; ok: boolean; name: string }[] = [];
  private nudged = new Set<string>();

  add(s: ToolStep) { this.steps.push({ name: s.name, call: s.name + canon(s.args), out: s.result.slice(0, 800), ok: s.ok }); }

  /** Returns a nudge (inject once as a user-side note) or a stop reason (end the turn), or null. */
  check(): { nudge?: string; stop?: string } | null {
    const st = this.steps, n = st.length;
    if (n < 3) return null;
    const last = st[n - 1];
    const same = (k: number) => st.slice(n - k).every((x) => x.call === last.call && x.out === last.out);
    const sameErr = (k: number) => st.slice(n - k).every((x) => x.call === last.call && !x.ok && firstLine(x.out) === firstLine(last.out));
    const key = (t: string) => t + last.call;
    if (sameErr(3)) {
      if (this.nudged.has(key("err"))) return sameErr(4) ? { stop: `${last.name} failed the same way 4 times; stopping instead of looping.` } : null;
      this.nudged.add(key("err"));
      return { nudge: `You called ${last.name} with the same arguments 3 times and got the same error: "${firstLine(last.out)}". Do not repeat it. Read the error, change the approach (different arguments, another tool, fs_read to re-check the file), or ask the user.` };
    }
    if (same(3)) {
      if (this.nudged.has(key("same"))) return same(4) ? { stop: `${last.name} was called 4 times with identical results; stopping instead of looping.` } : null;
      this.nudged.add(key("same"));
      return { nudge: `You called ${last.name} with the same arguments 3 times and got the same result. You already have it; act on it or try something different.` };
    }
    if (n >= 6) {
      const a = st[n - 2], b = st[n - 1];
      const alt = a.call !== b.call && [0, 2, 4].every((i) => st[n - 2 - i]?.call === a.call && st[n - 1 - i]?.call === b.call);
      if (alt) {
        const k = "alt" + a.call + b.call;
        if (this.nudged.has(k)) return n >= 8 && [6].every((i) => st[n - 2 - i]?.call === a.call) ? { stop: `Alternating between ${a.name} and ${b.name} without progress; stopping.` } : null;
        this.nudged.add(k);
        return { nudge: `You are alternating between ${a.name} and ${b.name} with the same inputs. Stop, state what you know, and choose a different next step.` };
      }
    }
    return null;
  }
}
