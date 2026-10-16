// Unit-test runner for dev/tests/*.test.ts.
//
//   npm run test:unit                 everything
//   npm run test:unit -- desktop      only files whose name contains "desktop"
//
// Each suite is a plain Node script (node:assert, its own `ok` lines) run in its own process, so a
// crash in one cannot take the others down. Nothing is installed and nothing needs building: the
// suites import the app's TypeScript directly, which is the point — they test the code that ships,
// not a compiled copy of it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const dir = path.join(root, "dev", "tests");
const filter = process.argv[2] ?? "";

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => f.includes(filter))
  .sort();

if (!files.length) {
  console.error(`no test suites match "${filter}" in dev/tests`);
  process.exit(2);
}

const started = Date.now();
const failures = [];

for (const file of files) {
  const began = Date.now();
  process.stdout.write(`\n\u001b[1m${file}\u001b[0m\n`);
  // `PWD` is set explicitly: several suites shell out to Node themselves and expect the
  // repository root to be the working directory, which is also how the app is run in practice.
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", path.join(dir, file)],
    { cwd: root, stdio: "inherit", env: { ...process.env, PWD: root } }
  );
  const ms = Date.now() - began;
  if (result.status === 0) {
    console.log(`\u001b[32mpassed\u001b[0m ${file} (${ms} ms)`);
  } else {
    console.log(`\u001b[31mfailed\u001b[0m ${file} (exit ${result.status ?? result.signal}, ${ms} ms)`);
    failures.push(file);
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log("");
if (failures.length) {
  console.log(`\u001b[31m${failures.length} of ${files.length} suites failed\u001b[0m (${seconds}s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\u001b[32m${files.length} suites passed\u001b[0m (${seconds}s)`);
