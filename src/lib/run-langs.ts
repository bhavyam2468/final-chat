/* Which workspace files can be run from a canvas, and what the run needs.
   Shared by the server runner (`src/lib/file-run.ts`) and the canvas UI, so the Run button appears
   exactly where the server knows how to execute the file. No node imports here: this module is
   pulled into the client bundle. */
export type RunLang = { lang: string; needs: string; compile: boolean };

export const RUN_LANGS: Record<string, RunLang> = {
  py: { lang: "python", needs: "python3", compile: false },
  pyw: { lang: "python", needs: "python3", compile: false },
  js: { lang: "javascript", needs: "node", compile: false },
  mjs: { lang: "javascript", needs: "node", compile: false },
  cjs: { lang: "javascript", needs: "node", compile: false },
  ts: { lang: "typescript", needs: "node", compile: false },
  mts: { lang: "typescript", needs: "node", compile: false },
  sh: { lang: "bash", needs: "bash", compile: false },
  bash: { lang: "bash", needs: "bash", compile: false },
  rb: { lang: "ruby", needs: "ruby", compile: false },
  php: { lang: "php", needs: "php", compile: false },
  lua: { lang: "lua", needs: "lua", compile: false },
  pl: { lang: "perl", needs: "perl", compile: false },
  go: { lang: "go", needs: "go", compile: true },
  c: { lang: "c", needs: "cc", compile: true },
  h: { lang: "c", needs: "cc", compile: true },
  cpp: { lang: "c++", needs: "c++", compile: true },
  cc: { lang: "c++", needs: "c++", compile: true },
  cxx: { lang: "c++", needs: "c++", compile: true },
  rs: { lang: "rust", needs: "rustc", compile: true },
  java: { lang: "java", needs: "javac", compile: true },
  kt: { lang: "kotlin", needs: "kotlinc", compile: true },
  swift: { lang: "swift", needs: "swift", compile: false },
  cs: { lang: "c#", needs: "dotnet", compile: true },
};

export const runLangOf = (p: string): RunLang | null => RUN_LANGS[(p || "").split(".").pop()!.toLowerCase()] || null;
export const runnablePath = (p: string) => !!runLangOf(p);
