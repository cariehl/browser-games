// The Splatterpress: its hall, its mechanics, and its two modes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, World, Content, DEFAULT_MAP, messages } from './helpers.js';
import { AttackAction } from '../src/sim/actions.js';
import { Arena, ArenaAction, BossState } from '../src/sim/boss.js';
import { key, chebyshev } from '../src/sim/grid.js';

const fresh = (seed = 4) => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(seed);
  return world;
};
const bossOf = (world) => Arena.bosses(world)[0];
const doorOf = (world) => Arena.door(world, bossOf(world));
/** Spawns [names] and walks them into the hall. */
function party(world, ...names) {
  const boss = bossOf(world);
  const door = doorOf(world);
  const [outside] = Arena.doorSides(world, door, boss);
  return names.map((name) => {
    const p = world.spawnPlayer(name);
    p.teleport(outside);
    act(world, p, new ArenaAction(door.id, 'enter'));
    assert.ok(world.inZone(p.tile, 'arena'), `${name} is inside`);
    return p;
  });
}
/** A tile in the hall that no current hazard marks, away from the boss. */
function safeTile(world, boss, avoid = []) {
  const marked = new Set(world.hazards.flatMap((h) => h.tiles.map(key)));
  return Arena.tiles(world, 'arena', world.areaIdAt(boss.spawn_tile)).find((t) => !marked.has(key(t)) && chebyshev(t, boss.tile) > 3 && !avoid.some((a) => a.x === t.x && a.y === t.y));
}
const tickUntil = (world, done, max = 200) => {
  for (let i = 0; i < max; i++) {
    if (done()) return true;
    world.runTick();
  }
  return done();
};

test('the boss is a BossState in its sealed hall; the door lets you in and out between fights', () => {
  const world = fresh();
  const boss = bossOf(world);
  assert.ok(boss instanceof BossState);
  const [ann] = party(world, 'Ann');
  const door = doorOf(world);
  act(world, ann, new ArenaAction(door.id, 'easy'));
  assert.ok(boss.fight, 'the fight is on');
  // Nobody else gets in, and Ann can't get out.
  const bob = world.spawnPlayer('Bob');
  bob.teleport(Arena.doorSides(world, door, boss)[0]);
  act(world, bob, new ArenaAction(door.id, 'enter'));
  assert.ok(!world.inZone(bob.tile, 'arena'));
  assert.ok(messages(world, bob.id).some((m) => m.includes('sealed')));
});

test('HP scales with the players inside at the start', () => {
  const one = fresh();
  party(one, 'Ann');
  act(one, one.players()[0], new ArenaAction(doorOf(one).id, 'easy'));
  const three = fresh();
  const ps = party(three, 'Ann', 'Bob', 'Cy');
  act(three, ps[0], new ArenaAction(doorOf(three).id, 'easy'));
  const easy = bossOf(one).def.boss.modes.easy;
  assert.equal(bossOf(one).maxHp(), easy.hp);
  assert.equal(bossOf(three).maxHp(), easy.hp + 2 * easy.hp_per_player);
});

test('a dodge tile hurts whoever is on it when it resolves, and nobody who stepped off', () => {
  const world = fresh();
  const [ann, bob] = party(world, 'Ann', 'Bob');
  const boss = bossOf(world);
  act(world, ann, new ArenaAction(doorOf(world).id, 'easy'));
  assert.ok(tickUntil(world, () => world.hazards.some((h) => h.kind === 'dodge')));
  const hazard = world.hazards.find((h) => h.kind === 'dodge');
  ann.teleport(hazard.tiles[0]);
  bob.teleport(safeTile(world, boss));
  const [annHp, bobHp] = [ann.hp, bob.hp];
  // Keep them still and out of the boss's reach.
  boss.clearTask();
  while (world.tick < hazard.resolve - 1) { world.runTick(); boss.clearTask(); ann.teleport(hazard.tiles[0]); }
  ann.teleport(hazard.tiles[0]);
  world.runTick();
  assert.equal(ann.hp, annHp - hazard.damage);
  assert.equal(bob.hp, bobHp);
});

test('adds that reach the boss repair it; killed ones do not', () => {
  const world = fresh();
  const [ann] = party(world, 'Ann');
  const boss = bossOf(world);
  act(world, ann, new ArenaAction(doorOf(world).id, 'easy'));
  boss.hp = 20;
  assert.ok(tickUntil(world, () => boss.fight.adds.length > 0, 60));
  const [first, ...rest] = boss.fight.adds.map((id) => world.entities.get(id));
  for (const add of rest) world.kill(add, ann);
  world.kill(first, ann);
  const hp = boss.hp;
  world.runTick();
  assert.ok(boss.hp <= hp, 'dead drones repair nothing');
  // The next wave walks in untouched.
  ann.hp = 1000;
  assert.ok(tickUntil(world, () => boss.hp > hp, 120), 'a drone that gets there repairs it');
});

test('Overclocked: needs the unlock; soaks split the damage; an empty soak hurts everyone', () => {
  const world = fresh();
  const [ann, bob, cy] = party(world, 'Ann', 'Bob', 'Cy');
  const boss = bossOf(world);
  const door = doorOf(world);
  act(world, ann, new ArenaAction(door.id, 'overclocked'));
  assert.ok(!boss.fight, 'not without the unlock');
  ann.unlocks.overclocked = true;
  act(world, ann, new ArenaAction(door.id, 'overclocked'));
  assert.equal(boss.mode_id, 'overclocked');
  // Phase two: adds and soaks.
  boss.hp = Math.floor(boss.maxHp() * 0.5);
  for (const p of [ann, bob, cy]) p.hp = 1000;
  assert.ok(tickUntil(world, () => world.hazards.some((h) => h.kind === 'soak'), 40));
  const soak = world.hazards.find((h) => h.kind === 'soak');
  assert.equal(soak.tiles.length, 2, 'one fewer than the players');
  // Two stand on the first mark; nobody on the second.
  const spare = safeTile(world, boss, soak.tiles);
  const hold = () => { boss.clearTask(); world.pending_hits = []; ann.teleport(soak.tiles[0]); bob.teleport(soak.tiles[0]); cy.teleport(spare); };
  while (world.tick < soak.resolve - 1) { hold(); world.runTick(); }
  hold();
  world.hazards = world.hazards.filter((h) => h === soak);
  // Other marks may have caught someone while they waited: measure from here.
  const [a, b, c] = [ann.hp, bob.hp, cy.hp];
  world.runTick();
  const share = Math.ceil(soak.damage / 2);
  const wipe = boss.mode.wipe_damage;
  assert.equal(ann.hp, a - share - wipe);
  assert.equal(bob.hp, b - share - wipe);
  assert.equal(cy.hp, c - wipe);
});

test('the shield blocks all damage until the panels are stepped on in order; a wrong one resets the run', () => {
  const world = fresh();
  const [ann] = party(world, 'Ann');
  const boss = bossOf(world);
  ann.unlocks.overclocked = true;
  act(world, ann, new ArenaAction(doorOf(world).id, 'overclocked'));
  boss.hp = Math.floor(boss.maxHp() * 0.2);
  ann.hp = 1000;
  world.runTick();
  assert.ok(boss.shield);
  const run = world.hazards.find((h) => h.kind === 'panel');
  assert.ok(run);
  // Hits do nothing.
  const hp = boss.hp;
  boss.damage_by = {};
  world.pending_hits.push({ attacker_id: ann.id, target_id: boss.id, damage: 5, impact_tick: world.tick + 1 });
  world.runTick();
  assert.equal(boss.hp, hp);
  // Wrong panel first: a shock and a reset.
  ann.teleport(run.tiles[1]);
  world.runTick();
  assert.equal(run.progress, 0);
  assert.ok(ann.hp < 1000);
  // In order: the shield drops.
  for (const t of run.tiles) {
    ann.teleport(t);
    world.runTick();
  }
  assert.equal(boss.shield, false);
  world.pending_hits.push({ attacker_id: ann.id, target_id: boss.id, damage: 5, impact_tick: world.tick + 1 });
  world.runTick();
  assert.ok(boss.hp < hp);
});

test('a death in the hall leaves the wreck outside the door, and a wipe resets the boss', () => {
  const world = fresh();
  const [ann] = party(world, 'Ann');
  const boss = bossOf(world);
  act(world, ann, new ArenaAction(doorOf(world).id, 'easy'));
  boss.hp = 10;
  ann.inventory.add(Content.item('scrap_metal'));
  world.kill(ann, boss);
  const wreck = [...world.wrecks.values()].find((w) => w.owner_id === ann.id);
  assert.ok(!world.inZone(wreck.tile, 'arena'));
  assert.ok(chebyshev(wreck.tile, doorOf(world).tile) <= 2);
  world.runTick();
  assert.equal(boss.fight, null);
  assert.equal(boss.hp, boss.maxHp());
});

test('same seed, same fight', () => {
  const run = () => {
    const world = fresh(11);
    const [ann] = party(world, 'Ann');
    ann.hp = 100000;
    act(world, ann, new ArenaAction(doorOf(world).id, 'easy'));
    const seen = [];
    for (let i = 0; i < 60; i++) {
      world.runTick();
      for (const h of world.hazards) seen.push(`${h.kind}:${h.tiles.map(key).join(';')}`);
    }
    return seen.join('|');
  };
  assert.equal(run(), run());
});

test('hitting the press between fights wakes it in easy mode, and killing it opens the door', () => {
  const world = fresh();
  const [ann] = party(world, 'Ann');
  const boss = bossOf(world);
  ann.teleport({ x: boss.tile.x - 1, y: boss.tile.y });
  act(world, ann, new AttackAction(boss.id));
  assert.ok(tickUntil(world, () => boss.fight != null, 20));
  assert.equal(boss.mode_id, 'easy');
  world.kill(boss, ann);
  assert.equal(boss.fight, null);
  assert.ok([...world.nodes.values()].some((n) => n.def.id === 'splatterpress_husk'));
});
