// Run: node --experimental-strip-types dev/tests/canvas-layout.test.ts
import assert from "node:assert/strict";
import { dockCanvasRect, edgeAt, moveCanvasRect, peekCanvasRect, resizeCanvasRect, shouldDockCanvas } from "../../src/lib/canvas-layout.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };
const viewport = { width: 1280, height: 800 };
const origin = { x: 300, y: 180, w: 480, h: 360 };

t("new canvas uses a free sidebar, but never evicts its occupant", () => {
  assert.equal(shouldDockCanvas(undefined, false), true);
  assert.equal(shouldDockCanvas(true, false), true);
  assert.equal(shouldDockCanvas(undefined, true), false);
  assert.equal(shouldDockCanvas(true, true), false);
  assert.equal(shouldDockCanvas(false, false), false);
});
t("floating movement keeps a useful grip on screen", () => {
  assert.deepEqual(moveCanvasRect(origin, -1000, -240, viewport), { ...origin, x: -432, y: 0 });
  assert.deepEqual(moveCanvasRect(origin, 2000, 2000, viewport), { ...origin, x: 1232, y: 752 });
});
t("all eight resize directions preserve anchored edges", () => {
  const east = resizeCanvasRect(origin, 80, 0, "e", viewport);
  assert.deepEqual(east, { ...origin, w: 560 });
  const west = resizeCanvasRect(origin, -40, 0, "w", viewport);
  assert.deepEqual(west, { x: 260, y: origin.y, w: 520, h: origin.h });
  const north = resizeCanvasRect(origin, 0, -20, "n", viewport);
  const south = resizeCanvasRect(origin, 0, 20, "s", viewport);
  assert.deepEqual(north, { x: origin.x, y: 160, w: origin.w, h: 380 });
  assert.deepEqual(south, { x: origin.x, y: origin.y, w: origin.w, h: 380 });
  const northWest = resizeCanvasRect(origin, -30, -20, "nw", viewport);
  const northEast = resizeCanvasRect(origin, 30, -20, "ne", viewport);
  const southEast = resizeCanvasRect(origin, 30, 20, "se", viewport);
  const southWest = resizeCanvasRect(origin, -30, 20, "sw", viewport);
  assert.deepEqual(northWest, { x: 270, y: 160, w: 510, h: 380 });
  assert.deepEqual(northEast, { x: origin.x, y: 160, w: 510, h: 380 });
  assert.deepEqual(southEast, { x: origin.x, y: origin.y, w: 510, h: 380 });
  assert.deepEqual(southWest, { x: 270, y: origin.y, w: 510, h: 380 });
});
t("resize respects minimum size and viewport bounds", () => {
  const small = resizeCanvasRect(origin, 1000, 1000, "nw", viewport);
  assert.ok(small.w >= 280 && small.h >= 180);
  assert.ok(small.x >= 0 && small.y >= 0);
  assert.ok(small.x + small.w <= viewport.width && small.y + small.h <= viewport.height);
});
t("viewport clamps preserve the opposite edge while resizing", () => {
  const east = resizeCanvasRect({ x: 1000, y: 100, w: 200, h: 300 }, 500, 0, "e", viewport);
  const west = resizeCanvasRect({ x: 100, y: 100, w: 200, h: 300 }, -500, 0, "w", viewport);
  const south = resizeCanvasRect({ x: 100, y: 600, w: 300, h: 180 }, 0, 500, "s", viewport);
  const north = resizeCanvasRect({ x: 100, y: 100, w: 300, h: 200 }, 0, -500, "n", viewport);
  assert.deepEqual(east, { x: 1000, y: 100, w: 280, h: 300 });
  assert.deepEqual(west, { x: 0, y: 100, w: 300, h: 300 });
  assert.deepEqual(south, { x: 100, y: 600, w: 300, h: 200 });
  assert.deepEqual(north, { x: 100, y: 0, w: 300, h: 300 });
});
t("edge detection identifies each screen edge and ignores the interior", () => {
  assert.equal(edgeAt(3, 400, viewport), "left");
  assert.equal(edgeAt(1277, 400, viewport), "right");
  assert.equal(edgeAt(640, 2, viewport), "top");
  assert.equal(edgeAt(640, 799, viewport), "bottom");
  assert.equal(edgeAt(300, 300, viewport), null);
});
t("peek tabs are compact, visible, and restore by storing the origin elsewhere", () => {
  assert.deepEqual(peekCanvasRect(origin, "left", viewport), { x: 0, y: 272, w: 18, h: 176 });
  assert.deepEqual(peekCanvasRect(origin, "right", viewport), { x: 1262, y: 272, w: 18, h: 176 });
  assert.deepEqual(peekCanvasRect(origin, "top", viewport), { x: 420, y: 0, w: 240, h: 18 });
  assert.deepEqual(peekCanvasRect(origin, "bottom", viewport), { x: 420, y: 782, w: 240, h: 18 });
});
t("dock geometry leaves an inset for a quiet, full-height sidebar", () => {
  assert.deepEqual(dockCanvasRect(viewport, 440), { x: 832, y: 8, w: 440, h: 784 });
});

console.log(`\ncanvas-layout.test: ${n} assertions ok`);
