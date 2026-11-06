// Headless balance sim: AI plays both sides. Usage: node tests/sim.js [runs] [scenarioId] [partyIdx]
const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine;
const runs = +(process.argv[2] || 50);
const only = process.argv[3];
const partyIdx = process.argv[4] != null ? +process.argv[4] : null;

function play(scen, party, seed) {
  const sc = JSON.parse(JSON.stringify(scen, (k, v) => typeof v === 'function' ? undefined : v));
  // keep event functions
  sc.events = (scen.events || []).map(e => Object.assign({}, e, { done: false }));
  const B = E.newBattle(sc, party, { seed, quiet: true });
  E.runAuto(E.startBattle(B));
  let turns = 0;
  while (!B.over && B.round < 20 && turns < 600) {
    const u = E.runAuto(E.nextTurn(B));
    if (!u) break;
    E.runAuto(G.AI.takeTurn(B, u));
    E.runAuto(E.endTurn(B, u));
    turns++;
    B.fx.length = 0;
  }
  return B;
}

const results = {};
for (const scen of G.Scenarios) {
  if (only && scen.id !== only) continue;
  G.Build.PREMADES.forEach((pm, pi) => {
    if (partyIdx != null && pi !== partyIdx) return;
    let wins = 0, rounds = 0, deaths = 0, errors = 0, dmg = {}, hpLeft = 0;
    for (let i = 0; i < runs; i++) {
      try {
        const B = play(scen, pm.heroes, 1000 + i * 7919);
        if (B.over === 'win') wins++;
        rounds += B.round;
        const heroes = B.units.filter(u => u.side === 'hero');
        deaths += heroes.filter(u => u.dead).length;
        hpLeft += heroes.reduce((t, u) => t + Math.max(0, u.hp) / u.maxHp, 0) / heroes.length;
        for (const h of heroes) dmg[h.name] = (dmg[h.name] || 0) + B.stats[h.uid].dmg;
      } catch (e) { errors++; if (errors < 3) console.error(e.stack); }
    }
    const k = `${scen.id} / ${pm.name}`;
    results[k] = { win: (wins / runs * 100).toFixed(0) + '%', avgRounds: (rounds / runs).toFixed(1), heroDeaths: (deaths / runs).toFixed(2), hpLeft: (hpLeft / runs * 100).toFixed(0) + '%', errors, dmg: Object.fromEntries(Object.entries(dmg).map(([n, d]) => [n, Math.round(d / runs)])) };
    console.log(k, JSON.stringify(results[k]));
  });
}
