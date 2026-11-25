import {readdirSync} from 'node:fs';
import {loadFeatures} from './src/features.js';
import {solvePath} from './src/tsp.js';
import {buildDistances, orientPath} from './src/order.js';

const dir = process.argv[2] ?? '/frames';
const names = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.png')).sort();
const n = names.length;

const {feats, grid} = await loadFeatures(dir, names);
const ok = [], failed = [];
feats.forEach((f, i) => (f ? ok : failed).push(i));

let order = [];
if (ok.length) {
  const {dist, lum} = buildDistances(ok.map(i => feats[i]), grid);
  const budget = Math.min(+(process.env.FO_MAXMS ?? 1500), 100 + ok.length * 2);
  const path = solvePath(dist, ok.length, {timeMs: budget});
  order = orientPath(path, lum).map(k => ok[k]);
}
// Any frame we could not decode still has to appear exactly once.
for (const i of failed) { order.push(i); }
for (const i of order) { console.log(names[i]); }
