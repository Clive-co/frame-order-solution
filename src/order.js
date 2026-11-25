// Frame distances and path orientation.
const POWER = +(process.env.FO_POWER ?? 2); // final cost = dist^POWER; >1 discourages a few huge jumps
const MULTI = (process.env.FO_MULTI ?? '1') === '1';

// 2x2 box-average a (w x h x 3) float image.
function halve(f, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const out = new Float32Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x1 = Math.min(w - 1, 2 * x + 1), y1 = Math.min(h - 1, 2 * y + 1);
      for (let c = 0; c < 3; c++) {
        out[(y * nw + x) * 3 + c] = (f[(2 * y * w + 2 * x) * 3 + c] + f[(2 * y * w + x1) * 3 + c] +
          f[(y1 * w + 2 * x) * 3 + c] + f[(y1 * w + x1) * 3 + c]) / 4;
      }
    }
  }
  return {f: out, w: nw, h: nh};
}

// Plain Euclidean distance matrix (float32, n*n) for equally-sized vectors.
function l2Matrix(vecs) {
  const n = vecs.length, D = vecs[0].length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const a = vecs[i];
    for (let j = i + 1; j < n; j++) {
      const b = vecs[j];
      let s = 0;
      for (let k = 0; k < D; k++) { const t = a[k] - b[k]; s += t * t; }
      m[i * n + j] = m[j * n + i] = Math.sqrt(s);
    }
  }
  return m;
}

function median(m, n) {
  const sample = [];
  const stride = Math.max(1, Math.floor(n * n / 4000));
  for (let idx = 1; idx < n * n; idx += stride) { if (idx % n !== Math.floor(idx / n)) { sample.push(m[idx]); } }
  sample.sort((a, b) => a - b);
  return sample[sample.length >> 1] || 1;
}

export function buildDistances(feats, grid) {
  const n = feats.length, D = feats[0].length;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < D; k += 3) { s += 0.299 * feats[i][k] + 0.587 * feats[i][k + 1] + 0.114 * feats[i][k + 2]; }
    lum[i] = s / (D / 3);
  }
  // Pyramid of progressively coarser versions of every frame.
  const levels = [{vecs: feats, w: grid.w, h: grid.h}];
  while (MULTI && Math.max(levels.at(-1).w, levels.at(-1).h) > 4) {
    const prev = levels.at(-1);
    const next = prev.vecs.map(f => halve(f, prev.w, prev.h));
    levels.push({vecs: next.map(x => x.f), w: next[0].w, h: next[0].h});
  }
  // Each level's distances are normalised by their median so that no level
  // dominates, then summed.
  let total = null;
  for (const lv of levels) {
    const m = l2Matrix(lv.vecs);
    const med = median(m, n);
    if (!total) { total = m; for (let i = 0; i < m.length; i++) { total[i] = m[i] / med; } }
    else { for (let i = 0; i < m.length; i++) { total[i] += m[i] / med; } }
  }
  if (POWER !== 1) { for (let i = 0; i < total.length; i++) { total[i] = Math.pow(total[i], POWER); } }
  return {dist: total, lum};
}

// A path is the same cost either way round; pick the direction that is more
// likely to be forward in time. Heuristic: videos far more often fade in from
// black than out to it, so the darker end goes first.
export function orientPath(path, lum) {
  if (path.length < 2) { return path; }
  const first = lum[path[0]], last = lum[path[path.length - 1]];
  return first <= last ? path : path.slice().reverse();
}
