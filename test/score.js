// node test/score.js VIDEOS_DIR   -- runs ../order.js on each video, compares with truth.txt
import {readdirSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root = process.argv[2];
const only = process.argv[3];
for (const v of readdirSync(root).sort()) {
  if (only && !v.includes(only)) { continue; }
  const truth = readFileSync(`${root}/${v}/truth.txt`, 'utf8').trim().split('\n');
  const t0 = Date.now();
  const got = execFileSync('node', [new URL('../order.js', import.meta.url).pathname, `${root}/${v}/frames`], {encoding: 'utf8', maxBuffer: 1 << 28}).trim().split('\n');
  const ms = Date.now() - t0;
  const n = truth.length;
  if (new Set(got).size !== n || got.length !== n) { console.log(v, 'INVALID OUTPUT'); continue; }
  const tp = new Map(truth.map((x, i) => [x, i]));
  const idx = got.map(x => tp.get(x));
  let adj = 0, fwd = 0, rev = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (Math.abs(idx[i + 1] - idx[i]) === 1) { adj++; }
    if (idx[i + 1] === idx[i] + 1) { fwd++; }
    if (idx[i + 1] === idx[i] - 1) { rev++; }
  }
  const dirOk = fwd >= rev ? 'forward' : 'REVERSED';
  console.log(v.padEnd(16), `n=${String(n).padEnd(5)} adjacent-correct ${(100 * adj / (n - 1)).toFixed(1).padStart(5)}%  direction ${dirOk.padEnd(8)}  ${ms}ms`);
}
