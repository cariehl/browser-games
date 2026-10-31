// Rules regression checks. Usage: node tests/rules.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js', 'js/campaign.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine, Hex = G.Hex;
const off = (c, r) => Hex.fromOffset(c, r);

// a battle with only the units we name left on the map
function arena(scenId, keep, seed = 7, party = 0, opts = {}) {
  const scen = G.Scenarios.find(s => s.id === scenId);
  const B = E.newBattle(Object.assign({}, scen, { events: [] }), G.Build.PREMADES[party].heroes, Object.assign({ seed, quiet: true }, opts));
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

test('reinforcements never act in the round they arrive', () => {
  const { B } = arena('goblins', { hero: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  B.round = 1; B.turnIdx = 0; B.active = B.order[0].u;
  const spawned = [];
  for (let i = 0; i < 4; i++) spawned.push(E.spawnMonster(B, 'goblin_cutter', off(8, 3 + i)));
  const acted = new Set();
  // play out the rest of round 1: none of the newcomers gets a turn
  while (B.round === 1 && !B.over) { const u = E.runAuto(E.nextTurn(B)); if (!u || B.round > 1) break; acted.add(u); E.runAuto(E.endTurn(B, u)); }
  assert(spawned.every(m => !acted.has(m)), 'no reinforcement acts in round 1');
  // ...and in round 2 they take their turns like anyone else
  const seen = new Set();
  for (let k = 0; k < 20 && B.round === 2 && !B.over; k++) { const u = B.active; if (u) seen.add(u); E.runAuto(E.endTurn(B, u)); E.runAuto(E.nextTurn(B)); }
  assert(spawned.some(m => seen.has(m)), 'reinforcements act from round 2');
});

test('Inspiring Word grants temp HP (no surge) three times and lifts the dying', () => {
  const { B, wl, ally } = arena('goblins', { wl: u => u.cls === 'warlord', ally: u => u.cls === 'fighter' }, 7, 1);
  wl.pos = off(4, 10); ally.pos = Hex.add(wl.pos, { q: 2, r: 0 }); B.active = wl;
  const word = wl.powers.find(p => p.id === 'w_word');
  assert.strictEqual(word.uses, 3);
  ally.hp = 5; const surges = ally.surges;
  E.runAuto(E.usePower(B, wl, word, { unit: ally }));
  assert.strictEqual(ally.hp, 5, 'no real healing'); assert(ally.tempHp > 0, 'temp HP'); assert.strictEqual(ally.surges, surges, 'no surge spent');
  ally.hp = -3; ally.tempHp = 0; E.addCond(B, ally, 'dying', { dur: 'enc' });
  wl.act = { std: 1, move: 1, minor: 1 };
  E.runAuto(E.usePower(B, wl, word, { unit: ally }));
  assert(!E.isDying(ally), 'back on their feet'); assert.strictEqual(ally.hp, 1); assert(ally.tempHp > 0);
});

test('a leftover minor action only counts when something can spend it', () => {
  // level 3, so the heroes have their utility powers
  const { B, wiz } = arena('bandits', { wiz: u => u.cls === 'wizard' });
  const { B: B2, ftr } = arena('bandits', { ftr: u => u.cls === 'fighter' });
  ftr.act = { std: 0, move: 0, minor: 1 };
  assert(E.hasMinorUse(B2, ftr), 'a dwarf can still Second Wind as a minor');
  ftr.used.__sw = true;
  assert(!E.hasMinorUse(B2, ftr), 'Taunting Shout with nobody in the burst is no use');
  wiz.act = { std: 0, move: 0, minor: 1 };
  assert(E.hasMinorUse(B, wiz), 'Arcane Ward is a minor');
  wiz.used.z_ward = true; wiz.powers = wiz.powers.filter(p => p.id !== 'z_ward');
  assert(!E.hasMinorUse(B, wiz));
});

// ---------- items ----------
const itemsOf = (u) => u.powers.filter(p => p.kind === 'item');
const packed = (scen, seed) => E.newBattle(Object.assign({}, G.Scenarios.find(s => s.id === scen), { events: [] }), G.Build.PREMADES[0].heroes, { seed, quiet: true })
  .units.filter(u => u.side === 'hero').map(u => u.pack.join());

test('every hero starts with exactly one item from the item table', () => {
  for (const scen of ['goblins', 'bandits', 'golem']) {
    const { B } = arena(scen, {});
    for (const u of B.units.filter(x => x.side === 'hero')) {
      assert.strictEqual(u.pack.length, 1); assert(G.Items[u.pack[0]]);
      assert.strictEqual(itemsOf(u).length, 1); assert.strictEqual(itemsOf(u)[0].item, u.pack[0]);
    }
    assert(!B.units.some(x => x.monster && itemsOf(x).length), 'monsters carry nothing');
  }
});

test('seeded item rolls are reproducible, and vary between seeds', () => {
  assert.deepStrictEqual(packed('goblins', 42), packed('goblins', 42));
  const seen = new Set(); for (let s = 1; s <= 20; s++) packed('goblins', s).forEach(i => seen.add(i));
  assert(seen.size >= 5, 'a spread of items across seeds');
});

test('a healing draught spends a surge for 10 HP and is used up', () => {
  const { B, ftr } = arena('goblins', { ftr: u => u.cls === 'fighter' }, 7, 0, { items: ['redroot'] });
  B.active = ftr; ftr.hp = 5; const surges = ftr.surges;
  const pot = itemsOf(ftr)[0];
  assert.strictEqual(pot.action, 'minor'); assert(E.canUse(B, ftr, pot));
  E.runAuto(E.usePower(B, ftr, pot, {}));
  assert.strictEqual(ftr.hp, 15); assert.strictEqual(ftr.surges, surges - 1);
  assert.strictEqual(ftr.act.minor, 0); assert.strictEqual(ftr.act.std, 1, 'only the minor action is spent');
  ftr.act = { std: 1, move: 1, minor: 1 };
  assert(!E.canUse(B, ftr, pot), 'one use only');
});

test('a throwable rolls its fixed bonus + level, with no ability mod or weapon bonus', () => {
  const { B, wiz, gob } = arena('bandits', { wiz: u => u.cls === 'wizard', gob: u => u.side === 'enemy' && !u.minion }, 7, 0, { items: [null, null, null, 'fireflask'] });
  const flask = itemsOf(wiz)[0];
  assert.strictEqual(flask.item, 'fireflask');
  const ab = E.attackBonus(B, wiz, flask, gob, {});
  assert.strictEqual(ab.total, 3 + wiz.level); assert.deepStrictEqual(ab.parts, [['item', 3 + wiz.level]]);
  const spec = E.damageSpec(B, wiz, flask, gob);
  assert.strictEqual(spec.flat, 0); assert.deepStrictEqual(spec.dice, [[1, 6]]);
  assert.strictEqual(G.Build.describe(flask, wiz).find(l => /^Attack/.test(l)), `Attack: +${3 + wiz.level} vs Ref`);
  // throw it into a cluster: one use, and it's gone
  wiz.pos = off(4, 10); gob.pos = Hex.add(wiz.pos, { q: 4, r: 0 }); B.active = wiz;
  E.runAuto(E.usePower(B, wiz, flask, { hex: gob.pos }));
  assert.strictEqual(wiz.uses[flask.id], 1); assert(!E.powerReady(B, wiz, flask));
  assert(B.log.some(l => /Emberflask/.test(l.msg) && /vs Ref/.test(l.msg)));
});

test('a field dressing brings a dying ally back, even with no surges left', () => {
  const { B, clr, ftr } = arena('goblins', { clr: u => u.cls === 'cleric', ftr: u => u.cls === 'fighter' }, 7, 0, { items: [null, null, 'dressing'] });
  clr.pos = off(4, 10); ftr.pos = Hex.neighbor(clr.pos, 0); B.active = clr;
  const kit = itemsOf(clr)[0];
  ftr.hp = -4; E.addCond(B, ftr, 'dying', { dur: 'enc' }); ftr.surges = 0;
  assert(E.validTarget(B, clr, kit, ftr));
  const plan = G.AI.planStandard(B, clr, { noMove: true });
  assert.strictEqual(plan.power, kit, 'the AI reaches for the dressing to save a dying ally');
  E.runAuto(E.usePower(B, clr, kit, { unit: ftr }));
  assert(!E.isDying(ftr)); assert.strictEqual(ftr.hp, 1);
  assert(!E.powerReady(B, clr, kit));
  // with surges, it heals the surge value
  const { B: B2, clr: c2, ftr: f2 } = arena('goblins', { clr: u => u.cls === 'cleric', ftr: u => u.cls === 'fighter' }, 7, 0, { items: [null, null, 'dressing'] });
  c2.pos = off(4, 10); f2.pos = Hex.neighbor(c2.pos, 0); B2.active = c2; f2.hp = 2;
  E.runAuto(E.usePower(B2, c2, itemsOf(c2)[0], { unit: f2 }));
  assert.strictEqual(f2.hp, 2 + f2.surgeValue + c2.healBonus, "surge value, plus the Healer feat");
});

test('items stay out of move-undo and the minor-action auto-end check', () => {
  const { B, ftr } = arena('goblins', { ftr: u => u.cls === 'fighter' }, 7, 0, { items: ['quickstep'] });
  B.active = ftr; ftr.act = { std: 0, move: 0, minor: 1 }; ftr.used.__sw = true;
  assert(!E.hasMinorUse(B, ftr), 'an unused potion does not hold the turn open');
  E.runAuto(E.usePower(B, ftr, itemsOf(ftr)[0], {}));
  assert(!E.canUndoMove(ftr));
  assert.strictEqual(E.speedOf(ftr), ftr.speed + 2);
});

// ---------------- Lantern Barrow ----------------
test('soul lanterns raise Rattlebones on the Widow\'s turn, and breaking one blasts nearby undead', () => {
  const { B, wid, lan, lan2, ward } = arena('barrow', { wid: u => u.id === 'lantern_widow', lan: u => u.id === 'soul_lantern' && Hex.eq(u.pos, off(3, 3)), lan2: u => u.id === 'soul_lantern' && Hex.eq(u.pos, off(13, 3)), ward: u => u.id === 'barrow_warden' });
  const before = B.units.filter(u => !u.dead && u.id === 'rattlebone').length;
  E.runAuto(E.traitRun(B, wid, 'onTurnStart'));
  const raised = B.units.filter(u => !u.dead && u.id === 'rattlebone');
  assert.strictEqual(raised.length - before, B.units.filter(u => !u.dead && u.id === 'soul_lantern').length, 'one per standing lantern');
  for (const r of raised) assert(B.units.some(l => l.id === 'soul_lantern' && !l.dead && E.udist(l, r) === 1), 'each rises beside a lantern');
  ward.pos = Hex.within(lan.pos, 2).find(h => Hex.dist(h, lan.pos) === 2 && E.passable(B, h) && !E.unitAt(B, h));
  const hp = ward.hp;
  E.runAuto(E.dealDamage(B, null, lan, 5, {}));
  assert(lan.dead);
  assert.strictEqual(ward.hp, hp - 6, 'freed souls deal 6 radiant to undead within 2');
  assert(raised.filter(r => E.udist(r, lan) <= 2).every(r => r.dead), 'rattlebones by the lantern are destroyed');
});

test('when the Widow falls, her Rattlebones fall with her', () => {
  const { B, wid } = arena('barrow', { wid: u => u.id === 'lantern_widow', a: u => u.id === 'rattlebone', w: u => u.id === 'barrow_warden', f: u => u.cls === 'fighter' });
  E.runAuto(E.kill(B, null, wid));
  assert(B.units.filter(u => u.id === 'rattlebone').every(u => u.dead));
  assert(!B.over, 'the warden still stands');
});

// ---------------- Campaign ----------------
const C = G.Campaign;
const fakeRun = () => C.newRun({ name: 'Test', heroes: G.Build.PREMADES[0].heroes }, 'normal', { rand: () => 0 });

test('carried wounds, spent surges and used dailies come into the next battle', () => {
  const run = fakeRun();
  const h = run.heroes[0]; h.damage = 10; h.surgesSpent = 3;
  const daily = G.Build.makeHero(h.build, 1).powers.find(p => p.kind === 'daily');
  h.daily = [daily.id];
  const s = C.battleSetup(run, 'n1');
  const B = E.newBattle(Object.assign({}, s.scen, { events: [] }), s.party.heroes, Object.assign({ seed: 3, quiet: true }, s.opts));
  const u = B.units.find(x => x.side === 'hero');
  assert.strictEqual(u.hp, u.maxHp - 10);
  assert.strictEqual(u.surges, G.Build.makeHero(h.build, 1).surges - 3);
  assert(!E.powerReady(B, u, u.powers.find(p => p.id === daily.id)), 'the spent daily stays spent');
  assert.deepStrictEqual(u.pack, h.pack, 'the run pack is the battle pack');
});

test('a won battle folds HP, surges, dailies, items and deaths back into the run, then makes camp', () => {
  const run = fakeRun();
  const s = C.battleSetup(run, 'n1');
  const B = E.newBattle(Object.assign({}, s.scen, { events: [] }), s.party.heroes, Object.assign({ seed: 3, quiet: true }, s.opts, { items: [['redroot'], [], [], []] }));
  run.heroes[0].pack = ['redroot']; run.heroes[1].pack = []; run.heroes[2].pack = []; run.heroes[3].pack = [];
  const hs = B.units.filter(x => x.side === 'hero');
  hs[0].hp -= 7; hs[0].surges -= 1; hs[0].uses[hs[0].powers.find(p => p.kind === 'item').id] = 1;
  const d = hs[0].powers.find(p => p.kind === 'daily'); hs[0].used[d.id] = true;
  hs[1].dead = true;
  B.over = 'win'; B.round = 4;
  const r = C.recordBattle(run, 'n1', B);
  assert(r.won && !r.over);
  assert.deepStrictEqual(r.fallen, [run.heroes[1].build.name]);
  assert.strictEqual(run.heroes[0].damage, 7); assert.strictEqual(run.heroes[0].surgesSpent, 1);
  assert.deepStrictEqual(run.heroes[0].daily, [d.id]);
  assert(run.heroes[1].dead && run.heroes[1].fellAt === 'Thornwood Crossing');
  assert.strictEqual(run.stage, 'camp'); assert.strictEqual(run.level, 2);
  assert.strictEqual(run.camp.found.length, C.LOOT_PER_WIN, 'spoils');
  assert(run.camp.found.every(f => f.hero !== 1), 'the dead get no loot');
  // level 2 keeps the wound but raises max HP
  const st = C.status(run, run.heroes[0]);
  assert.strictEqual(st.hp, st.maxHp - 7);
  assert.strictEqual(st.maxHp, G.Build.makeHero(run.heroes[0].build, 2).maxHp);
  // the next fight leaves the dead behind
  C.breakCamp(run);
  assert.deepStrictEqual(C.available(run), ['n2']);
  assert.strictEqual(C.battleSetup(run, 'n2').party.heroes.length, 3);
});

test('level up offers the newly unlocked power and feat slots', () => {
  const run = fakeRun();
  run.path = ['n1']; C.makeCamp(run, () => 0);
  const ch = C.levelChoices(run, 0);
  assert(ch.some(c => c.kind === 'power' && c.slot === 'util2'), 'level 2 utility');
  const feat = ch.find(c => c.kind === 'feat');
  assert(feat, 'level 2 feat');
  const other = feat.options.find(id => id !== feat.pick);
  C.choose(run, 0, feat, other);
  assert.strictEqual(run.heroes[0].build.feats[feat.index], other);
  const pw = ch.find(c => c.kind === 'power'); const alt = pw.options.find(id => id !== pw.pick);
  C.choose(run, 0, pw, alt);
  assert(G.Build.makeHero(run.heroes[0].build, 2).powers.some(p => p.id === alt));
});

test('short rest: surges heal their value, and a hero left at 0 HP wakes at 1', () => {
  const run = fakeRun();
  const h = run.heroes[2]; const st = C.status(run, h);
  h.damage = st.maxHp;
  assert(C.spendSurge(run, 2));
  assert.strictEqual(C.status(run, h).hp, st.surgeValue);
  assert.strictEqual(C.status(run, h).surges, st.surges - 1);
  h.damage = 0; assert(!C.spendSurge(run, 2), 'no surges spent at full HP');
  h.damage = st.maxHp; h.surgesSpent = st.maxSurges; assert(!C.spendSurge(run, 2));
  C.breakCamp(run);
  assert.strictEqual(C.status(run, h).hp, 1);
});

test('a lost battle or the last victory ends the run and writes the record', () => {
  const store = {}; global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const run = fakeRun();
  run.path = ['n1', 'n2'];
  const s = C.battleSetup(run, 'n3');
  const B = E.newBattle(Object.assign({}, s.scen, { events: [] }), s.party.heroes, Object.assign({ seed: 3, quiet: true }, s.opts));
  B.over = 'win'; B.round = 6;
  const r = C.recordBattle(run, 'n3', B);
  assert(r.over); assert.strictEqual(run.outcome, 'victory');
  const rec = C.records()[0];
  assert.strictEqual(rec.outcome, 'victory'); assert.strictEqual(rec.won, 1); assert.strictEqual(rec.total, 3);
  const run2 = fakeRun();
  const s2 = C.battleSetup(run2, 'n1');
  const B2 = E.newBattle(Object.assign({}, s2.scen, { events: [] }), s2.party.heroes, Object.assign({ seed: 3, quiet: true }, s2.opts));
  B2.over = 'lose'; B2.units.filter(u => u.side === 'hero').forEach(u => { u.dead = true; });
  C.recordBattle(run2, 'n1', B2);
  assert.strictEqual(C.records()[0].outcome, 'defeat');
  assert.strictEqual(C.records()[0].reached, 'Thornwood Crossing');
  assert(C.records()[0].heroes.every(h => h.fell));
  delete global.localStorage;
});

console.log(`${n} rules checks passed`);
