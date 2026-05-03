#!/usr/bin/env node
/* Generates PWA icons in public/.
 *
 * Zero external deps — uses Node's built-in zlib to emit valid PNGs.
 * Wired into `prebuild` so a fresh clone produces icons automatically.
 *
 * Design: black square (#0c0a09) with a centred yellow (#facc15) "S".
 * Sjoerd: when real artwork is ready, either
 *   (a) drop the final PNGs into public/ and remove the prebuild hook, or
 *   (b) replace the SVG/glyph below and re-run.
 *
 * Idempotent — safe to re-run; overwrites existing files.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
mkdirSync(PUBLIC_DIR, { recursive: true });

// 5x7 bitmap font glyph for "S"
const S_GLYPH = [
  "01110",
  "10001",
  "10000",
  "01110",
  "00001",
  "10001",
  "01110",
];

const BG = [0x0c, 0x0a, 0x09, 0xff];
const FG = [0xfa, 0xcc, 0x15, 0xff];

// Manual CRC-32 (zlib doesn't expose crc32 in older Node majors; we have ours).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, payload])), 0);
  return Buffer.concat([len, t, payload, crcBuf]);
}

function makePng(size, maskable = false) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = BG[0];
    data[i * 4 + 1] = BG[1];
    data[i * 4 + 2] = BG[2];
    data[i * 4 + 3] = BG[3];
  }
  // Render glyph at ~60% (or 45% maskable safe zone) of canvas.
  const safe = maskable ? 0.45 : 0.6;
  const finalH = Math.round(size * safe);
  const cellH = Math.max(1, Math.floor(finalH / 7));
  const cellW = cellH; // square cells
  const startX = Math.floor((size - cellW * 5) / 2);
  const startY = Math.floor((size - cellH * 7) / 2);
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (S_GLYPH[gy][gx] !== "1") continue;
      for (let py = 0; py < cellH; py++) {
        for (let px = 0; px < cellW; px++) {
          const x = startX + gx * cellW + px;
          const y = startY + gy * cellH + py;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const idx = (y * size + x) * 4;
          data[idx] = FG[0];
          data[idx + 1] = FG[1];
          data[idx + 2] = FG[2];
          data[idx + 3] = FG[3];
        }
      }
    }
  }
  // Wrap rows with PNG filter byte 0.
  const rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0;
    data.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-192-maskable.png", size: 192, maskable: true },
  { name: "icon-512-maskable.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: false },
  { name: "favicon.ico", size: 32, maskable: false },
];

let wrote = 0;
let skipped = 0;
const force = process.argv.includes("--force");
for (const t of TARGETS) {
  const out = resolve(PUBLIC_DIR, t.name);
  if (!force && existsSync(out)) {
    skipped++;
    continue;
  }
  writeFileSync(out, makePng(t.size, t.maskable));
  wrote++;
}
console.log(`pwa-icons: wrote ${wrote}, skipped ${skipped} (use --force to regenerate)`);
