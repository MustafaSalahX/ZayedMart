import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CRC32 Lookup Table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp01(((px - x1) * dx + (py - y1) * dy) / lenSq);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function renderZayedMartIcon(size, maskable = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const margin = maskable ? 0 : size * 0.04;
  const cornerRadius = maskable ? 0 : size * 0.22;
  const glyphScale = maskable ? 0.74 : 0.88;

  // Stylized bold 'Z' + checkmark / cart accent in center
  const cx = size / 2;
  const cy = size / 2;
  const half = (size * 0.27) * glyphScale;
  const stroke = Math.max(4, size * 0.072 * glyphScale);

  // Z segments
  const zTopY = cy - half * 0.82;
  const zBotY = cy + half * 0.82;
  const zLeftX = cx - half * 0.85;
  const zRightX = cx + half * 0.85;

  // Accent green dot (live ops indicator)
  const dotX = cx + half * 0.92;
  const dotY = cy - half * 0.92;
  const dotR = size * 0.068 * glyphScale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rect SDF for non-maskable
      let bgAlpha = 1;
      if (!maskable) {
        const qx = Math.abs(x + 0.5 - cx) - (size / 2 - margin - cornerRadius);
        const qy = Math.abs(y + 0.5 - cy) - (size / 2 - margin - cornerRadius);
        const dist =
          Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
          Math.min(Math.max(qx, qy), 0) -
          cornerRadius;
        bgAlpha = clamp01(0.5 - dist);
      }

      if (bgAlpha <= 0) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }

      // Rich royal-blue gradient (#0B57D0 -> #1A73E8 -> #0842A0)
      const gradT = clamp01((x * 0.45 + y * 0.55) / size);
      let r = Math.round(26 * (1 - gradT) + 9 * gradT);
      let g = Math.round(115 * (1 - gradT) + 66 * gradT);
      let b = Math.round(232 * (1 - gradT) + 172 * gradT);

      // Soft inner glow ring
      const radial = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (size * 0.5);
      if (radial < 0.76) {
        const boost = (0.76 - radial) * 18;
        r = Math.min(255, Math.round(r + boost * 0.5));
        g = Math.min(255, Math.round(g + boost * 0.8));
        b = Math.min(255, Math.round(b + boost));
      }

      // White 'Z' glyph distance
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = distToSegment(px, py, zLeftX, zTopY, zRightX, zTopY);
      const d2 = distToSegment(px, py, zRightX, zTopY, zLeftX, zBotY);
      const d3 = distToSegment(px, py, zLeftX, zBotY, zRightX, zBotY);
      const dZ = Math.min(d1, d2, d3) - stroke * 0.5;
      const zAlpha = clamp01(0.65 - dZ);

      if (zAlpha > 0) {
        r = Math.round(r * (1 - zAlpha) + 255 * zAlpha);
        g = Math.round(g * (1 - zAlpha) + 255 * zAlpha);
        b = Math.round(b * (1 - zAlpha) + 255 * zAlpha);
      }

      // Emerald live-ops badge dot (#34A853 with white border)
      const dDot = Math.hypot(px - dotX, py - dotY);
      const borderAlpha = clamp01(0.65 - (dDot - dotR * 1.28));
      const innerDotAlpha = clamp01(0.65 - (dDot - dotR));
      if (borderAlpha > 0) {
        r = Math.round(r * (1 - borderAlpha) + 255 * borderAlpha);
        g = Math.round(g * (1 - borderAlpha) + 255 * borderAlpha);
        b = Math.round(b * (1 - borderAlpha) + 255 * borderAlpha);
      }
      if (innerDotAlpha > 0) {
        r = Math.round(r * (1 - innerDotAlpha) + 46 * innerDotAlpha);
        g = Math.round(g * (1 - innerDotAlpha) + 204 * innerDotAlpha);
        b = Math.round(b * (1 - innerDotAlpha) + 113 * innerDotAlpha);
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

const publicDir = path.resolve(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'pwa-192.png'), renderZayedMartIcon(192, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512.png'), renderZayedMartIcon(512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512.png'), renderZayedMartIcon(512, true));

console.log('Generated public/pwa-192.png, public/pwa-512.png, and public/pwa-maskable-512.png');
