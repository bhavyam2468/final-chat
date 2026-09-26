import { spawnSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import os from "os";
import fs from "fs";

/** Cheap syntax check used as an edit guard. Returns an error string, or null if fine/unknown. */
const req = createRequire(path.join(process.cwd(), "package.json"));
let ts: typeof import("typescript") | null | undefined;
function typescript() {
  if (ts === undefined) { try { ts = req("typescript"); } catch { ts = null; } }
  return ts;
}

export function syntaxError(file: string, text: string): string | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  try {
    if (ext === "json" && !/tsconfig|jsconfig|\.vscode/.test(file)) { JSON.parse(text); return null; }
    if (["ts", "tsx", "mts", "cts", "jsx", "js", "mjs", "cjs"].includes(ext)) {
      const t = typescript();
      if (t) {
        const kind = ext.endsWith("x") ? t.ScriptKind.TSX : ext.startsWith("m") || ext.startsWith("c") || ext === "js" ? t.ScriptKind.JS : t.ScriptKind.TS;
        const sf = t.createSourceFile(file, text, t.ScriptTarget.Latest, true, ext === "js" ? t.ScriptKind.JSX : kind);
        const d = (sf as unknown as { parseDiagnostics?: import("typescript").Diagnostic[] }).parseDiagnostics || [];
        if (!d.length) return null;
        const x = d[0], pos = x.start !== undefined ? sf.getLineAndCharacterOfPosition(x.start) : null;
        return `${pos ? `line ${pos.line + 1}:${pos.character + 1} ` : ""}${t.flattenDiagnosticMessageText(x.messageText, " ")}`;
      }
      if (ext === "js" || ext === "mjs" || ext === "cjs") {
        const tmp = path.join(os.tmpdir(), `syn-${process.pid}-${Date.now()}.${ext}`);
        fs.writeFileSync(tmp, text);
        const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8", timeout: 5000 });
        fs.rmSync(tmp, { force: true });
        return r.status === 0 ? null : (r.stderr || "").split("\n").filter((l) => /Error|:\d+/.test(l)).slice(0, 3).join(" ").replace(tmp, file) || "syntax error";
      }
      return null;
    }
    if (ext === "py") {
      const r = spawnSync("python3", ["-c", "import ast,sys\ntry: ast.parse(sys.stdin.read())\nexcept SyntaxError as e: print(f'line {e.lineno}: {e.msg}'); sys.exit(1)"], { input: text, encoding: "utf8", timeout: 5000 });
      return r.status === 1 ? (r.stdout.trim() || "syntax error") : null;
    }
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  return null;
}
