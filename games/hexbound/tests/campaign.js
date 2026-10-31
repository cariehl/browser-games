// Headless campaign sim: AI plays every fight of a run, resting and levelling with the defaults between fights.
// Usage: node tests/campaign.js [runs] [partyIdx]
const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js', 'js/campaign.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine, C = G.Campaign;
const runs = +(process.argv[2] || 20);
const only = process.argv[3] != null ? +process.argv[3] : null;

function fight(setup, seed) {
  const sc = Object.assign({}, setup.scen, { events: (setup.scen.events || []).map(e => Object.assign({}, e, { done: false })) });
  const B = E.newBattle(sc, setup.party.heroes, Object.assign({ seed, quiet: true }, setup.opts));
  E.runAuto(E.startBattle(B));
  let turns = 0;
  while (!B.over && B.round < 20 && turns < 600) {
    const u = E.runAuto(E.nextTurn(B)); if (!u) break;
    E.runAuto(G.AI.takeTurn(B, u)); E.runAuto(E.endTurn(B, u));
    turns++; B.fx.length = 0;
  }
  if (!B.over) B.over = 'lose';
  return B;
}

G.Build.PREMADES.forEach((pm, pi) => {
  if (only != null && pi !== only) return;
  const reached = {}, deaths = [], hpIn = {};
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const run = C.newRun(pm, 'normal');
    let seed = 5000 + i * 7919;
    while (!run.outcome) {
      const nodeId = C.available(run)[0];
      const setup = C.battleSetup(run, nodeId);
      const sid = setup.scen.id;
      reached[sid] = (reached[sid] || 0) + 1;
      hpIn[sid] = (hpIn[sid] || 0) + setup.heroes.reduce((t, h) => { const s = C.status(run, h); return t + s.hp / s.maxHp; }, 0) / 4;
      const B = fight(setup, seed++);
      C.recordBattle(run, nodeId, B);
      if (run.stage === 'camp') { run.heroes.forEach((h, k) => C.autoRest(run, k)); C.breakCamp(run); }
    }
    if (run.outcome === 'victory') wins++;
    deaths.push(run.heroes.filter(h => h.dead).length);
  }
  const fmt = Object.entries(reached).map(([k, v]) => `${k} ${(v / runs * 100).toFixed(0)}% (party HP in ${(hpIn[k] / v * 100).toFixed(0)}%)`).join(' → ');
  console.log(`${pm.name}: victory ${(wins / runs * 100).toFixed(0)}% · avg heroes lost ${(deaths.reduce((a, b) => a + b, 0) / runs).toFixed(2)} · reached ${fmt}`);
});
