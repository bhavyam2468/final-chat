#!/usr/bin/env node
// App icons, generated from code so they can never drift from the design and never need a
// binary blob committed without a source. Pure Node: no image library, no build step.
//
//   node scripts/desktop/icons.mjs [--force]
//
// Writes src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png plus icon.ico and icon.icns for the
// platforms that need them. Idempotent: identical output for identical code, and it skips writing
// when a file already has the right bytes (so `git status` stays quiet).
//
// The mark: a warm ink tile with a paper chevron and an amber cursor block — a prompt, drawn in
// the same "quiet paper" palette as the app (see DESIGN.md).

import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = join(root, "src-tauri", "icons");

// ── palette (normalised 0..1: the maths below is done in linear RGB floats) ──────────────────
const rgb = (r, g, b) => [r / 255, g / 255, b / 255];
const INK_TOP = rgb(0x25, 0x22, 0x1e);
const INK_BOTTOM = rgb(0x17, 0x16, 0x14);
const PAPER = rgb(0xf6, 0xf1, 0xe8);
const AMBER = rgb(0xe3, 0xb1, 0x5c);

// ── geometry, in a 0..1 square ────────────────────────────────────────────────────────────────
const TILE = { x0: 0.04, y0: 0.04, x1: 0.96, y1: 0.96, r: 0.23 };
const CHEVRON = { a: [0.335, 0.285], b: [0.565, 0.5], c: [0.335, 0.715], w: 0.088 };
const CURSOR = { x0: 0.655, y0: 0.295, x1: 0.795, y1: 0.705, r: 0.035 };

const SUBSAMPLES = 4; // 16 samples per pixel: enough for these shapes at every size we ship

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Signed distance to a rounded rectangle: negative inside. */
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** Signed distance to a thick line segment: negative inside the stroke. */
function sdSegment(px, py, a, b, halfWidth) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - vx * t, wy - vy * t) - halfWidth;
}

/** Coverage from a distance field over one sub-sample, with a half-pixel feather. */
function coverage(d, feather) {
  return Math.max(0, Math.min(1, 0.5 - d / feather));
}

/** One sub-sample → premultiplied RGBA, composited in order. */
function sample(x, y, feather) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const over = (colour, cov) => {
    if (cov <= 0) return;
    r = colour[0] * cov + r * (1 - cov);
    g = colour[1] * cov + g * (1 - cov);
    b = colour[2] * cov + b * (1 - cov);
    a = cov + a * (1 - cov);
  };

  const tileD = sdRoundRect(x, y, TILE.x0, TILE.y0, TILE.x1, TILE.y1, TILE.r);
  over(mix(INK_TOP, INK_BOTTOM, Math.max(0, Math.min(1, (y - TILE.y0) / (TILE.y1 - TILE.y0)))), coverage(tileD, feather));

  const chevron = Math.min(
    sdSegment(x, y, CHEVRON.a, CHEVRON.b, CHEVRON.w / 2),
    sdSegment(x, y, CHEVRON.b, CHEVRON.c, CHEVRON.w / 2)
  );
  over(PAPER, coverage(chevron, feather));

  const cursor = sdRoundRect(x, y, CURSOR.x0, CURSOR.y0, CURSOR.x1, CURSOR.y1, CURSOR.r);
  over(AMBER, coverage(cursor, feather));

  return [r * a, g * a, b * a, a]; // premultiplied
}

/** Render one square RGBA image at `size`. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  // Feather in normalised units: one device pixel.
  const feather = 1 / size;
  const step = 1 / (size * SUBSAMPLES);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        const y = (py * SUBSAMPLES + sy + 0.5) * step;
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const x = (px * SUBSAMPLES + sx + 0.5) * step;
          const s = sample(x, y, feather);
          r += s[0];
          g += s[1];
          b += s[2];
          a += s[3];
        }
      }
      const n = SUBSAMPLES * SUBSAMPLES;
      const alpha = a / n;
      const i = (py * size + px) * 4;
      // Un-premultiply for storage (PNG is not premultiplied).
      pixels[i] = alpha > 0 ? Math.round(Math.min(255, (r / n / alpha) * 255)) : 0;
      pixels[i + 1] = alpha > 0 ? Math.round(Math.min(255, (g / n / alpha) * 255)) : 0;
      pixels[i + 2] = alpha > 0 ? Math.round(Math.min(255, (b / n / alpha) * 255)) : 0;
      pixels[i + 3] = Math.round(Math.min(255, alpha * 255));
    }
  }
  return pixels;
}

// ── PNG ───────────────────────────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  c = -1;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels = render(size)) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO ───────────────────────────────────────────────────────────────────────────────────────
/** A BMP frame as Windows expects it inside an .ico: bottom-up 32-bit BGRA plus an AND mask. */
function bmpFrame(size, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      xor[dst] = pixels[src + 2];
      xor[dst + 1] = pixels[src + 1];
      xor[dst + 2] = pixels[src];
      xor[dst + 3] = pixels[src + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size); // fully opaque: the 32-bit alpha channel governs
  return Buffer.concat([header, xor, mask]);
}

function ico(sizes) {
  const frames = sizes.map((size) => {
    const pixels = render(size);
    // 128 and up go in as PNG: smaller files, and every supported Windows reads them.
    return { size, data: size >= 128 ? png(size, pixels) : bmpFrame(size, pixels) };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = header.length + dir.length;
  frames.forEach((frame, i) => {
    const at = i * 16;
    dir[at] = frame.size >= 256 ? 0 : frame.size;
    dir[at + 1] = frame.size >= 256 ? 0 : frame.size;
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(frame.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += frame.data.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.data)]);
}

// ── ICNS ─────────────────────────────────────────────────────────────────────────────────────
function icns(sizes) {
  const entries = sizes.map(([type, size]) => {
    const data = png(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(entries);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// ── write ────────────────────────────────────────────────────────────────────────────────────
function writeIfChanged(path, data) {
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (existing.equals(data)) return false;
  }
  writeFileSync(path, data);
  return true;
}

mkdirSync(outDir, { recursive: true });

const targets = [
  ["32x32.png", png(32)],
  ["128x128.png", png(128)],
  ["128x128@2x.png", png(256)],
  ["icon.png", png(512)],
  ["icon.ico", ico([16, 24, 32, 48, 64, 128, 256])],
  [
    "icon.icns",
    icns([
      ["icp4", 16],
      ["icp5", 32],
      ["icp6", 64],
      ["ic07", 128],
      ["ic08", 256],
      ["ic09", 512],
      ["ic10", 1024],
    ]),
  ],
];

let changed = 0;
for (const [name, data] of targets) {
  const path = join(outDir, name);
  const wrote = writeIfChanged(path, data);
  if (wrote) changed += 1;
  console.log(`${wrote ? "wrote" : "kept "} src-tauri/icons/${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
console.log(changed === 0 ? "icons: up to date" : `icons: ${changed} file(s) written`);
