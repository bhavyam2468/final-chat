import assert from "node:assert/strict";
import { decodeHref, parseDdgHtml, htmlToText } from "../../src/lib/search-fast.ts";
import { liftFences, uiIssues } from "../../src/lib/ui-check.ts";
import { shellPreflight, noteMissing, banPackages, unseenCommandFlags } from "../../src/lib/harness/shell-preflight.ts";

assert.equal(decodeHref("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=1"), "https://example.com/a");
assert.equal(decodeHref("//example.com/x"), "https://example.com/x");

const html = `
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fwiki&amp;rut=1">Example Wiki</a>
  <a class="result__snippet" href="https://example.com/wiki">A short snippet about cats.</a>
</div>
<div class="result">
  <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fother.test%2Fq" class="result-link">Other</a>
  <td class="result-snippet">Second hit</td>
</div>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fsettings">skip self</a>
`;
const hits = parseDdgHtml(html, 5);
assert.equal(hits.length, 2);
assert.equal(hits[0].url, "https://example.com/wiki");
assert.equal(hits[0].title, "Example Wiki");
assert.match(hits[0].snippet, /cats/);
assert.equal(hits[1].url, "https://other.test/q");

assert.match(htmlToText("<html><title>Hi</title><script>nope</script><p>Hello <b>there</b></p></html>"), /Hi/);
assert.match(htmlToText("<p>Hello <b>there</b></p>"), /Hello there/);
assert.doesNotMatch(htmlToText("<script>secret()</script><p>ok</p>"), /secret/);

const fenced = "Here:\n```html\n<ui><x-chart type=\"pie\" data=\"1,2\"></x-chart></ui>\n```\n";
assert.match(liftFences(fenced), /^Here:\n<ui>/);
assert.doesNotMatch(liftFences(fenced), /```/);
assert.match(liftFences("```ts\nconst x = 1;\n```"), /```ts/);

assert.ok(uiIssues("<ui><x-not-a-thing></x-not-a-thing></ui>").some((s) => /unknown/.test(s)));
assert.ok(uiIssues("<ui><script>const t = document.querySelector('x-timer'); t.left</script></ui>").some((s) => /timer/.test(s)));
assert.ok(uiIssues("```\n<ui><x-chart></x-chart></ui>\n```").some((s) => /fence/.test(s)));
assert.equal(uiIssues("<ui><x-chart type=\"bar\" data=\"1,2\"></x-chart></ui>").length, 0);
assert.equal(uiIssues("```ts\nconst x = 1;\n```\n<ui><x-chart type=\"bar\" data=\"1,2\"></x-chart></ui>").length, 0);
assert.equal(uiIssues("<ui><x-choice options=\"a|b\" /></ui>").length, 0);

assert.match(shellPreflight("cd /home/thatguy/Projects/the chat application && python3 x.py") || "", /Quote/);
assert.equal(shellPreflight("cd \"/home/thatguy/Projects/the chat application\" && python3 x.py"), null);
assert.match(shellPreflight("grep -n foo src") || "", /fs_search/);
assert.match(shellPreflight("cat notes.txt") || "", /fs_read/);
noteMissing("c1", "bash: manim: command not found");
assert.match(shellPreflight("manim -ql scene.py", "c1") || "", /already came back/);
assert.match(shellPreflight("cd /tmp && manim -ql scene.py", "c1") || "", /already came back/);
assert.equal(shellPreflight("manim -ql scene.py", "c2"), null);
banPackages("c1", ["manim"]);
assert.match(shellPreflight("pip3 install --user manim", "c1") || "", /already refused/);
assert.match(unseenCommandFlags("```bash\nsudo pacman -S --noconfirm foo\n```", "pacman install docs") || "", /--noconfirm/);
assert.equal(unseenCommandFlags("```bash\nsudo pacman -S --noconfirm foo\n```", "use --noconfirm"), null);

console.log("harness-extra: ok");
