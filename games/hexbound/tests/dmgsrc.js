const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine;
const scen = G.Scenarios.find(s => s.id === (process.argv[2] || 'golem'));
const by = {}; let wins = 0; const N = +(process.argv[4] || 10);
for (let i = 0; i < N; i++) {
  const sc = Object.assign({}, scen, { events: scen.events.map(e => Object.assign({}, e, { done: false })) });
  const B = E.newBattle(sc, G.Build.PREMADES[+(process.argv[3] || 0)].heroes, { seed: 77 + i * 13 });
  E.runAuto(E.startBattle(B));
  let cur = null;
  const origLog = E.log;
  let t = 0;
  while (!B.over && B.round < 20 && t++ < 600) {
    const u = E.runAuto(E.nextTurn(B)); if (!u) break;
    cur = u;
    const before = B.log.length;
    E.runAuto(G.AI.takeTurn(B, u)); E.runAuto(E.endTurn(B, u));
    if (u.side === 'enemy') for (const l of B.log.slice(before)) { const m = l.msg.match(/^(.*) takes (\d+)/); if (m && B.units.find(h => h.side === 'hero' && h.name === m[1])) by[u.name] = (by[u.name] || 0) + +m[2]; }
  }
  if (B.over === 'win') wins++;
}
console.log('wins', wins, '/', N); console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + Math.round(v / N)).join('\n'));
