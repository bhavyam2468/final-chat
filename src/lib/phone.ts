import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import type { Settings } from "./settings";
import { runShell } from "./exec";
import type { IO } from "./exec";

/** Phone testing is opt-in and every call is a visible tool row. It drives a device the user plugged in, not a hidden session. */

export function phoneOff(st: Settings) {
  if (!st.phone) return "Phone testing is off. The user turns it on in Settings → Access. Do not hide adb inside host_shell.";
  return null;
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function adb(st: Settings, args: string[], io: IO = {}, timeoutMs = 60000) {
  const off = phoneOff(st);
  if (off) return { out: off, code: 126 };
  return runShell(st, "adb " + args.map(sh).join(" "), timeoutMs, true, undefined, io);
}

export async function adbShot(st: Settings, dest: string): Promise<{ out: string; code: number }> {
  const off = phoneOff(st);
  if (off) return { out: off, code: 126 };
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return new Promise((res) => {
    const p = spawn("adb", ["exec-out", "screencap", "-p"]);
    const chunks: Buffer[] = [];
    let err = "";
    const t = setTimeout(() => { p.kill("SIGKILL"); err += "\n(timeout)"; }, 20000);
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", (e) => { clearTimeout(t); res({ out: String(e), code: 1 }); });
    p.on("close", async (code) => {
      clearTimeout(t);
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 80) return res({ out: err.trim() || "screencap failed. adb_devices first.", code: code ?? 1 });
      await fs.writeFile(dest, buf);
      res({ out: `saved ${dest} (${buf.length} bytes)`, code: 0 });
    });
  });
}
