// Shortest Hamiltonian *path* through n points given a dense distance matrix.
// Greedy-edge construction, then 2-opt + Or-opt local search, then iterated local
// search (random segment swaps) until the time budget runs out.
// An open path is modelled as a cycle through one extra "dummy" city (index n)
// that is at distance 0 from everything.

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function solvePath(dist, n, {timeMs = 3000, seed = 1, K = 10} = {}) {
  if (n <= 2) { return Array.from({length: n}, (_, i) => i); }
  const d = (a, b) => (a === n || b === n) ? 0 : dist[a * n + b];

  // --- candidate neighbour lists (K nearest) ---------------------------------
  const k = Math.min(K, n - 1);
  const cand = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) { if (j !== i) { row.push(j); } }
    row.sort((a, b) => dist[i * n + a] - dist[i * n + b]);
    cand.push(Int32Array.from(row.slice(0, k)));
  }

  // --- greedy edge construction ----------------------------------------------
  const deg = new Uint8Array(n), adj = new Int32Array(n * 2).fill(-1);
  const uf = Int32Array.from({length: n}, (_, i) => i);
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  let edgesAdded = 0;
  const tryEdge = (a, b) => {
    if (deg[a] >= 2 || deg[b] >= 2) { return; }
    const ra = find(a), rb = find(b);
    if (ra === rb) { return; }
    uf[ra] = rb;
    adj[a * 2 + deg[a]++] = b; adj[b * 2 + deg[b]++] = a;
    edgesAdded++;
  };
  const edges = [];
  for (let i = 0; i < n; i++) { for (const j of cand[i]) { if (i < j || !cand[j].includes(i)) { edges.push([i, j]); } } }
  edges.sort((e1, e2) => dist[e1[0] * n + e1[1]] - dist[e2[0] * n + e2[1]]);
  for (const [a, b] of edges) { tryEdge(a, b); }
  // join leftover fragments through their endpoints
  while (edgesAdded < n - 1) {
    const ends = [];
    for (let i = 0; i < n; i++) { if (deg[i] < 2) { ends.push(i); } }
    const pairs = [];
    for (let x = 0; x < ends.length; x++) {
      for (let y = x + 1; y < ends.length; y++) {
        if (find(ends[x]) !== find(ends[y])) { pairs.push([ends[x], ends[y]]); }
      }
    }
    pairs.sort((p, q) => dist[p[0] * n + p[1]] - dist[q[0] * n + q[1]]);
    for (const [a, b] of pairs) { tryEdge(a, b); }
  }
  // walk the path
  let start = 0;
  for (let i = 0; i < n; i++) { if (deg[i] < 2) { start = i; break; } }
  const path = [start];
  let prev = -1, cur = start;
  while (path.length < n) {
    const nx = adj[cur * 2] !== prev && adj[cur * 2] !== -1 ? adj[cur * 2] : adj[cur * 2 + 1];
    prev = cur; cur = nx; path.push(cur);
  }

  // --- local search on the dummy-augmented cycle ------------------------------
  const m = n + 1;
  let tour = Int32Array.from([...path, n]);
  const pos = new Int32Array(m);
  const reindex = () => { for (let i = 0; i < m; i++) { pos[tour[i]] = i; } };
  reindex();
  const next = (i) => (i + 1 === m ? 0 : i + 1);
  const prevI = (i) => (i === 0 ? m - 1 : i - 1);
  const EPS = 1e-9;

  const reverse = (l, r) => {
    while (l < r) {
      const a = tour[l], b = tour[r];
      tour[l] = b; pos[b] = l; tour[r] = a; pos[a] = r;
      l++; r--;
    }
  };

  const twoOptPass = () => {
    let any = false;
    for (let a = 0; a < n; a++) {
      for (const c of cand[a]) {
        const i = pos[a], j = pos[c];
        // successor direction
        let b = tour[next(i)], e = tour[next(j)];
        let delta = d(a, c) + d(b, e) - d(a, b) - d(c, e);
        if (delta < -EPS) {
          if (i < j) { reverse(i + 1, j); } else { reverse(j + 1, i); }
          any = true; continue;
        }
        // predecessor direction
        b = tour[prevI(i)]; e = tour[prevI(j)];
        delta = d(a, c) + d(b, e) - d(a, b) - d(c, e);
        if (delta < -EPS) {
          if (i < j) { reverse(i, j - 1); } else { reverse(j, i - 1); }
          any = true;
        }
      }
    }
    return any;
  };

  const rotateDummyFirst = () => {
    const p = pos[n];
    if (p === 0) { return; }
    tour = Int32Array.from([...tour.subarray(p), ...tour.subarray(0, p)]);
    reindex();
  };

  // Move segment tour[i..i+L-1] next to a neighbour of one of its ends.
  const orOptPass = () => {
    let any = false;
    rotateDummyFirst();
    for (let L = 1; L <= 3; L++) {
      for (let i = 1; i + L - 1 <= m - 1; i++) {
        const s0 = tour[i], sL = tour[i + L - 1];
        const p = tour[i - 1], q = tour[(i + L) % m];
        const removeGain = d(p, s0) + d(sL, q) - d(p, q);
        if (removeGain <= EPS) { continue; }
        let best = null, bestDelta = -EPS;
        for (const end of [0, 1]) {
          const x = end === 0 ? s0 : sL;
          for (const c of cand[x]) {
            const pc = pos[c];
            if (pc >= i && pc <= i + L - 1) { continue; }
            // place segment between c and succ(c), or between pred(c) and c,
            // with x adjacent to c.
            for (const side of [0, 1]) {
              const o = side === 0 ? tour[next(pc)] : tour[prevI(pc)];
              if (o === s0 || o === sL) { continue; }
              if (o === p && c === q || o === q && c === p) { /* c,o straddle the removed gap */ }
              const y = end === 0 ? sL : s0; // far end of the segment
              const delta = d(c, x) + d(y, o) - d(c, o) - removeGain;
              if (delta < bestDelta) { bestDelta = delta; best = {c, o, x, y, side}; }
            }
          }
        }
        if (best) {
          applyOrMove(i, L, best);
          any = true;
          rotateDummyFirst();
        }
      }
    }
    return any;
  };

  const applyOrMove = (i, L, {c, o, x, y}) => {
    const seg = Array.from(tour.subarray(i, i + L));
    const rest = [];
    for (let t = 0; t < m; t++) { if (t < i || t >= i + L) { rest.push(tour[t]); } }
    // edges to create: (c,x) and (y,o); c and o are adjacent in `rest`
    // unless they were separated by the removed segment (then adjacent now).
    const ic = rest.indexOf(c), io = rest.indexOf(o);
    let lo, hi;
    if ((ic + 1) % rest.length === io) { lo = c; hi = o; } else { lo = o; hi = c; }
    // arrange segment so that it runs lo -> hi
    const orient = (lo === c) ? [x, y] : [y, x];
    const ordered = (seg[0] === orient[0]) ? seg : seg.slice().reverse();
    const at = rest.indexOf(lo);
    const nt = rest.slice(0, at + 1).concat(ordered, rest.slice(at + 1));
    tour = Int32Array.from(nt);
    reindex();
  };

  const localSearch = () => {
    for (let guard = 0; guard < 1000; guard++) {
      const a = twoOptPass();
      const b = orOptPass();
      if (!a && !b) { break; }
    }
  };
  const cost = () => { let s = 0; for (let i = 0; i < m; i++) { s += d(tour[i], tour[next(i)]); } return s; };

  localSearch();
  let bestCost = cost(), bestTour = Int32Array.from(tour);

  // --- iterated local search ---------------------------------------------------
  const rnd = mulberry32(seed);
  const deadline = Date.now() + timeMs;
  while (n >= 8 && Date.now() < deadline) {
    rotateDummyFirst();
    // swap two adjacent short blocks (a local double-bridge)
    const maxLen = Math.max(1, Math.min(30, Math.floor((n - 2) / 3)));
    const l1 = 1 + Math.floor(rnd() * maxLen), l2 = 1 + Math.floor(rnd() * maxLen);
    const s = 1 + Math.floor(rnd() * Math.max(1, n - l1 - l2));
    if (s + l1 + l2 > m) { continue; }
    const arr = Array.from(tour);
    const B = arr.slice(s, s + l1), C = arr.slice(s + l1, s + l1 + l2);
    tour = Int32Array.from(arr.slice(0, s).concat(C, B, arr.slice(s + l1 + l2)));
    reindex();
    localSearch();
    const c = cost();
    if (c < bestCost - EPS) { bestCost = c; bestTour = Int32Array.from(tour); }
    else { tour = Int32Array.from(bestTour); reindex(); }
  }

  tour = bestTour; reindex(); rotateDummyFirst();
  return Array.from(tour.subarray(1));
}

export function pathCost(dist, n, order) {
  let s = 0;
  for (let i = 0; i + 1 < order.length; i++) { s += dist[order[i] * n + order[i + 1]]; }
  return s;
}
