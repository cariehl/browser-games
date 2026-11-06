// Ability fuzzer: fires every hero power (and item) in thousands of random situations — crowded maps,
// walls and water, hazards, the Large golem, breakable objects, dying allies, conditions on the user — and
// checks the battle stays sane afterwards. Usage: node tests/fuzz.js [rounds-per-power=40] [seed=1]
const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/data/gear.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine, Hex = G.Hex, Bd = G.Build;
const N = +(process.argv[2] || 40);
let seed = +(process.argv[3] || 1);
const rng = E.makeRng(seed * 7919);
const pick = (a) => a[Math.floor(rng() * a.length)];

// two builds per class/subclass so every power in every slot is known by someone
function builds() {
  const out = [];
  const base = { STR: 16, CON: 14, DEX: 16, INT: 14, WIS: 14, CHA: 12 };
  for (const cls in Bd.CLASSES) for (const sub in Bd.CLASSES[cls].subs) for (const k of [0, 1]) {
    const powers = {};
    for (const slot of ['atwill', 'enc1', 'enc3', 'daily1', 'daily5', 'util2']) {
      const ids = Bd.powersOf(cls, slot).map(p => p.id);
      powers[slot] = slot === 'atwill' ? ids.slice(k * 2, k * 2 + 2) : ids[k % ids.length];
    }
    const anc = Object.keys(Bd.ANCESTRIES)[(out.length) % 6];
    const feats = Object.keys(Bd.FEATS).filter(f => !Bd.FEATS[f].cls || Bd.FEATS[f].cls.includes(cls));
    out.push({ name: `${cls}-${sub}-${k}`, cls, sub, ancestry: anc, base, bump4: ['STR', 'DEX'], feats: [pick(feats), pick(feats), pick(feats)], powers });
  }
  return out;
}

const problems = new Map();
function fail(key, msg) { if (!problems.has(key)) problems.set(key, { msg, n: 0 }); problems.get(key).n++; }

function invariants(B, where) {
  const occ = new Map();
  for (const u of B.units) {
    if (u.dead) continue;
    for (const k of ['hp', 'tempHp', 'surges']) if (u[k] != null && !Number.isFinite(u[k])) fail(where + ' NaN ' + k, `${u.name}.${k} = ${u[k]}`);
    if (!u.pos) { fail(where + ' nopos', u.name + ' has no position'); continue; }
    if (u.hp > u.maxHp) fail(where + ' overheal', `${u.name} hp ${u.hp} > max ${u.maxHp}`);
    for (const h of E.footprint(u)) {
      const t = E.terr(B, h);
      if (!t || t.block) fail(where + ' inwall', `${u.name} stands in ${t ? t.name : 'the void'}`);
      const k = Hex.hk(h);
      if (occ.has(k)) fail(where + ' overlap', `${u.name} shares a hex with ${occ.get(k)}`);
      occ.set(k, u.name);
    }
    for (const c of u.conds) if (c.amt != null && !Number.isFinite(c.amt)) fail(where + ' condNaN', `${u.name} ${c.c} amt ${c.amt}`);
    if (u.side === 'hero' && u.hp > 0 && E.isDying(u)) fail(where + ' dyingAlive', `${u.name} is dying at ${u.hp} HP`);
  }
}

// drive a generator answering choices at random (sometimes declining optional ones)
function drive(gen) {
  let r = gen.next(), guard = 0;
  while (!r.done) {
    if (++guard > 500) throw new Error('generator never finishes');
    const c = r.value; let ans;
    if (c && c.choice === 'hex') ans = c.optional && rng() < 0.15 ? null : (rng() < 0.5 && c.auto ? c.auto() : pick(c.hexes));
    else if (c && c.choice === 'reroll') ans = rng() < 0.5 ? c.options[0] : null;
    else if (c && c.auto) ans = c.auto();
    r = gen.next(ans);
  }
  return r.value;
}

const scens = G.Scenarios;
const party = builds();
let fired = 0;
const usedIds = new Set();
for (let i = 0; i < party.length; i += 4) {
  const four = party.slice(i, i + 4);
  while (four.length < 4) four.push(party[four.length]);
  for (let round = 0; round < N; round++) {
    const scen = pick(scens);
    const B = E.newBattle(Object.assign({}, scen, { events: [] }), four, { seed: seed++, quiet: true, level: 5 });
    E.runAuto(E.startBattle(B));
    // scatter everyone into a small patch so powers have neighbours, walls and hazards nearby
    const free = [...B.tiles.values()].map(t => ({ q: t.q, r: t.r })).filter(h => !E.terr(B, h).block);
    const center = pick(free);
    const near = free.filter(h => Hex.dist(h, center) <= 4).sort(() => rng() - 0.5);
    for (const u of B.units) {
      if (u.dead || E.footprint(u).length > 1) continue;
      const spot = near.find(h => !E.unitAt(B, h));
      if (spot && rng() < 0.85) u.pos = spot;
    }
    // random states
    for (const u of B.units.filter(u => u.side === 'hero')) {
      if (rng() < 0.15) { u.hp = 0; E.addCond(B, u, 'dying', { dur: 'enc' }); E.addCond(B, u, 'prone', { dur: 'enc' }); }
      else if (rng() < 0.3) u.hp = 1 + Math.floor(rng() * u.maxHp / 2);
      if (rng() < 0.15) u.surges = 0;
      if (rng() < 0.2) E.addCond(B, u, pick(['slowed', 'immobilized', 'prone', 'weakened', 'marked']), { dur: 'save', src: -1 });
    }
    for (const m of B.units.filter(u => u.side === 'enemy' && !u.minion)) if (rng() < 0.4) m.hp = 1 + Math.floor(rng() * 6);
    invariants(B, 'setup');
    for (const hero of B.units.filter(u => u.side === 'hero')) {
      for (const p of hero.powers) {
        if (!E.canAct(hero)) continue;
        hero.used = {}; hero.uses = {}; hero.act = { std: 1, move: 1, minor: 1 }; hero.turnFlags = {};
        // usually step up next to a random foe first, so melee powers find someone
        const foes = E.enemiesOf(B, hero);
        if (rng() < 0.7 && foes.length && !E.hasCond(hero, 'immobilized')) {
          const f = pick(foes); const spots = free.filter(h => E.udist(f, hero, null, h) === 1 && !E.unitAt(B, h));
          if (spots.length) hero.pos = pick(spots);
        }
        B.active = hero; B.turnNo = (B.turnNo || 0) + 1;
        let aim = null;
        try { const a = G.AI.bestAim(B, hero, p); aim = a && a.aim; } catch (e) { fail(p.id + ' aim', e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
        if (!aim) {
          // try something legal at random: a unit in range, or a hex for areas
          if (E.isArea(p)) aim = { hex: pick(near) };
          else if (p.tgt === 'self') aim = {};
          else { const ts = B.units.filter(t => !t.dead && E.validTarget(B, hero, p, t)); if (!ts.length) continue; aim = { unit: pick(ts) }; }
        }
        const before = JSON.stringify(B.units.map(u => [u.uid, u.dead]));
        try { drive(E.usePower(B, hero, p, aim)); fired++; usedIds.add(p.id); }
        catch (e) { fail(p.id + ' throw ' + e.message, `${p.id} (${p.name}) by ${hero.name} in ${scen.id}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`); }
        invariants(B, p.id);
        B.over = null;
      }
    }
    // then let the AI play a couple of rounds from this mess
    try {
      for (let t = 0; t < 12 && !B.over; t++) { const u = drive(E.nextTurn(B)); if (!u) break; drive(G.AI.takeTurn(B, u)); drive(E.endTurn(B, u)); invariants(B, 'ai-turn'); }
    } catch (e) { fail('ai ' + e.message, e.stack.split('\n').slice(0, 4).join(' | ')); }
  }
}
const all = Object.values(Bd.POWERS).filter(p => p.cls).map(p => p.id);
const never = all.filter(id => !usedIds.has(id));
console.log(`fired ${fired} powers; ${usedIds.size} distinct`);
if (never.length) console.log('never fired:', never.join(', '));
for (const [k, v] of problems) console.log(`PROBLEM x${v.n} [${k}]: ${v.msg}`);
process.exitCode = problems.size ? 1 : 0;
