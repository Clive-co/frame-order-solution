// Turn decoded frames into small float feature vectors (box-downsampled RGB).
// Decoding is spread across worker threads when more than one core is available.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {availableParallelism} from 'node:os';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {decodePng} from './png.js';

// Budget for the O(n^2 * dims) distance computation (rough number of float ops).
const OP_BUDGET = +(process.env.FO_BUDGET ?? 1.5e9);
const MAX_DIMS = 48 * 48 * 3;
const MIN_DIMS = 8 * 8 * 3;

export function chooseGrid(n, w, h) {
  const dims = Math.max(MIN_DIMS, Math.min(MAX_DIMS, Math.floor(OP_BUDGET * 2 / (n * n))));
  const tw = Math.max(1, Math.min(w, Math.round(Math.sqrt(dims / 3 * w / h))));
  const th = Math.max(1, Math.min(h, Math.round(tw * h / w)));
  return [tw, th];
}

export function downsample({width: w, height: h, rgb}, tw, th) {
  const out = new Float32Array(tw * th * 3);
  const cnt = new Float32Array(tw * th);
  const tx = new Int32Array(w);
  for (let x = 0; x < w; x++) { tx[x] = Math.min(tw - 1, Math.floor(x * tw / w)); }
  for (let y = 0; y < h; y++) {
    const rowBase = Math.min(th - 1, Math.floor(y * th / h)) * tw;
    for (let x = 0; x < w; x++) {
      const cell = rowBase + tx[x], i = (y * w + x) * 3, o = cell * 3;
      out[o] += rgb[i]; out[o + 1] += rgb[i + 1]; out[o + 2] += rgb[i + 2];
      cnt[cell]++;
    }
  }
  for (let c = 0; c < tw * th; c++) {
    const k = cnt[c] || 1;
    out[c * 3] /= k; out[c * 3 + 1] /= k; out[c * 3 + 2] /= k;
  }
  return out;
}

// Decode files[i] -> {w, h, feat} (or null on failure), using the given grid chooser.
function processFiles(dir, items, n, grid) {
  return items.map(([idx, name]) => {
    try {
      const img = decodePng(readFileSync(join(dir, name)));
      const g = grid ?? chooseGrid(n, img.width, img.height);
      return [idx, img.width, img.height, g, downsample(img, g[0], g[1])];
    } catch (e) {
      process.stderr.write(`warning: could not decode ${name}: ${e.message}\n`);
      return [idx, 0, 0, null, null];
    }
  });
}

if (!isMainThread && workerData?.job === 'features') {
  const {dir, items, n, grid} = workerData;
  parentPort.postMessage(processFiles(dir, items, n, grid));
}

// Returns {feats, grid}; feats[i] is null for frames that failed to decode or
// differ in size from the first frame.
export async function loadFeatures(dir, names) {
  const n = names.length;
  const feats = new Array(n).fill(null);
  if (!n) { return {feats, grid: null}; }
  const all = names.map((name, i) => [i, name]);

  // Decode frame 0..k on the main thread until we know the grid, then fan out.
  let grid = null, size = null;
  const record = (rows) => {
    for (const [idx, w, h, g, f] of rows) {
      if (!f) { continue; }
      if (!grid) { grid = g; size = [w, h]; }
      if (w === size[0] && h === size[1]) { feats[idx] = f; }
    }
  };
  let rest = all;
  while (!grid && rest.length) { record(processFiles(dir, rest.slice(0, 1), n, null)); rest = rest.slice(1); }
  if (!grid) { return {feats, grid: null}; }

  const workers = Math.min(+(process.env.FO_WORKERS ?? availableParallelism()), Math.ceil(rest.length / 8));
  if (workers <= 1) {
    record(processFiles(dir, rest, n, grid));
  } else {
    const chunks = Array.from({length: workers}, () => []);
    rest.forEach((it, i) => chunks[i % workers].push(it));
    const results = await Promise.all(chunks.map(items => new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), {workerData: {job: 'features', dir, items, n, grid}});
      w.once('message', resolve); w.once('error', reject);
    })));
    results.forEach(record);
  }
  return {feats, grid: {w: grid[0], h: grid[1]}};
}
