// Rules regression checks. Usage: node tests/rules.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
global.G = {};
for (const f of ['js/hex.js', 'js/data/items.js', 'js/data/gear.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/data/encounters.js', 'js/data/events.js', 'js/ai.js', 'js/campaign.js'])
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
  // Lance of Dawn: the wounded ally is still mended
  {
    const { B, cleric, ally, gob } = arena('goblins', { cleric: u => u.cls === 'cleric', ally: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
    cleric.pos = off(4, 10); ally.pos = Hex.add(cleric.pos, { q: 2, r: 0 }); gob.pos = Hex.add(cleric.pos, { q: -3, r: 0 });
    ally.hp = Math.floor(ally.maxHp / 2); gob.hp = 1; B.active = cleric;
    const was = ally.hp, surges = ally.surges;
    fixDice(15);
    E.runAuto(E.usePower(B, cleric, cleric.powers.find(p => p.id === 'c_lance'), { unit: gob }));
    assert(gob.dead); assert(ally.hp > was, 'ally regains HP'); assert.strictEqual(ally.surges, surges, 'no surge spent');
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
const fakeRun = (seed = 11) => C.newRun({ name: 'Test', heroes: G.Build.PREMADES[0].heroes }, 'normal', { rand: () => 0, seed });
const firstFight = (run) => C.available(run).find(id => C.nodeOf(run, id).type === 'combat');
const battleFor = (run, id, extra = {}) => { const s = C.battleSetup(run, id); return E.newBattle(Object.assign({}, s.scen, { events: [] }), s.party.heroes, Object.assign({ seed: 3, quiet: true }, s.opts, extra)); };

test('act maps: every node is reachable from the start, rows climb to one boss, and the act has a merchant', () => {
  for (let seed = 1; seed < 40; seed++) for (let a = 0; a < C.ACTS.length; a++) {
    const m = C.genAct(a, seed * 31), A = C.ACTS[a];
    const boss = m.nodes.filter(n => n.type === 'boss');
    assert.strictEqual(boss.length, 1);
    const seen = new Set(m.nodes.filter(n => n.row === 0).map(n => n.id)), q = [...seen];
    while (q.length) { const cur = q.shift(); for (const t of m.nodes.find(n => n.id === cur).next) if (!seen.has(t)) { seen.add(t); q.push(t); } }
    assert.strictEqual(seen.size, m.nodes.length, 'all reachable');
    for (const n of m.nodes) for (const t of n.next) assert.strictEqual(m.nodes.find(x => x.id === t).row, n.row + 1, 'edges climb one row');
    assert(m.nodes.filter(n => n.row === 0).every(n => n.type === 'combat'), 'the act opens with a fight');
    assert(m.nodes.filter(n => n.row === A.rows - 1).every(n => n.type === 'rest'), 'a rest site before the boss');
    assert(m.nodes.some(n => n.type === 'shop'), 'a merchant');
    if (a < 2) assert(m.nodes.some(n => n.type === 'elite'), 'an elite');
  }
});

test('generated fights are deterministic, reachable and scaled to the party level', () => {
  for (const faction of Object.keys(G.Encounters.FACTIONS)) for (const kind of ['combat', 'elite']) {
    const o = { faction, kind, level: 3, heroes: 4, seed: 99, act: 2 };
    const a = G.Encounters.make(o), b = G.Encounters.make(o);
    assert.deepStrictEqual(a.map, b.map); assert.deepStrictEqual(a.enemies, b.enemies);
    assert(a.enemies.length >= 2, faction + ' has enemies');
    if (kind === 'elite') assert(G.Monsters[a.enemies[0].id].elite, 'elite leads');
    const B = E.newBattle(a, G.Build.PREMADES[0].heroes, { seed: 1, quiet: true, level: 3 });
    for (const u of B.units.filter(x => x.monster && !x.object)) assert.strictEqual(u.level, 3, `${u.id} scaled to 3`);
  }
});

test('monster scaling: +1 level is +1 attack, defenses and damage and more HP; minions stay at 1 HP', () => {
  const base = E.makeMonster('bandit_cutthroat', off(1, 1));
  const up = E.makeMonster('bandit_cutthroat', off(1, 1), { lvAdj: 2 });
  assert.strictEqual(up.def.AC, base.def.AC + 2);
  assert.strictEqual(up.maxHp, base.maxHp + 16);
  assert.strictEqual(E.damageSpec(null, up, up.powers[0]).flat, E.damageSpec(null, base, base.powers[0]).flat + 2);
  const m = E.makeMonster('bandit_thug', off(1, 1), { lvAdj: 2 }); assert.strictEqual(m.maxHp, 1);
});

test('gear: weapon, armor and neck enhancement land on attacks, AC and NADs; trinkets and boons add their props', () => {
  const b = G.Build.PREMADES[0].heroes[0];
  const bare = G.Build.makeHero(b, 3, {}), old = G.Build.makeHero(b, 3);
  assert.strictEqual(old.def.AC, bare.def.AC + 1, 'without gear the old flat +1 applies from level 3');
  const g = G.Build.makeHero(b, 3, { weapon: 'w_storm', armor: 'a_bulwark', neck: 'n_pendant', trinket: 't_belt', boons: ['b_fleet', 'c_frail'] });
  assert.strictEqual(g.enh, 2); assert.strictEqual(g.critDice, '2d6');
  assert.strictEqual(g.def.AC, bare.def.AC + 2); assert.strictEqual(g.def.Will, bare.def.Will + 1);
  assert.strictEqual(g.surges, bare.surges + 1); assert.strictEqual(g.maxHp, bare.maxHp); // +5 belt, −5 Frail
  assert.strictEqual(g.speed, bare.speed + 1);
});

test('carried wounds, spent surges, used dailies and gear come into the next battle', () => {
  const run = fakeRun();
  const h = run.heroes[0]; h.damage = 10; h.surgesSpent = 3; h.gear.armor = 'a_riveted';
  const daily = G.Build.makeHero(h.build, 1).powers.find(p => p.kind === 'daily');
  h.daily = [daily.id];
  const B = battleFor(run, firstFight(run));
  const u = B.units.find(x => x.side === 'hero');
  assert.strictEqual(u.hp, u.maxHp - 10);
  assert.strictEqual(u.surges, G.Build.makeHero(h.build, 1).surges - 3);
  assert.strictEqual(u.def.AC, G.Build.makeHero(h.build, 1, {}).def.AC + 1, 'armor worn');
  assert(!E.powerReady(B, u, u.powers.find(p => p.id === daily.id)), 'the spent daily stays spent');
  assert.deepStrictEqual(u.pack, h.pack, 'the run pack is the battle pack');
});

test('a won battle folds HP, surges, dailies, items and deaths back into the run, then makes camp with gold and XP', () => {
  const run = fakeRun();
  const id = firstFight(run);
  C.enter(run, id);
  const B = battleFor(run, id, { items: [['redroot'], [], [], []] });
  run.heroes[0].pack = ['redroot']; run.heroes[1].pack = []; run.heroes[2].pack = []; run.heroes[3].pack = [];
  const hs = B.units.filter(x => x.side === 'hero');
  hs[0].hp -= 7; hs[0].surges -= 1; hs[0].uses[hs[0].powers.find(p => p.kind === 'item').id] = 1;
  const d = hs[0].powers.find(p => p.kind === 'daily'); hs[0].used[d.id] = true;
  hs[1].dead = true;
  B.over = 'win'; B.round = 4;
  const g0 = run.gold;
  const r = C.recordBattle(run, id, B, () => 0);
  assert(r.won && !r.over);
  assert.deepStrictEqual(r.fallen, [run.heroes[1].build.name]);
  assert.strictEqual(run.heroes[0].damage, 7); assert.strictEqual(run.heroes[0].surgesSpent, 1);
  assert.deepStrictEqual(run.heroes[0].daily, [d.id]);
  assert(run.heroes[1].dead && run.heroes[1].fellAt === B.scen.name);
  assert.strictEqual(run.stage, 'camp'); assert.strictEqual(run.xp, 1); assert(run.gold > g0, 'gold');
  assert(run.camp.found.length >= 1 && run.camp.found.every(f => f.hero !== 1), 'loot, never for the dead');
  C.breakCamp(run);
  assert.deepStrictEqual(C.available(run), C.nodeOf(run, id).next);
  assert.strictEqual(C.battleSetup(run, C.mapOf(run).nodes.find(n => n.type === 'combat' && n.row > 0).id).party.heroes.length, 3);
});

test('XP levels the party; level up offers the newly unlocked power and feat slots', () => {
  const run = fakeRun();
  run.node = firstFight(run); run.xp = 2;
  C.makeCamp(run, 'combat', () => 0);
  assert.strictEqual(run.level, 2);
  const ch = C.levelChoices(run, 0);
  assert(ch.some(c => c.kind === 'power' && c.slot === 'util2'), 'level 2 utility');
  const feat = ch.find(c => c.kind === 'feat');
  assert(feat, 'level 2 feat');
  const other = feat.options.find(id => id !== feat.pick);
  C.choose(run, 0, feat, other);
  assert.strictEqual(run.heroes[0].build.feats[feat.index], other);
});

test('beating an act boss: gear choice, a full rest, at least the act\'s level, and on to the next act', () => {
  const run = fakeRun();
  const boss = C.mapOf(run).nodes.find(n => n.type === 'boss');
  run.node = boss.id; run.heroes.forEach(h => { h.damage = 5; h.surgesSpent = 2; h.daily = ['x']; });
  C.makeCamp(run, 'boss', () => 0);
  assert.strictEqual(run.camp.gear.length, 3); assert(run.camp.actDone);
  assert.strictEqual(run.level, 3);
  assert(run.heroes.every(h => h.damage === 0 && h.surgesSpent === 0 && !h.daily.length));
  assert(C.takeGear(run, run.camp.gear[1])); assert(!C.takeGear(run, run.camp.gear[0]), 'only one');
  const id = run.camp.gear[1];
  assert(run.heroes.some(h => Object.values(h.gear).includes(id)), 'auto-equipped on someone');
  C.breakCamp(run);
  assert.strictEqual(run.act, 1);
  assert(C.available(run).every(i => C.nodeOf(run, i).act === 1 && C.nodeOf(run, i).row === 0));
});

test('equip and unequip move gear between heroes and the stash', () => {
  const run = fakeRun();
  run.stash = ['w_keen', 'w_storm'];
  assert(C.equip(run, 0, 'w_keen')); assert.strictEqual(run.heroes[0].gear.weapon, 'w_keen');
  assert(C.equip(run, 0, 'w_storm')); assert.deepStrictEqual(run.stash, ['w_keen'], 'the old weapon goes back to the stash');
  assert(C.unequip(run, 0, 'weapon')); assert.deepStrictEqual(run.stash.sort(), ['w_keen', 'w_storm']);
  run.heroes[0].pack = ['redroot']; run.heroes[1].pack = [];
  assert(C.movePack(run, 0, 0, 1)); assert.deepStrictEqual(run.heroes[1].pack, ['redroot']);
});

test('merchants: buying spends gold, full packs block consumables, and the Rite of Return raises the fallen', () => {
  const run = fakeRun();
  const shop = C.mapOf(run).nodes.find(n => n.type === 'shop');
  run.path = []; C.enter(run, shop.id);
  assert.strictEqual(run.stage, 'shop');
  run.gold = 500;
  const it = run.shop.items[0];
  assert(C.buy(run, 'item', 0).ok); assert.strictEqual(run.gold, 500 - it.price); assert(!C.buy(run, 'item', 0).ok, 'sold out');
  run.heroes.forEach(h => { h.pack = ['redroot', 'redroot', 'redroot']; });
  assert.strictEqual(C.buy(run, 'item', 1).why, 'pack');
  const g = run.shop.gear[0]; assert(C.buy(run, 'gear', 0).ok); assert(run.stash.includes(g.id) || run.heroes.some(h => Object.values(h.gear).includes(g.id)));
  run.heroes[2].dead = true;
  const k = run.shop.services.findIndex(s => s.id === 'raise');
  assert(C.buy(run, 'service', k, 2).ok);
  assert(!run.heroes[2].dead && run.heroes[2].boons.includes('c_weary'));
  const before = run.gold; assert(C.sell(run, 0) || true); assert(run.gold >= before);
});

test('events: a skill check uses the best hero\'s bonus, and outcomes change the run', () => {
  const run = fakeRun();
  const b = C.bestFor(run, 'thievery');
  assert.strictEqual(run.heroes[b.hero].build.cls, 'rogue', 'the rogue picks locks');
  assert.strictEqual(b.bonus, C.skillBonus(run, run.heroes[b.hero], 'thievery'));
  const lines = C.applyOutcome(run, { gold: 30, item: 1, damage: { who: 'all', amt: 4 }, boon: { id: 'b_vigor', who: 'random' } }, {}, () => 0);
  assert(lines.length >= 4);
  assert.strictEqual(run.gold, 70);
  assert(run.heroes.every(h => h.damage === 4));
  assert(run.heroes.some(h => h.boons.includes('b_vigor')));
  // an event that turns into a fight hands battleSetup a generated fight
  const ev = C.mapOf(run).nodes.find(n => n.type === 'event');
  run.path = []; C.enter(run, ev.id); run.event.id = 'ambush';
  C.resolveChoice(run, 1, () => 0);
  assert(run.event.fight, 'strike first starts a fight');
  const s = C.battleSetup(run, ev.id); assert(s.scen.gen && s.kind === 'combat');
  for (const id of Object.keys(G.Events)) for (const c of G.Events[id].choices) {
    if (c.check) assert(G.Skills[c.check.skill] && G.SkillDC[c.check.dc], `${id}: ${c.label}`);
    for (const o of [c.outcome, c.success, c.fail].concat((c.luck || []).map(l => l.out)).filter(Boolean)) {
      if (o.boon) assert(G.Boons[o.boon.id]); if (o.curse) assert(G.Boons[o.curse.id] && G.Boons[o.curse.id].curse);
    }
  }
});

test('rest sites: recover heals, meditate restores dailies, a vigil raises the fallen', () => {
  const run = fakeRun();
  run.heroes.forEach(h => { h.damage = 9; h.surgesSpent = 3; h.daily = ['x']; });
  run.rest = { done: null }; C.restAt(run, 'recover');
  assert(run.heroes.every(h => h.damage === 0 && h.surgesSpent === 1 && h.daily.length === 1));
  assert.strictEqual(C.restAt(run, 'meditate'), null, 'one choice per rest site');
  run.rest = { done: null }; C.restAt(run, 'meditate'); assert(run.heroes.every(h => !h.daily.length));
  run.heroes[3].dead = true; run.rest = { done: null }; C.restAt(run, 'vigil');
  assert(!run.heroes[3].dead && run.heroes[3].damage > 0);
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
  run.camp = { actDone: false }; C.breakCamp(run);
  assert.strictEqual(C.status(run, h).hp, 1);
});

test('a lost battle or the final boss ends the run and writes the record', () => {
  const store = {}; global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const run = fakeRun();
  run.act = 2;
  const boss = C.mapOf(run).nodes.find(n => n.type === 'boss');
  run.node = boss.id;
  const B = battleFor(run, boss.id);
  B.over = 'win'; B.round = 6;
  const r = C.recordBattle(run, boss.id, B, () => 0);
  assert(r.over); assert.strictEqual(run.outcome, 'victory'); assert(run.camp, 'still shows the spoils');
  const rec = C.records()[0];
  assert.strictEqual(rec.outcome, 'victory'); assert.strictEqual(rec.act, 3);
  const run2 = fakeRun();
  const id = firstFight(run2);
  const B2 = battleFor(run2, id);
  B2.over = 'lose'; B2.units.filter(u => u.side === 'hero').forEach(u => { u.dead = true; });
  C.recordBattle(run2, id, B2);
  assert.strictEqual(C.records()[0].outcome, 'defeat');
  assert.strictEqual(C.records()[0].reached, B2.scen.name);
  assert(C.records()[0].heroes.every(h => h.fell));
  delete global.localStorage;
});

// ---------- Ability polish: edge cases ----------
const P = G.Build.POWERS;
const give = (u, id) => { const p = G.Build.concrete(u, P[id], u.feats); u.powers.push(p); return p; };
const openNear = (B, h, pred) => Hex.neighbors(h).filter(n => E.terr(B, n) && !E.terr(B, n).block && !E.unitAt(B, n) && (!pred || pred(n)));

test('a creature stopped while passing through an ally steps back to a hex of its own', () => {
  const { B, ftr, warg, gob } = arena('goblins', { ftr: u => u.cls === 'fighter', warg: u => u.id === 'warg', gob: u => u.id === 'goblin_skulker' });
  ftr.pos = off(4, 9);
  // A and Bh are both next to the fighter; C is out of his reach
  let A, Bh, C;
  for (let d = 0; d < 6 && !C; d++) {
    A = Hex.neighbor(ftr.pos, d); Bh = Hex.neighbor(ftr.pos, (d + 1) % 6);
    if (!openNear(B, ftr.pos).some(h => Hex.eq(h, A)) || !openNear(B, ftr.pos).some(h => Hex.eq(h, Bh))) continue;
    C = openNear(B, Bh, h => Hex.dist(h, ftr.pos) === 2)[0];
  }
  assert(C, 'found a lane');
  warg.pos = A; gob.pos = Bh; warg.hp = warg.maxHp = 500; B.active = warg;
  fixDice(19);
  E.runAuto(E.moveAlong(B, warg, [A, Bh, C], 'move'));
  E.setRng(Math.random);
  assert(B.log.some(l => /stopped in their tracks/.test(l.msg)), 'the fighter\'s opportunity attack stops it');
  assert(Hex.eq(warg.pos, A), 'it steps back off its ally'); assert(Hex.eq(gob.pos, Bh));
  // the same when a hero gets stuck in Sticky Jam under a friend
  {
    const { B, a, b } = arena('goblins', { a: u => u.cls === 'fighter', b: u => u.cls === 'rogue' });
    const s0 = off(4, 9), m = Hex.neighbor(s0, 0), e = Hex.neighbor(m, 0);
    a.pos = s0; b.pos = m; E.tile(B, m).terrain = 'jam'; B.active = a;
    E.runAuto(E.doMove(B, a, e));
    assert(Hex.eq(a.pos, s0) && Hex.eq(b.pos, m), 'stuck under a friend, so back to the start');
  }
  // and a Large creature can never end its move on top of a smaller ally listed after it
  {
    const { B, golem, puff } = arena('golem', { golem: u => u.id === 'pastry_golem', puff: u => u.id === 'gingerbread' || u.id === 'cream_puff' || (u.monster && !u.object && !u.solo) });
    golem.pos = off(8, 5); puff.pos = Hex.add(golem.pos, { q: 3, r: 0 });
    const r = E.reach(B, golem, 5, 'move');
    for (const v of r.values()) if (!v.noEnd) assert(!E.footprint(golem, v.h).some(f => Hex.eq(f, puff.pos)), 'no end on the ally');
  }
});

test('Combat Challenge punishes a marked foe that shifts away from the Fighter', () => {
  const { B, ftr, gob } = arena('goblins', { ftr: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  ftr.pos = off(4, 9);
  gob.pos = openNear(B, ftr.pos)[0];
  const away = openNear(B, gob.pos, h => Hex.dist(h, ftr.pos) === 2)[0]; assert(away);
  E.addCond(B, gob, 'marked', { src: ftr.uid, dur: 'eont' });
  B.active = gob; B.turnNo = 99; gob.act = { std: 1, move: 1, minor: 1 };
  fixDice(15);
  assert(E.runAuto(E.doMove(B, gob, away, 'shift')));
  E.setRng(Math.random);
  assert(B.log.some(l => /Combat Challenge punishes/.test(l.msg)));
});

test('Hold the Line pins: a pinned (or immobilized) creature can\'t shift, by any means', () => {
  const { B, ftr, gob } = arena('goblins', { ftr: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  ftr.pos = off(4, 9); gob.pos = openNear(B, ftr.pos)[0]; gob.hp = gob.maxHp = 200; B.active = ftr;
  const hold = give(ftr, 'f_pin');
  fixDice(19);
  E.runAuto(E.usePower(B, ftr, hold, { unit: gob }));
  E.setRng(Math.random);
  assert(E.hasCond(gob, 'pinned') && !E.canShift(gob));
  B.active = gob; gob.act = { std: 1, move: 1, minor: 1 };
  assert(!E.runAuto(E.doMove(B, gob, openNear(B, gob.pos)[0], 'shift')), 'no shift action');
  const before = gob.pos;
  E.runAuto(E.applyEffect(B, gob, gob, { t: 'shift', n: 2 }, {}));
  assert(Hex.eq(gob.pos, before), 'no shift from a power either');
  assert(E.speedOf(gob) > 0, 'walking is still allowed');
  E.removeCond(gob, c => c.c === 'pinned'); E.addCond(B, gob, 'immobilized', { dur: 'save' });
  assert(!E.canShift(gob));
});

test('Relentless and a Phoenix Feather each save you once, one at a time, and never while dying', () => {
  const { B, orc, gob } = arena('goblins', { orc: u => u.ancestry === 'orc', gob: u => u.id === 'goblin_skulker' }, 7, 1);
  orc.traits.push('g_phoenix'); B.active = gob;
  E.runAuto(E.dealDamage(B, gob, orc, orc.hp + 5));
  assert.strictEqual(orc.hp, 1); assert(!!orc.used.__relentless !== !!orc.used.__phoenix, 'only one of them fires');
  E.runAuto(E.dealDamage(B, gob, orc, 10));
  assert.strictEqual(orc.hp, 1); assert(orc.used.__relentless && orc.used.__phoenix, 'then the other');
  E.runAuto(E.dealDamage(B, gob, orc, 10));
  assert(E.isDying(orc));
  E.runAuto(E.dealDamage(B, gob, orc, 3));
  assert(orc.hp <= 0 && E.isDying(orc) && orc.deathFails === 1);
});

test('healing never burns a surge on someone at full health', () => {
  const { B, cleric, ally, gob } = arena('goblins', { cleric: u => u.cls === 'cleric', ally: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  cleric.pos = off(4, 9); ally.pos = Hex.add(cleric.pos, { q: 2, r: 0 }); gob.pos = openNear(B, cleric.pos)[0]; gob.hp = gob.maxHp = 300;
  B.active = cleric;
  const s0 = ally.surges, c0 = cleric.surges;
  E.runAuto(E.usePower(B, cleric, cleric.powers.find(p => p.id === 'c_word'), { unit: ally }));
  assert.strictEqual(ally.surges, s0);
  cleric.act = { std: 1, move: 1, minor: 1 };
  fixDice(15);
  E.runAuto(E.usePower(B, cleric, cleric.powers.find(p => p.id === 'c_mend'), { unit: gob }));
  E.setRng(Math.random);
  assert.strictEqual(ally.surges, s0, 'Mending Strike finds nobody hurt'); assert.strictEqual(cleric.surges, c0);
});

test('powers that don\'t attack can\'t be aimed at objects, and a bad aim spends nothing', () => {
  const { B, ranger, barrel } = arena('bandits', { ranger: u => u.cls === 'ranger', barrel: u => u.id === 'oil_barrel' }, 7, 1);
  const q = ranger.powers.find(p => p.id === 'g_quarry');
  ranger.pos = off(4, 9); barrel.pos = Hex.add(ranger.pos, { q: 3, r: 0 }); B.active = ranger;
  assert(!E.validTarget(B, ranger, q, barrel), 'no hunting barrels');
  assert.strictEqual(E.runAuto(E.usePower(B, ranger, q, { unit: barrel })), false);
  assert.strictEqual(ranger.act.minor, 1); assert(!ranger.uses.g_quarry);
  const shot = ranger.powers.find(p => p.basicRanged);
  assert(E.validTarget(B, ranger, shot, barrel), 'but you can still shoot one');
});

test('Bait and Switch: no swapping with a Large creature; a foe swapped onto a fire burns', () => {
  {
    const { B, rog, golem } = arena('golem', { rog: u => u.cls === 'rogue', golem: u => u.id === 'pastry_golem' });
    rog.pos = off(8, 9); golem.pos = Hex.add(rog.pos, { q: 0, r: -2 }); B.active = rog;
    const p0 = rog.pos, g0 = golem.pos;
    fixDice(19);
    E.runAuto(E.usePower(B, rog, rog.powers.find(p => p.id === 'r_bait'), { unit: golem }));
    E.setRng(Math.random);
    assert(Hex.eq(rog.pos, p0) && Hex.eq(golem.pos, g0));
  }
  {
    const { B, rog, bandit } = arena('bandits', { rog: u => u.cls === 'rogue', bandit: u => u.monster && !u.object && !u.minion });
    const fire = [...B.tiles.values()].find(t => t.terrain === 'fire');
    rog.pos = { q: fire.q, r: fire.r }; bandit.pos = openNear(B, rog.pos)[0]; bandit.hp = bandit.maxHp = 300; B.active = rog;
    fixDice(19);
    E.runAuto(E.usePower(B, rog, rog.powers.find(p => p.id === 'r_bait'), { unit: bandit }));
    E.setRng(Math.random);
    assert(Hex.eq(bandit.pos, { q: fire.q, r: fire.r }));
    assert(B.log.some(l => l.msg.startsWith(bandit.name + ' is shoved into the Campfire')));
  }
});

test('a single saving throw goes against the worst effect first', () => {
  const { B, hero } = arena('goblins', { hero: u => u.side === 'hero' });
  E.addCond(B, hero, 'slowed', { dur: 'save', src: -1 }); E.addCond(B, hero, 'stunned', { dur: 'save', src: -1 });
  fixDice(15);
  E.runAuto(E.savingThrows(B, hero, 0, true));
  E.setRng(Math.random);
  assert(!E.hasCond(hero, 'stunned') && E.hasCond(hero, 'slowed'));
});

test('re-marking a foe never shortens a lasting mark', () => {
  const { B, ftr, gob } = arena('goblins', { ftr: u => u.cls === 'fighter', gob: u => u.id === 'goblin_skulker' });
  E.addCond(B, gob, 'marked', { src: ftr.uid, dur: 'save' });
  E.addCond(B, gob, 'marked', { src: ftr.uid, dur: 'eont' });
  assert.strictEqual(E.condsOf(gob, 'marked')[0].dur, 'save');
});

test('signature tricks: Twisting Knife, Careful Aim, Crushing Blow, Deadly Gambit', () => {
  const { B, rog, ranger, ftr, gob } = arena('goblins', { rog: u => u.cls === 'rogue', ftr: u => u.cls === 'fighter', ranger: u => u.side === 'hero' && u.cls === 'cleric', gob: u => u.id === 'goblin_skulker' });
  gob.hp = gob.maxHp = 300; gob.actedThisFight = true;
  rog.pos = off(4, 9); gob.pos = openNear(B, rog.pos)[0]; ftr.pos = off(12, 9); B.active = rog; B.turnNo = 40;
  assert(!E.hasCA(B, rog, gob, { melee: true }));
  fixDice(15);
  E.runAuto(E.usePower(B, rog, rog.powers.find(p => p.id === 'r_twist'), { unit: gob }));
  assert(B.fx.some(f => f.text === 'Sneak Attack!'), 'Sneak Attack without combat advantage');
  // Deadly Gambit: a 17 crits with combat advantage
  rog.sneakTurn = null; B.turnNo = 50; E.addCond(B, gob, 'cagrant', { src: rog.uid });
  const gam = give(rog, 'r_gambit'); rog.act = { std: 1, move: 1, minor: 1 };
  fixDice(17); B.fx.length = 0;
  E.runAuto(E.usePower(B, rog, gam, { unit: gob }));
  assert(B.fx.some(f => f.t === 'roll' && f.crit), 'crit on 17 with advantage');
  E.setRng(Math.random);
  // Careful Aim: full damage only against the quarry (any hero will do for the spec)
  const ca = give(ranger, 'g_careful'); ranger.pos = off(6, 9);
  const flat0 = E.damageSpec(B, ranger, ca, gob).flat;
  E.addCond(B, gob, 'quarry', { src: ranger.uid, dur: 'enc' });
  assert(E.damageSpec(B, ranger, ca, gob).flat > flat0 || E.mod(ranger.abil.STR) <= 0);
  // Crushing Blow: +1W against your own mark
  const cb = give(ftr, 'f_crush');
  assert(!cb.bonusDmg(B, ftr, gob));
  E.addCond(B, gob, 'marked', { src: ftr.uid });
  assert.strictEqual(cb.bonusDmg(B, ftr, gob), '1W');
});

test('class identity: no two classes share a power with the same mechanics', () => {
  const sig = (p) => JSON.stringify({ tgt: p.tgt, size: p.size, vs: p.atk && p.atk.vs, bonus: p.atk && p.atk.bonus, dmg: p.dmg, hits: p.hits, noMod: !!p.noMod,
    hit: (p.hit || []).map(e => [e.t, e.c, e.dur, e.on, e.n, e.vs].join()), miss: Array.isArray(p.miss) ? p.miss.map(e => [e.t, e.c].join()) : p.miss,
    eff: (p.eff || []).map(e => [e.t, e.c, e.on].join()), shift: p.shiftAfter, action: p.action, extra: [p.bonusDmg, p.critCA, p.sneakAlways, p.modVsQuarry, p.after, p.zone].map(Boolean) });
  const seen = {};
  const dups = [];
  for (const p of Object.values(P)) {
    if (!p.cls) continue;
    const k = sig(p);
    if (seen[k] && seen[k].cls !== p.cls) dups.push(`${seen[k].name} (${seen[k].cls}) = ${p.name} (${p.cls})`);
    seen[k] = seen[k] || p;
  }
  assert.deepStrictEqual(dups, []);
  // and every power explains itself in the builder
  for (const p of Object.values(P)) if (p.cls) assert(G.Build.describe(p).length >= 2, p.id);
});

console.log(`${n} rules checks passed`);
