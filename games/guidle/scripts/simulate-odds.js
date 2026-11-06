// Works out each badge's odds and writes src/odds.json as { id: { p, m } } where m is the method:
//   exact     closed-form probability defined in src/badges.js
//   sim       share of simulated rolls (needs at least MIN_HITS hits)
//   estimate  rough closed-form estimate for very rare patterns, bucketed to 1/5/10/50... in the page
// Usage: node scripts/simulate-odds.js [rolls] [workers]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const G = require('../src/badges.js');

if (!isMainThread) {
  const { randomUUID } = require('crypto');
  const hits = Object.fromEntries(G.BADGES.map(b => [b.id, 0]));
  for (let i = 0; i < workerData.n; i++) {
    for (const h of G.evaluate(randomUUID())) hits[h.b.id]++;
    if (i % 1_000_000 === 999_999) parentPort.postMessage({ progress: 1_000_000 });
  }
  parentPort.postMessage({ hits });
  return;
}

const fs = require('fs');
const N = Number(process.argv[2] || 20_000_000);
const W = Number(process.argv[3] || require('os').cpus().length);
const MIN_HITS = 100;
const total = Object.fromEntries(G.BADGES.map(b => [b.id, 0]));
let done = 0, finished = 0;
const t0 = Date.now();
for (let w = 0; w < W; w++) {
  const worker = new Worker(__filename, { workerData: { n: Math.ceil(N / W) } });
  worker.on('message', m => {
    if (m.progress) { done += m.progress; console.error(`${(done / 1e6).toFixed(0)}M rolls, ${((Date.now() - t0) / 1000).toFixed(0)}s`); return; }
    for (const k in m.hits) total[k] += m.hits[k];
    if (++finished === W) report(Math.ceil(N / W) * W);
  });
}

function report(n) {
  const odds = {};
  for (const b of G.BADGES) {
    const simP = total[b.id] / n;
    if (b.exact !== undefined) odds[b.id] = { p: b.exact, m: 'exact' };
    else if (total[b.id] >= MIN_HITS || b.est === undefined) odds[b.id] = { p: simP || 1 / n, m: total[b.id] >= MIN_HITS ? 'sim' : 'estimate' };
    else odds[b.id] = { p: b.est, m: 'estimate' };
    const o = odds[b.id];
    console.log(b.id.padEnd(14), o.m.padEnd(9), ('1 in ' + Math.round(1 / o.p).toLocaleString()).padStart(18),
      `sim 1 in ${simP ? Math.round(1 / simP).toLocaleString() : '-'} (${total[b.id]} hits)`);
  }
  fs.writeFileSync(path.join(__dirname, '../src/odds.json'), JSON.stringify({ rolls: n, odds }, null, 1) + '\n');
}
