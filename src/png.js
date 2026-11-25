// Minimal dependency-free PNG decoder. Returns {width, height, rgb} with 8-bit RGB.
// Supports all colour types / bit depths, palettes, tRNS-on-palette, alpha
// (composited over black) and Adam7 interlacing.
import {inflateSync} from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) { throw new Error('not a PNG'); }
  let off = 8, hdr = null, palette = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      hdr = {w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ct: data[9], interlace: data[12]};
    } else if (type === 'PLTE') { palette = data; }
    else if (type === 'tRNS') { trns = data; }
    else if (type === 'IDAT') { idat.push(data); }
    else if (type === 'IEND') { break; }
  }
  if (!hdr || !idat.length) { throw new Error('bad PNG'); }
  const {w, h, depth, ct} = hdr;
  const channels = CHANNELS[ct];
  if (!channels) { throw new Error('bad colour type'); }
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 3);
  const mask = (1 << depth) - 1;
  let rp = 0;

  const passes = hdr.interlace ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) { continue; }
    const stride = Math.ceil(pw * bitsPP / 8);
    const lines = new Uint8Array(stride * ph);
    for (let y = 0; y < ph; y++) {
      const ft = raw[rp++];
      const o = y * stride, po = o - stride;
      const hasPrev = y > 0;
      if (ft === 0) {
        lines.set(raw.subarray(rp, rp + stride), o); rp += stride;
        continue;
      }
      // first bpp bytes have no left neighbour
      const head = Math.min(bpp, stride);
      for (let i = 0; i < head; i++) {
        const x = raw[rp + i], b = hasPrev ? lines[po + i] : 0;
        lines[o + i] = ft === 1 ? x : ft === 2 ? x + b : ft === 3 ? x + (b >> 1) : x + b; // paeth with a=c=0 -> b
      }
      if (ft === 1) {
        for (let i = bpp; i < stride; i++) { lines[o + i] = raw[rp + i] + lines[o + i - bpp]; }
      } else if (ft === 2) {
        if (hasPrev) { for (let i = bpp; i < stride; i++) { lines[o + i] = raw[rp + i] + lines[po + i]; } }
        else { for (let i = bpp; i < stride; i++) { lines[o + i] = raw[rp + i]; } }
      } else if (ft === 3) {
        for (let i = bpp; i < stride; i++) {
          lines[o + i] = raw[rp + i] + ((lines[o + i - bpp] + (hasPrev ? lines[po + i] : 0)) >> 1);
        }
      } else if (ft === 4) {
        for (let i = bpp; i < stride; i++) {
          const a = lines[o + i - bpp], b = hasPrev ? lines[po + i] : 0, c = hasPrev ? lines[po + i - bpp] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          lines[o + i] = raw[rp + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
      } else { throw new Error('bad filter'); }
      rp += stride;
    }
    if (depth === 8 && ct === 2 && !hdr.interlace) { out.set(lines); continue; }
    for (let py = 0; py < ph; py++) {
      const ro = py * stride;
      for (let px = 0; px < pw; px++) {
        let r, g, bl, al = 255;
        if (depth === 8 || depth === 16) {
          const step = depth === 8 ? 1 : 2;
          const s = (c) => lines[ro + (px * channels + c) * step];
          if (ct === 0) { r = g = bl = s(0); }
          else if (ct === 2) { r = s(0); g = s(1); bl = s(2); }
          else if (ct === 3) { const k = s(0); r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; if (trns && k < trns.length) { al = trns[k]; } }
          else if (ct === 4) { r = g = bl = s(0); al = s(1); }
          else { r = s(0); g = s(1); bl = s(2); al = s(3); }
        } else {
          const bit = px * depth;
          const v = (lines[ro + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
          if (ct === 3) { r = palette[v * 3]; g = palette[v * 3 + 1]; bl = palette[v * 3 + 2]; if (trns && v < trns.length) { al = trns[v]; } }
          else { r = g = bl = Math.round(v * 255 / mask); }
        }
        if (al !== 255) { r = r * al / 255; g = g * al / 255; bl = bl * al / 255; }
        const oi = ((y0 + py * dy) * w + (x0 + px * dx)) * 3;
        out[oi] = r; out[oi + 1] = g; out[oi + 2] = bl;
      }
    }
  }
  return {width: w, height: h, rgb: out};
}
