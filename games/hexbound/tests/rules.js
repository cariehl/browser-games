// Rules regression checks. Usage: node tests/rules.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
global.G = {};
for (const f of ['js/hex.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine, Hex = G.Hex;
const off = (c, r) => Hex.fromOffset(c, r);

// a battle with only the units we name left on the map
function arena(scenId, keep, seed = 7) {
  const scen = G.Scenarios.find(s => s.id === scenId);
  const B = E.newBattle(Object.assign({}, scen, { events: [] }), G.Build.PREMADES[0].heroes, { seed, quiet: true });
  E.runAuto(E.startBattle(B));
  const named = {};
  for (const [k, pick] of Object.entries(keep)) named[k] = B.units.find(pick);
  for (const u of B.units) if (!Object.values(named).includes(u)) u.dead = true;
  for (const u of Object.values(named)) { u.act = { std: 1, move: 1, minor: 1 }; u.turnFlags = {}; }
  return Object.assign({ B }, named);
}
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('line of sight past a corner is the same on both sides', () => {
  const { B } = arena('goblins', {});
  let asym = 0;
  for (const t of B.tiles.values()) {
    const o = { q: t.q, r: t.r }; if (E.terr(B, o).block) continue;
    for (let d = 0; d < 6; d++) {
      const tr = Hex.neighbor(o, d); if (!E.terr(B, tr) || !E.terr(B, tr).los) continue;
      const a = Hex.neighbor(tr, (d + 1) % 6), b = Hex.neighbor(tr, (d + 5) % 6);
      const sideA = Hex.neighbor(o, (d + 1) % 6), sideB = Hex.neighbor(o, (d + 5) % 6);
      // only compare when the far side of each diagonal is open
      const open = (h) => E.tile(B, h) && !E.terr(B, h).los;
      if (!E.tile(B, a) || !E.tile(B, b) || !open(sideA) || !open(sideB)) continue;
      if (E.los(B, o, a) !== E.los(B, o, b)) asym++;
    }
  }
  assert.strictEqual(asym, 0);
});

test('moving around an enemy inside its reach does not provoke; leaving it does', () => {
  const { B, hero, gob } = arena('goblins', { hero: u => u.side === 'hero', gob: u => u.id === 'goblin_skulker' });
  gob.pos = off(3, 9); hero.pos = Hex.neighbor(gob.pos, 0);
  const r = E.reach(B, hero, 6, 'move');
  const around = r.get(Hex.hk(Hex.neighbor(gob.pos, 1)));
  assert.strictEqual(around.prov, 0, 'circling to another adjacent hex is free');
  const away = r.get(Hex.hk(Hex.add(gob.pos, { q: 3, r: 0 })));
  assert.strictEqual(away.prov, 1, 'walking away provokes once');
  B.active = hero;
  E.runAuto(E.doMove(B, hero, Hex.neighbor(gob.pos, 2)));
  assert(!B.log.some(l => /opportunity attack/.test(l.msg)));
});

test('planned moves continue with leftover speed and can be undone', () => {
  const { B, hero } = arena('goblins', { hero: u => u.side === 'hero' });
  hero.pos = off(4, 10); B.active = hero;
  const start = hero.pos, speed = E.speedOf(hero);
  E.runAuto(E.doMove(B, hero, Hex.add(start, { q: 2, r: 0 }), 'move', { plan: true }));
  assert.strictEqual(E.moveLeft(hero, 'move'), speed - 2);
  assert.strictEqual(hero.act.move, 0);
  E.runAuto(E.doMove(B, hero, Hex.add(start, { q: 3, r: 0 }), 'move', { plan: true }));
  assert.strictEqual(E.moveLeft(hero, 'move'), speed - 3);
  assert.strictEqual(hero.act.std, 1, 'continuing a plan costs no extra action');
  E.runAuto(E.undoMove(B, hero)); E.runAuto(E.undoMove(B, hero));
  assert(Hex.eq(hero.pos, start)); assert.strictEqual(hero.act.move, 1); assert.strictEqual(hero.moving, null);
});

test('a step that provokes is locked in', () => {
  const { B, hero, gob } = arena('goblins', { hero: u => u.side === 'hero', gob: u => u.id === 'goblin_skulker' });
  gob.pos = off(3, 9); hero.pos = Hex.neighbor(gob.pos, 0); B.active = hero;
  E.runAuto(E.doMove(B, hero, Hex.add(gob.pos, { q: 3, r: 0 }), 'move', { plan: true }));
  assert(B.log.some(l => /opportunity attack/.test(l.msg)));
  assert(!E.canUndoMove(hero));
});

test('charge follows a plotted route', () => {
  const { B, hero, gob } = arena('goblins', { hero: u => u.side === 'hero' && u.powers.some(p => p.basicMelee), gob: u => u.id === 'goblin_skulker' });
  hero.pos = off(4, 10); B.active = hero;
  // a straight, open 3-hex lane with the goblin at its end, then a dog-leg route along it
  const d = [0, 1, 2, 3, 4, 5].find(d => { let h = hero.pos; for (let i = 0; i < 4; i++) { h = Hex.neighbor(h, d); const t = E.terr(B, h); if (!t || t.block || t.difficult) return false; } return true; });
  const lane = [hero.pos]; for (let i = 0; i < 3; i++) lane.push(Hex.neighbor(lane[i], d));
  gob.pos = Hex.neighbor(lane[3], d);
  assert(E.chargePath(B, hero, gob, lane), 'route is legal');
  assert(!E.chargePath(B, hero, gob, [hero.pos, lane[2], lane[3]]), 'routes must be contiguous');
  E.runAuto(E.doCharge(B, hero, gob, lane));
  assert(Hex.eq(hero.pos, lane[3]));
  assert(B.log.some(l => /Melee Basic Attack/.test(l.msg)));
});

test('damage while dying is a failed death save, a crit is two', () => {
  const { B, hero, gob } = arena('goblins', { hero: u => u.side === 'hero', gob: u => u.id === 'goblin_skulker' });
  B.active = gob;
  E.runAuto(E.dealDamage(B, gob, hero, hero.hp + 1));
  assert(E.isDying(hero)); assert.strictEqual(hero.deathFails, 0);
  E.runAuto(E.dealDamage(B, gob, hero, 3));
  assert.strictEqual(hero.deathFails, 1);
  E.runAuto(E.dealDamage(B, gob, hero, 3, { crit: true }));
  assert(hero.dead);
});

test('heroes without a ranged weapon throw stones; daggers can be thrown', () => {
  const mk = (cls, sub) => G.Build.makeHero(G.Build.defaultBuild(cls, sub, 'human', 'T', { STR: 16, CON: 12, DEX: 14, INT: 10, WIS: 12, CHA: 10 }, {}), 1);
  const fighter = mk('fighter', 'shield'), archer = mk('ranger', 'archer'), rogue = mk('rogue', 'shadow');
  const rb = (u) => u.powers.find(p => p.basicRanged);
  assert.strictEqual(rb(fighter).name, 'Thrown Stone'); assert.strictEqual(rb(fighter).range, 5);
  assert(/Longbow/.test(rb(archer).name)); assert.strictEqual(E.powerRange(archer, rb(archer)).range, 15);
  assert.strictEqual(rb(rogue).name, 'Thrown Dagger');
  const { B } = arena('goblins', {});
  const stone = E.attackBonus(B, fighter, rb(fighter), { uid: -1, conds: [] }, {});
  assert(!stone.parts.some(([k]) => k === 'prof'), 'no proficiency bonus for a rock');
});

test('the Pastry Golem is Large: 7 hexes, reached from any side', () => {
  const { B, golem, hero } = arena('golem', { golem: u => u.id === 'pastry_golem', hero: u => u.side === 'hero' && u.powers.some(p => p.basicMelee) });
  assert.strictEqual(E.footprint(golem).length, 7);
  for (const h of Hex.neighbors(golem.pos)) assert.strictEqual(E.unitAt(B, h), golem);
  hero.pos = Hex.add(golem.pos, { q: 2, r: 0 });
  assert.strictEqual(E.udist(hero, golem), 1);
  assert(E.validTarget(B, hero, hero.powers.find(p => p.basicMelee), golem));
  assert(E.threatening(B, hero).includes(golem));
  // the golem can't walk into a hex where its body would overlap a hero
  const r = E.reach(B, golem, E.speedOf(golem), 'move');
  for (const v of r.values()) if (!v.noEnd) assert(E.footprint(golem, v.h).every(f => E.passable(B, f) && !(E.unitAt(B, f) && E.unitAt(B, f) !== golem)));
});

console.log(`${n} rules checks passed`);
