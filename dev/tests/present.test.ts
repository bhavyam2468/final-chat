// Run: node --experimental-strip-types dev/tests/present.test.ts
import assert from "node:assert/strict";
import { needsBlocks, renderedToFile } from "../../src/lib/harness/present.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };

const table = (rows: number) => ["| a | b |", "|---|---|", ...Array.from({ length: rows }, (_, i) => `| ${i} | ${i * 2} |`)].join("\n");

t("a long markdown table should be a block", () => assert.equal(needsBlocks(table(8)), true));
t("a short comparison table can stay markdown", () => assert.equal(needsBlocks(table(3)), false));
t("five number-carrying bullets are data", () => assert.equal(needsBlocks(["cpu 42%", "ram 71%", "disk 88%", "swap 3%", "load 1.2"].map((x) => `- ${x}`).join("\n")), true));
t("prose stays prose", () => assert.equal(needsBlocks("The build takes about two minutes on this machine, mostly compile time."), false));
t("a spec sheet in lines of text should be blocks", () => assert.equal(needsBlocks(["OS: Linux 6.x", "CPU: 8 cores", "RAM: 32 GiB", "Disk: 1 TiB", "GPU: none", "Python: 3.12"].join("\n")), true));
t("an answer that already has blocks is left alone", () => assert.equal(needsBlocks('Here:\n<ui><x-chart data="1,2"></x-chart></ui>'), false));
t("a canvas counts as presented", () => assert.equal(needsBlocks('<canvas title="x"></canvas>'), false));
t("a matplotlib png linked from Python is a chart the user cannot read", () => {
  assert.equal(renderedToFile("Saved the plot to artifacts/trend.png", true), true);
  assert.equal(needsBlocks("Saved the plot to artifacts/trend.png", { usedPython: true }), true);
});
t("a png the user asked to download is fine", () => assert.equal(needsBlocks("Here is the file you asked for: artifacts/logo.png", { usedPython: false }), false));
t("empty text is never nudged", () => assert.equal(needsBlocks(""), false));

console.log(`\npresent.test: ${n} assertions ok`);
