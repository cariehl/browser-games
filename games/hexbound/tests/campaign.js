// Headless campaign sim: AI plays every fight of a three-act run, and a simple policy walks the map, answers
// events, shops, rests and takes loot. Usage: node tests/campaign.js [runs] [partyIdx] [--verbose]
const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/data/gear.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/data/encounters.js', 'js/data/events.js', 'js/ai.js', 'js/campaign.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine, C = G.Campaign;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const verbose = process.argv.includes('--verbose');
const runs = +(args[0] || 10);
const only = args[1] != null ? +args[1] : null;

function fight(setup, seed) {
  const sc = Object.assign({}, setup.scen, { events: (setup.scen.events || []).map(e => Object.assign({}, e, { done: false })) });
  const B = E.newBattle(sc, setup.party.heroes, Object.assign({ seed, quiet: true }, setup.opts));
  E.runAuto(E.startBattle(B));
  let turns = 0;
  while (!B.over && B.round < 20 && turns < 700) {
    const u = E.runAuto(E.nextTurn(B)); if (!u) break;
    E.runAuto(G.AI.takeTurn(B, u)); E.runAuto(E.endTurn(B, u));
    turns++; B.fx.length = 0;
  }
  if (!B.over) B.over = 'lose';
  return B;
}

const hpFrac = (run) => { const hs = C.living(run); return hs.reduce((t, h) => { const s = C.status(run, h); return t + s.hp / s.maxHp; }, 0) / hs.length; };
// a plain policy: fight when healthy, look for rest and shops when hurt
function pickNode(run, rand) {
  const opts = C.available(run).map(id => C.nodeOf(run, id));
  const hp = hpFrac(run);
  const w = (n) => ({ combat: hp > 0.5 ? 3 : 1, elite: hp > 0.75 ? 3 : 0.2, event: 2, shop: run.gold >= 60 ? 3 : 1, rest: hp < 0.6 ? 5 : 1, treasure: 4, boss: 1 }[n.type]);
  const tot = opts.reduce((t, n) => t + w(n), 0); let x = rand() * tot;
  for (const n of opts) { x -= w(n); if (x <= 0) return n.id; }
  return opts[0].id;
}
function playEvent(run, rand) {
  const ev = G.Events[run.event.id];
  let best = ev.choices.length - 1, bs = -1;
  ev.choices.forEach((c, k) => {
    if (!C.choiceOpen(run, c).ok) return;
    const s = c.check ? C.checkOdds(run, c.check.skill, c.check.dc).chance : c.luck ? 0.5 : c.outcome && c.outcome.curse ? 0.2 : 0.6;
    if (s > bs) { bs = s; best = k; }
  });
  C.resolveChoice(run, best, rand);
}
function playShop(run) {
  const s = run.shop;
  if (run.heroes.some(h => h.dead)) C.buy(run, 'service', 2);
  if (hpFrac(run) < 0.6) C.buy(run, 'service', 0);
  C.buy(run, 'service', 1);
  s.gear.forEach((g, k) => { if (run.gold >= g.price) C.buy(run, 'gear', k); });
  s.items.forEach((it, k) => { if (run.gold >= it.price) C.buy(run, 'item', k); });
}

const fmtPct = (n, d) => (n / d * 100).toFixed(0) + '%';
G.Build.PREMADES.forEach((pm, pi) => {
  if (only != null && pi !== only) return;
  let wins = 0, deaths = 0, fights = 0, actsReached = [0, 0, 0], diedAt = {}, gold = 0, lv = 0, stash = 0;
  for (let i = 0; i < runs; i++) {
    let s = 9001 + i * 7919;
    const rand = G.Encounters.rng(s);
    const run = C.newRun(pm, 'normal', { seed: s, rand });
    let guard = 0;
    while (!run.outcome && guard++ < 80) {
      actsReached[run.act] = Math.max(actsReached[run.act], i + 1);
      const id = pickNode(run, rand);
      const stage = C.enter(run, id, rand);
      if (stage === 'battle' || stage === 'event') {
        if (stage === 'event') { playEvent(run, rand); if (!run.event.fight) { C.leave(run); continue; } }
        const setup = C.battleSetup(run, id);
        const B = fight(setup, s++);
        fights++;
        const r = C.recordBattle(run, id, B, rand);
        if (verbose) console.log(`  act ${run.act + 1} L${run.level} ${setup.kind} ${B.scen.name}: ${B.over} in ${B.round} rds, party HP ${fmtPct(hpFrac(run) * 100, 100)}${r.fallen.length ? ' ☠ ' + r.fallen.join(', ') : ''}`);
        if (!r.won) { diedAt[B.scen.name] = (diedAt[B.scen.name] || 0) + 1; break; }
        if (run.camp) {
          if (run.camp.gear.length) C.takeGear(run, run.camp.gear[0]);
          run.heroes.forEach((h, k) => C.autoRest(run, k));
          if (!run.outcome) C.breakCamp(run);
        }
      } else if (stage === 'shop') { playShop(run); C.leave(run); }
      else if (stage === 'rest') { C.restAt(run, run.heroes.some(h => h.dead) ? 'vigil' : hpFrac(run) < 0.7 ? 'recover' : run.heroes.some(h => h.daily.length) ? 'meditate' : 'scavenge', rand); C.leave(run); }
      else if (stage === 'treasure') { C.openChest(run, true, rand); C.leave(run); }
      else C.leave(run);
    }
    if (run.outcome === 'victory') wins++;
    deaths += run.heroes.filter(h => h.dead).length; gold += run.gold; lv += run.level; stash += run.heroes.reduce((t, h) => t + Object.values(h.gear).filter(Boolean).length, 0);
    if (verbose) console.log(`${pm.name} run ${i + 1}: ${run.outcome} · act ${run.act + 1} · L${run.level} · ${run.gold} gold`);
  }
  const reached = [0, 1, 2].map(a => 0);
  console.log(`${pm.name}: victory ${fmtPct(wins, runs)} · avg fights ${(fights / runs).toFixed(1)} · heroes lost ${(deaths / runs).toFixed(2)} · end level ${(lv / runs).toFixed(1)} · gear worn ${(stash / runs).toFixed(1)} · gold left ${(gold / runs).toFixed(0)}`);
  console.log('   defeats at: ' + (Object.entries(diedAt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'));
});
