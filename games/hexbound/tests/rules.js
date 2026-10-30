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

test('movement powers like Tumble can be taken back, power and action included', () => {
  const { B, rog } = arena('bandits', { rog: u => u.cls === 'rogue' });
  rog.pos = off(4, 10); B.active = rog;
  const tumble = rog.powers.find(p => p.id === 'r_tumble'); assert(tumble, 'Pip knows Tumble');
  const start = rog.pos;
  // drive the shift choice ourselves: three hexes along a row
  const gen = E.usePower(B, rog, tumble, {}); let r = gen.next();
  while (!r.done) r = gen.next(r.value && r.value.choice ? r.value.hexes.find(h => Hex.dist(h, start) === 3) : undefined);
  assert.strictEqual(Hex.dist(rog.pos, start), 3);
  assert(rog.used.r_tumble && rog.act.move === 0);
  assert(E.canUndoMove(rog));
  E.runAuto(E.undoMove(B, rog));
  assert(Hex.eq(rog.pos, start) && !rog.used.r_tumble && rog.act.move === 1 && !rog.moving);
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
  assert(B.log.some(l => l.msg.includes(`: ${hero.powers.find(p => p.basicMelee).name} —`)));
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
  assert.strictEqual(rb(rogue).name, 'Dagger (thrown)');
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

// d20s land on `face` (and every other die on the same fraction of its range) until the next arena()
const fixDice = (face) => E.setRng(() => (face - 0.5) / 20);

test('a natural 1 on a death save counts as two failures', () => {
  // a second hero stays up so the fight isn't over
  const { B, hero, gob } = arena('goblins', { hero: u => u.cls === 'fighter', other: u => u.cls === 'cleric', gob: u => u.id === 'goblin_skulker' });
  E.runAuto(E.dealDamage(B, gob, hero, hero.hp + 1));
  assert(E.isDying(hero));
  fixDice(1);
  E.runAuto(E.startTurn(B, hero, { u: hero }));
  assert.strictEqual(hero.deathFails, 2, B.log.slice(-4).map(l => l.msg).join(' / '));
  fixDice(5);
  E.runAuto(E.startTurn(B, hero, { u: hero }));
  assert(hero.dead, 'an ordinary failure on top makes three');
});

test('heroes take opportunity attacks on enemies that walk out of their reach', () => {
  const { B, hero, gob } = arena('goblins', { hero: u => u.side === 'hero' && u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  gob.pos = off(3, 9); hero.pos = Hex.neighbor(gob.pos, 0);
  B.active = gob;
  E.runAuto(E.doMove(B, gob, Hex.add(gob.pos, { q: -3, r: 0 })));
  assert(B.log.some(l => l.msg === `${hero.name} takes an opportunity attack on ${gob.name}!`));
});

test('a killing blow still triggers the power\'s follow-up effects', () => {
  // Cleaving Strike: the second enemy is still cleaved when the first one drops
  {
    const { B, hero, g1, g2 } = arena('goblins', { hero: u => u.cls === 'fighter', g1: u => u.id === 'goblin_skulker', g2: u => u.id === 'goblin_cutter' });
    hero.pos = off(4, 10); g1.pos = Hex.neighbor(hero.pos, 0); g2.pos = Hex.neighbor(hero.pos, 3);
    g1.hp = 1; const hp2 = g2.hp; B.active = hero;
    fixDice(15);
    E.runAuto(E.usePower(B, hero, hero.powers.find(p => p.id === 'f_cleave'), { unit: g1 }));
    assert(g1.dead); assert(g2.hp < hp2 || g2.dead, 'cleave hits the other adjacent enemy');
  }
  // Lance of Dawn: the wounded ally still gets temp HP
  {
    const { B, cleric, ally, gob } = arena('goblins', { cleric: u => u.cls === 'cleric', ally: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
    cleric.pos = off(4, 10); ally.pos = Hex.add(cleric.pos, { q: 2, r: 0 }); gob.pos = Hex.add(cleric.pos, { q: -3, r: 0 });
    ally.hp = Math.floor(ally.maxHp / 2); gob.hp = 1; B.active = cleric;
    fixDice(15);
    E.runAuto(E.usePower(B, cleric, cleric.powers.find(p => p.id === 'c_lance'), { unit: gob }));
    assert(gob.dead); assert(ally.tempHp > 0, 'ally gains temp HP');
  }
});

test('First Strike: rogues have advantage only against foes that haven\'t had a turn', () => {
  const { B, rogue, gob } = arena('goblins', { rogue: u => u.cls === 'rogue', gob: u => u.id === 'goblin_cutter' });
  gob.actedThisFight = false;
  rogue.pos = off(4, 10); gob.pos = Hex.add(rogue.pos, { q: 4, r: 0 });
  const thrown = rogue.powers.find(p => p.basicRanged);
  assert.strictEqual(E.caReason(B, rogue, gob, { ranged: true, adjacentCheck: false }), 'First Strike');
  E.runAuto(E.startTurn(B, gob, { u: gob }));
  assert.strictEqual(E.caReason(B, rogue, gob, { ranged: true, adjacentCheck: false }), null);
  rogue.act = { std: 1, move: 1, minor: 1 }; B.active = rogue;
  E.runAuto(E.usePower(B, rogue, thrown, { unit: gob }));
  assert(!B.log.some(l => /\(advantage/.test(l.msg)));
});

test('basic attacks are named for the weapon', () => {
  const mk = (cls, sub) => G.Build.makeHero(G.Build.defaultBuild(cls, sub, 'human', 'T', { STR: 16, CON: 12, DEX: 14, INT: 10, WIS: 12, CHA: 10 }, {}), 1);
  const names = (u) => [u.powers.find(p => p.basicMelee).name, u.powers.find(p => p.basicRanged).name];
  assert.deepStrictEqual(names(mk('rogue', 'shadow')), ['Dagger', 'Dagger (thrown)']);
  assert.deepStrictEqual(names(mk('ranger', 'archer')), ['Longbow (melee)', 'Longbow']);
  assert.deepStrictEqual(names(mk('fighter', 'shield')), ['Longsword', 'Thrown Stone']);
});

test('enemy turns pause briefly between actions; the pause is not a choice', () => {
  const { B, gob } = arena('goblins', { hero: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  B.active = gob;
  const gen = G.AI.takeTurn(B, gob); let r = gen.next(), beats = 0, acts = 0;
  while (!r.done) { if (r.value && r.value.beat) beats++; r = gen.next(r.value && r.value.auto ? r.value.auto() : undefined); }
  acts = B.log.filter(l => /uses |moves|shifts/.test(l.msg)).length;
  assert(beats >= 1, 'a goblin that walks up and stabs gets a beat between the two');
});

console.log(`${n} rules checks passed`);
