// Run: node --experimental-strip-types dev/tests/memory.test.ts
// Retrieval/slicing logic of the memory store (the I/O around it is exercised by the app).
import assert from "node:assert/strict";
import { pickNotes, profileBody, relevance, sliceLines, words, when } from "../../src/lib/memory-rank.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };
const day = 86_400_000;
const now = Date.parse("2026-10-07T10:00:00.000Z");
const ep = (id: string, text: string, daysAgo: number) => ({ id, text, at: new Date(now - daysAgo * day).toISOString() });

t("only notes that share a word are recalled", () => {
  const all = [ep("a", "prefers dark themes", 1), ep("b", "allergic to peanuts", 2)];
  assert.deepEqual(pickNotes(all, "which theme do you recommend?", now).map((e) => e.id), ["a"]);
});
t("short words carry no signal", () => {
  assert.equal(words("I am at it").size, 0);
  assert.equal(relevance(ep("a", "the user is a fan of it", 0), words("the user is a fan of it"), now) > 0, true);
});
t("more matching words beat fewer", () => {
  const all = [ep("few", "uses vim", 1), ep("many", "uses vim for python editing and vim plugins", 1)];
  assert.deepEqual(pickNotes(all, "vim python editing plugins", now).map((e) => e.id), ["many", "few"]);
});
t("a fresh note outranks a stale one with the same match", () => {
  const all = [ep("old", "deploy target is fly.io", 300), ep("new", "deploy target is fly.io", 1)];
  assert.equal(pickNotes(all, "deploy target fly.io", now)[0].id, "new");
});
t("relevance still beats recency when the match is stronger", () => {
  const all = [ep("strong", "postgres 17 upgrade plan with pg_upgrade", 200), ep("weak", "postgres", 1)];
  assert.equal(pickNotes(all, "postgres 17 upgrade plan", now)[0].id, "strong");
});
t("duplicates collapse and old ones are dropped", () => {
  const all = [ep("a", "theme is dark", 5), ep("b", "Theme  is  dark!", 1), ep("c", "theme", 2)];
  const got = pickNotes(all, "theme dark", now);
  assert.equal(got.length, 2);
  assert.equal(got[0].id, "b");
});
t("at most four notes are recalled", () => {
  const all = Array.from({ length: 9 }, (_, i) => ep(String(i), `redis tuning note ${i}`, i));
  assert.equal(pickNotes(all, "redis tuning notes", now).length, 4);
});
t("a query with no words recalls nothing", () => assert.deepEqual(pickNotes([ep("a", "x y z", 0)], "?!", now), []));
t("a broken timestamp does not break ranking", () => {
  assert.equal(relevance({ id: "x", text: "dark mode", at: "not a date" }, words("dark mode"), now) > 0, true);
});
t("slices cut on a line, never mid-fact", () => {
  const text = ["- one", "- two", "- three"].join("\n");
  assert.equal(sliceLines(text, 100), text);
  assert.equal(sliceLines(text, 12), "- one\n- two");
  assert.equal(sliceLines("abcdefghij", 4), "abcd");
});
t("the profile drops its heading and the template's own line, keeps real facts", () => {
  const shipped = "# Profile\nStable facts the user asked to remember. One line each. The user can delete any line.\n- [x1] Name is Ada";
  assert.equal(profileBody(shipped), "- [x1] Name is Ada");
  assert.equal(profileBody("# Profile\nI work in IST\n- [x1] Name is Ada"), "I work in IST\n- [x1] Name is Ada");
});
t("dates render as days", () => assert.equal(when("2026-10-07T10:00:00.000Z"), "2026-10-07"));

console.log(`\nmemory.test: ${n} assertions ok`);
