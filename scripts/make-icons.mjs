// Generates VoxShelf icons with zero dependencies:
// electron/assets/icon.png (512), icon.ico (win), icon.icns (mac),
// plus PWA/Apple PNGs in public/ (Chrome installability needs bitmaps).
// Design: emerald rounded square + white waveform bars.

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "electron", "assets");

const crcTable = (() => {
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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])));
    return Buffer.concat([head, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Emerald gradient + waveform bars, rendered at `renderSize`, downsampled to `size`.
// `bleed` fills the full square (maskable / apple-touch sources).
function render(size, bleed = false) {
  const ss = size <= 64 ? 4 : 1;
  const R = size * ss;
  const hi = Buffer.alloc(R * R * 4);
  const radius = R * 0.22;
  const top = [16, 185, 129]; // emerald-500
  const bottom = [4, 120, 87]; // emerald-700
  const bars = [0.3, 0.5, 0.72, 0.92, 0.64, 0.44, 0.28];
  const maxBarH = R * 0.5;
  const barW = R * 0.062;
  const gap = R * 0.052;
  const totalW = bars.length * barW + (bars.length - 1) * gap;
  const startX = (R - totalW) / 2;

  const inRoundRect = (x, y) => {
    const cx = Math.min(Math.max(x, radius), R - radius);
    const cy = Math.min(Math.max(y, radius), R - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  };

  for (let y = 0; y < R; y++) {
    const t = y / (R - 1);
    for (let x = 0; x < R; x++) {
      const i = (y * R + x) * 4;
      if (!bleed && !inRoundRect(x + 0.5, y + 0.5)) continue; // transparent
      let r = lerp(top[0], bottom[0], t);
      let g = lerp(top[1], bottom[1], t);
      let b = lerp(top[2], bottom[2], t);
      // Waveform bars (white, rounded ends).
      for (let k = 0; k < bars.length; k++) {
        const bx = startX + k * (barW + gap);
        const bh = bars[k] * maxBarH;
        const by = (R - bh) / 2;
        const px = x + 0.5 - (bx + barW / 2);
        const py = y + 0.5 - R / 2;
        const half = Math.max(0, bh / 2 - barW / 2);
        const rad = barW / 2;
        // Capsule: distance from the vertical spine segment <= rad.
        const ax = Math.abs(px);
        const ay = Math.abs(py);
        const inside =
          ay <= half
            ? ax <= rad
            : ax * ax + (ay - half) * (ay - half) <= rad * rad;
        if (inside) {
          r = 255;
          g = 255;
          b = 255;
          break;
        }
      }
      hi[i] = r;
      hi[i + 1] = g;
      hi[i + 2] = b;
      hi[i + 3] = 255;
    }
  }

  if (ss === 1) return hi;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * R + x * ss + dx) * 4;
          r += hi[i];
          g += hi[i + 1];
          b += hi[i + 2];
          a += hi[i + 3];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function buildIco(pngs) {
  // Vista+ accepts PNG-compressed entries at every size.
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dirs = pngs.map(({ size, data }) => {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size;
    d[1] = size >= 256 ? 0 : size;
    d[4] = 1; // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += data.length;
    return d;
  });
  return Buffer.concat([head, ...dirs, ...pngs.map((p) => p.data)]);
}

function buildIcns(pngs) {
  // Modern slots with PNG payloads (macOS 10.8+ reads these).
  const entries = pngs.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(entries.reduce((n, e) => n + e.length, 8), 4);
  return Buffer.concat([head, ...entries]);
}

mkdirSync(outDir, { recursive: true });

const png512 = encodePng(512, render(512));
writeFileSync(join(outDir, "icon.png"), png512);

const icoPngs = [16, 32, 48, 256].map((size) => ({
  size,
  data: encodePng(size, render(size)),
}));
writeFileSync(join(outDir, "icon.ico"), buildIco(icoPngs));

const icnsPngs = [
  { size: 32, type: "ic11" },
  { size: 64, type: "ic12" },
  { size: 128, type: "ic07" },
  { size: 256, type: "ic08" },
  { size: 512, type: "ic09" },
  { size: 1024, type: "ic10" },
].map(({ size, type }) => ({ type, data: encodePng(size, render(size)) }));
writeFileSync(join(outDir, "icon.icns"), buildIcns(icnsPngs));

console.log("icons written to electron/assets/");

// PWA + iOS bitmaps (SVG alone fails Chrome's installability check).
const publicDir = join(root, "public");
writeFileSync(join(publicDir, "icon-192.png"), encodePng(192, render(192)));
writeFileSync(join(publicDir, "icon-512.png"), encodePng(512, render(512)));
writeFileSync(
  join(publicDir, "icon-maskable-512.png"),
  encodePng(512, render(512, true)),
);
writeFileSync(
  join(publicDir, "apple-touch-icon.png"),
  encodePng(180, render(180, true)),
);

console.log("PWA icons written to public/");
