// node --experimental-strip-types --no-warnings dev/tests/blocks-contract.test.ts
import assert from "node:assert/strict";
import schema from "../../public/blocks/schema.js";
import flow from "../../public/blocks/flow-core.js";
import { uiIssues } from "../../src/lib/ui-check.ts";
import { readNDJSON } from "../../src/lib/blocks/ndjson.ts";
import fs from "node:fs";
import { searchCatalog } from "../../src/lib/blocks/catalog.ts";

const good = ['<ui><x-state seconds="20"></x-state><x-timer seconds="seconds"></x-timer></ui>', '<ui><x-block x-data="{count:0}"><button @click="count++">{{count}}</button></x-block></ui>', '<ui><x-code language="html">&lt;x-madeup&gt;</x-code></ui>', '<ui><x-flowchart>A["Study"] --> B{"Ready?"}; B -->|Yes| C("Done"); B -->|No| A</x-flowchart></ui>'];
for (const src of good) assert.deepEqual(uiIssues(src), [], src);
for (const [source, match] of [
  ['<ui><x-timer seconds="oops"/></ui>', /seconds/],
  ['<ui><x-chart type="bogus"/></ui>', /type/],
  ['<ui><x-card>', /unclosed/],
  ['<ui><div id="a"></div><div id="a"></div></ui>', /Duplicate/],
  ['<ui><x-tab>Unparented</x-tab></ui>', /inside/],
  ['<ui><x-split weights="2:0"></x-split></ui>', /positive/],
  ['<ui><x-flowchart>A["Read"] --> B</x-flowchart></ui>', /undefined node/],
] as const) assert.match(uiIssues(source).join("\n"), match, source);
assert.match(searchCatalog("flowchart"), /x-flowchart/);
assert.match(searchCatalog("reactive binding key"), /stable keys|stable|key/i);
assert.match(searchCatalog("native inputs form"), /<input/);
const definitions = [...fs.readFileSync("public/blocks/elements.js", "utf8").matchAll(/define\("(x-[\w-]+)"/g)].map((m) => m[1]).concat("x-flowchart");
assert.deepEqual(Object.keys(schema.registry).sort(), definitions.sort(), "Registry exactly covers renderers");
const g = flow.parse('flowchart LR\nA["One"]-->B{"Two?"}; B -->|yes| C("End"); C-->A');
assert.equal(g.direction, "RIGHT"); assert.equal(g.nodes.length, 3); assert.equal(g.edges.length, 3);
assert.equal(flow.parse('A-one["a < b & c"] --> A-two["Next"]', 'up').nodes[0].label, 'a < b & c');
assert.equal(flow.parse(JSON.stringify({nodes:[{id:"solo",label:"Alone"}], edges:[]})).nodes.length, 1);
for (const src of ['A["a"]-->Missing', 'A["a"]; A["different"]', 'A["a"]:::red', 'A["unfinished]', 'flowchart BAD\nA["a"]', JSON.stringify({nodes:[{id:"a",label:""}],edges:[]})]) assert.throws(() => flow.parse(src), src);
assert.throws(() => flow.parse(Array.from({length:101}, (_,i) => `N${i}["Node"]`).join(";")), /100/);
const events = [{t:"chunk", chunk:"héllo 🙂\nnext"}, {t:"data",data:{x:2}}, {t:"done",ok:true,code:0}];
const bytes = new TextEncoder().encode(events.map(JSON.stringify).join("\r\n"));
for (const size of [1, 2, 7, 4096]) {
  const received: unknown[] = [];
  await readNDJSON(new ReadableStream({start(c) { for(let i=0;i<bytes.length;i+=size) c.enqueue(bytes.slice(i,i+size)); c.close(); }}), e => received.push(e));
  assert.deepEqual(received, events);
}
for (const source of ['not json\n', '[]\n', '{"x":"too long"}', '\uFFFD']) {
  const bytes = new TextEncoder().encode(source);
  await assert.rejects(() => readNDJSON(new ReadableStream({start(c) {c.enqueue(bytes);c.close();}}), () => {}, 10));
}
await assert.rejects(() => readNDJSON(new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}}),()=>{}));
console.log("Blocks contracts, flow parsing, registry parity and fragmented NDJSON passed");
