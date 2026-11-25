import {readdirSync, readFileSync} from 'node:fs';
import {decodePng} from '../src/png.js';
const dir = process.argv[2];
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.png')).sort()) {
  const img = decodePng(readFileSync(`${dir}/${f}`));
  const npy = readFileSync(`${dir}/${f.replace('.png', '.npy')}`);
  // .npy header: 128 bytes for these small arrays; float64 data
  const hl = 10 + npy.readUInt16LE(8);
  const exp = new Float64Array(npy.buffer.slice(npy.byteOffset + hl, npy.byteOffset + npy.length));
  let maxErr = 0;
  for (let i = 0; i < exp.length; i++) { maxErr = Math.max(maxErr, Math.abs(exp[i] - img.rgb[i])); }
  const ok = img.rgb.length === exp.length && maxErr <= 1;
  if (!ok) { bad++; }
  console.log(ok ? 'ok  ' : 'FAIL', f.padEnd(22), 'max err', maxErr);
}
process.exit(bad ? 1 : 0);
