// Rolls many random UUIDs through the badge engine and records how often each badge is awarded.
// Usage: node scripts/simulate-odds.js [rolls]  -> writes src/odds.json
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const G = require('../src/badges.js');

const N = Number(process.argv[2] || 2_000_000);
const hits = Object.fromEntries(G.BADGES.map(b => [b.id, 0]));
for (let i = 0; i < N; i++) for (const h of G.evaluate(randomUUID())) hits[h.b.id]++;

const odds = {};
for (const b of G.BADGES) {
  const p = hits[b.id] / N;
  odds[b.id] = b.analytic && hits[b.id] < 200 ? b.analytic : (hits[b.id] ? p : 1 / (N * 10));
}
fs.writeFileSync(path.join(__dirname, '../src/odds.json'), JSON.stringify(odds, null, 1) + '\n');
G.applyOdds(odds);
for (const b of [...G.BADGES].sort((a, b) => b.p - a.p))
  console.log(b.tier.padEnd(10), b.id.padEnd(14), hits[b.id].toString().padStart(8), ('1 in ' + Math.round(1 / b.p)).padStart(14));
