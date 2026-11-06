// Simulates many rolls with the current odds/points and records how roll scores are distributed.
// Writes src/scores.json, which the page uses to give each roll a "Top X%" and a rating.
// Usage: node scripts/simulate-scores.js [rolls] [workers]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const G = require('../src/badges.js');
G.applyOdds(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/odds.json'), 'utf8')).odds);
const DENSE = 2000; // exact counts for scores below this; log-spaced bins (100 per decade) above

if (!isMainThread) {
  const { randomUUID } = require('crypto');
  const dense = new Array(DENSE).fill(0), log = {};
  for (let i = 0; i < workerData.n; i++) {
    const s = G.scoreOf(G.evaluate(randomUUID())).total;
    if (s < DENSE) dense[s]++; else { const k = Math.floor(Math.log10(s) * 100); log[k] = (log[k] || 0) + 1; }
  }
  parentPort.postMessage({ dense, log });
  return;
}

const N = Number(process.argv[2] || 8_000_000), W = Number(process.argv[3] || require('os').cpus().length);
const dense = new Array(DENSE).fill(0), log = {};
let finished = 0;
for (let w = 0; w < W; w++) {
  new Worker(__filename, { workerData: { n: Math.ceil(N / W) } }).on('message', m => {
    m.dense.forEach((c, i) => dense[i] += c);
    for (const k in m.log) log[k] = (log[k] || 0) + m.log[k];
    if (++finished < W) return;
    const rolls = Math.ceil(N / W) * W;
    fs.writeFileSync(path.join(__dirname, '../src/scores.json'), JSON.stringify({ rolls, dense, log }) + '\n');
    const rank = G.makeRanker({ rolls, dense, log });
    for (const s of [6, 20, 50, 100, 300, 1000, 5000, 20000, 100000, 1e6, 5e7]) {
      const f = rank(s); console.log(String(s).padStart(9), 'top', (f * 100).toPrecision(3) + '%', G.tierFor(f));
    }
  });
}
