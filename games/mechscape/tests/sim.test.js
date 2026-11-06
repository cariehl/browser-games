// Headless checks of the sim: run with `npm test` (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, act, runUntil, messages, die, World, Content, DEFAULT_MAP } from './helpers.js';
import { Skills } from '../src/sim/skills.js';
import { MapData } from '../src/sim/map_data.js';
import { Grid } from '../src/sim/grid.js';
import { Combat } from '../src/sim/combat.js';
import { NpcState } from '../src/sim/entity.js';
import { SaveGame } from '../src/sim/save_game.js';
import { ItemStack } from '../src/sim/inventory.js';
import {
  Action, MoveAction, InteractAction, CraftAction, AttackAction, EquipAction, UseItemAction, DropAction,
  TakeAction, DepositAction, DepositAllAction, WithdrawAction, SwapItemsAction, UnequipAction,
} from '../src/sim/actions.js';
import { checkLoops } from '../tools/check_loops.js';

const item = (id) => Content.item(id);

test('the XP curve matches RuneScape', () => {
  assert.equal(Skills.xpForLevel(2), 83);
  assert.equal(Skills.xpForLevel(10), 1154);
  assert.equal(Skills.xpForLevel(99), 13034431);
  assert.equal(Skills.levelForXp(82), 1);
  assert.equal(Skills.levelForXp(83), 2);
});

test('combat levels: 3 for a new pilot, OSRS-like at the top, and NPCs ordered by toughness', () => {
  const { world, player } = makeWorld();
  assert.equal(Combat.level(player), 3);
  for (const skill of Skills.ALL) player.xp[skill] = Skills.xpForLevel(99);
  assert.equal(Combat.level(player), 113);
  // Boosts don't count.
  player.boosts.melee = { amount: 10, until: 1e9 };
  assert.equal(Combat.level(player), 113);
  const npc = (id) => NpcState.create(-1, Content.npcs[id], { x: 0, y: 0 });
  const sentry = Combat.level(npc('relic_sentry'));
  const loader = Combat.level(npc('loader_mech'));
  const breacher = Combat.level(npc('breacher_mech'));
  assert.ok(sentry < loader && loader < breacher, `${sentry} < ${loader} < ${breacher}`);
});

test('a new player starts with 10 HP at the spawn', () => {
  const { world, player } = makeWorld();
  assert.deepEqual(player.tile, world.spawn_point);
  assert.equal(player.hp, 10);
  assert.equal(player.maxHp(), 10);
});

test('walking takes one tile a tick, running two', () => {
  const { world, player } = makeWorld(1, { x: 0, y: 0 });
  act(world, player, new MoveAction({ x: 4, y: 0 }));
  assert.deepEqual(player.tile, { x: 1, y: 0 });
  player.running = true;
  world.runTick();
  assert.deepEqual(player.tile, { x: 3, y: 0 });
  assert.equal(player.steps_this_tick.length, 3);
});

test('paths never cut a blocked corner', () => {
  const grid = new Grid(3, 3);
  grid.setSolid({ x: 1, y: 0 }, true);
  const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 1 });
  // (0,0) -> (1,1) would squeeze past the wall at (1,0).
  assert.notDeepEqual(path[1], { x: 1, y: 1 });
  assert.deepEqual(path.at(-1), { x: 2, y: 1 });
});

test('bad maps fail with errors that name the line', () => {
  const map = MapData.parse('name: X\n[legend]\n.  floor\n[grid]\n..\n.?\n', 'bad.map');
  assert.ok(map.errors.some((e) => e.includes("'?'")));
  assert.ok(map.errors.some((e) => e.includes('spawn')));
});

test('everything in the game world can be reached from spawn', () => {
  const world = new World(DEFAULT_MAP);
  assert.equal(world.map_name, 'Scrapyard');
  // Walk the world from spawn: through hatches, lifts and gates, through
  // the arena door, and past the survey puzzles as if they were solved.
  const PUZZLES = new Set(['broken_bridge', 'gas_door', 'holo_veil']);
  const open = (t) => world.isWalkable(t) || (world.terrainAt(t) && PUZZLES.has(world.terrainAt(t).id));
  const seen = new Set();
  const queue = [world.spawn_point];
  const k = (t) => `${t.x},${t.y}`;
  seen.add(k(world.spawn_point));
  const visit = (t) => {
    if (!seen.has(k(t))) {
      seen.add(k(t));
      queue.push(t);
    }
  };
  while (queue.length) {
    const t = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (open(n) && world.edgeOk(t, n)) visit(n);
      const station = world.stationAt(n);
      if (!station) continue;
      const link = world.linkAt(n);
      if (link) visit(world.freeTileNear(link.to, 3));
      if (station.def.kind === 'arena_door') visit({ x: n.x + dx, y: n.y + dy });
    }
  }
  const unreachable = [];
  for (const object of [...world.nodes.values(), ...world.stations.values()]) {
    const ok = object.interactionTiles().some((t) => seen.has(k(t)) && world.edgeOk(t, object.tile));
    if (!ok) unreachable.push(`${object.displayName()} at ${object.tile.x},${object.tile.y}`);
  }
  for (const npc of world.entities.values()) {
    if (!seen.has(k(npc.tile))) unreachable.push(`${npc.displayName()} at ${npc.tile.x},${npc.tile.y}`);
  }
  assert.deepEqual(unreachable, []);
  // Every link starts on a station and lands on open ground.
  for (const [at, link] of world.links) {
    const [x, y] = at.split(',').map(Number);
    assert.ok(world.stationAt({ x, y }), `a station at ${at}`);
    assert.ok(world.isWalkable(link.to), `link from ${at} lands on open ground`);
  }
});

test('salvaging a drone gives scrap and XP until it is stripped', () => {
  const { world, player } = makeWorld(3);
  const drone = world.nodeAt({ x: 6, y: 12 });
  assert.equal(drone.def.id, 'crashed_drone');
  act(world, player, new InteractAction(drone.id));
  const ticks = runUntil(world, () => player.task == null);
  assert.ok(ticks > 0);
  const scrap = player.inventory.countOf(item('scrap_metal'));
  assert.ok(scrap >= 1);
  assert.equal(player.xp.salvaging, scrap * drone.def.xp);
  assert.ok(drone.isDepleted(world.tick));
});

test('a level too low refuses the node', () => {
  const { world, player } = makeWorld(1);
  const hull = world.nodeAt({ x: 19, y: 8 });
  assert.equal(hull.def.id, 'derelict_hull');
  act(world, player, new InteractAction(hull.id));
  let said = [];
  runUntil(world, () => {
    said = said.concat(messages(world, player.id));
    return player.task == null;
  });
  assert.ok(said.some((m) => m.includes('Salvaging level of 10')), said.join('\n'));
});

test('crafting at the weapons bench uses materials and pays XP per material', () => {
  const { world, player } = makeWorld(1, { x: 6, y: 9 });
  player.inventory.add(item('scrap_metal'), 1);
  player.inventory.add(item('scrap_metal'), 6);
  const bench = world.stationAt({ x: 6, y: 8 });
  const index = bench.def.recipes.findIndex((r) => r.id === 'scrap_blade');
  act(world, player, new CraftAction(bench.id, index, CraftAction.ALL));
  runUntil(world, () => player.task == null);
  assert.equal(player.inventory.countOf(item('scrap_blade')), 2);
  assert.equal(player.inventory.countOf(item('scrap_metal')), 1);
  assert.equal(player.xp.engineering, 2 * 21);
});

test('siphoning needs a canister and fills it up to 50', () => {
  const { world, player } = makeWorld(5, { x: 5, y: 15 });
  const vent = world.nodeAt({ x: 4, y: 15 });
  act(world, player, new InteractAction(vent.id));
  assert.ok(messages(world, player.id).some((m) => m.includes('empty canister')) || player.task == null);
  player.inventory.add(item('canister'));
  act(world, player, new InteractAction(vent.id));
  runUntil(world, () => player.inventory.countOf(item('vent_gas')) >= 3);
  const gas = player.inventory.slots.find((s) => s && s.item.id === 'vent_gas');
  assert.ok(gas.count >= 3 && gas.count <= 50);
  assert.equal(player.inventory.countOf(item('canister')), 0);
});

test('a canister empties back into a canister', () => {
  const { player } = makeWorld(1);
  player.inventory.add(item('canister'));
  player.inventory.add(item('vent_gas'), 10);
  player.inventory.remove(item('vent_gas'), 10);
  assert.equal(player.inventory.countOf(item('canister')), 1);
});

test('fighting a sentry: committed hits land, it collapses into a husk, and waits for it', () => {
  const { world, player } = makeWorld(7, { x: 22, y: 22 });
  player.xp.melee = Skills.xpForLevel(20);
  player.weapon = item('relic_blade');
  const sentry = world.npcSpawnedAt({ x: 23, y: 22 });
  let attacks = 0;
  let hits = 0;
  let husk = null;
  const count = () => {
    for (const e of world.events) {
      if (e.type === 'attack' && e.data.attacker === player.id) attacks++;
      if (e.type === 'hit' && e.data.attacker === player.id) hits++;
    }
  };
  act(world, player, new AttackAction(sentry.id));
  count();
  runUntil(world, () => {
    count();
    if (player.hp < 4) player.hp = player.maxHp(); // Keep the test about the sentry.
    husk = world.nodeAt(sentry.husk_tile);
    return sentry.isDead();
  });
  assert.ok(attacks >= hits && hits >= 1);
  assert.ok(husk && husk.def.id === sentry.def.husk.id);
  // While the husk lies there, the respawn keeps being pushed back.
  for (let i = 0; i < sentry.def.respawn_ticks + 5; i++) world.runTick();
  assert.ok(sentry.isDead());
  world.removeObject(husk.id);
  runUntil(world, () => !sentry.isDead(), sentry.def.respawn_ticks + 5);
  assert.ok(!sentry.isDead());
  assert.deepEqual(sentry.tile, sentry.spawn_tile);
});

test('a hit never deals more than the target has left', () => {
  const { world, player } = makeWorld(1, { x: 22, y: 22 });
  const sentry = world.npcSpawnedAt({ x: 23, y: 22 });
  sentry.hp = 2;
  const p = Combat.profile(player);
  p.max_hit = 50;
  p.accuracy = 100000;
  Combat.commit(world, player, sentry, p, world.tick + 1);
  Combat.commit(world, player, sentry, p, world.tick + 1);
  const damages = world.pending_hits.map((h) => h.damage);
  assert.equal(damages.reduce((a, b) => a + b, 0), 2);
});

test('pistols spend a cartridge a shot and fire over fences, not walls', () => {
  const { world, player } = makeWorld(2, { x: 16, y: 22 });
  player.weapon = item('pipe_pistol');
  player.inventory.add(item('gas_cartridge'), 5);
  // The fence at x = 18 blocks walking, not sight.
  assert.ok(Combat.hasLineOfSight(world, { x: 16, y: 22 }, { x: 23, y: 22 }));
  assert.ok(!Combat.hasLineOfSight(world, { x: 12, y: 10 }, { x: 16, y: 10 }));
  const sentry = world.npcSpawnedAt({ x: 23, y: 22 });
  sentry.def = { ...sentry.def }; // Leave its stats alone, but keep the test still:
  player.tile = { x: 17, y: 22 };
  const fired = () => world.events.some((e) => e.type === 'attack' && e.data.attacker === player.id);
  act(world, player, new AttackAction(sentry.id));
  if (!fired()) runUntil(world, fired, 20);
  assert.equal(player.inventory.countOf(item('gas_cartridge')), 4);
});

test('injecting heals, leaves the empty injector, and delays the next attack', () => {
  const { world, player } = makeWorld(1);
  player.hp = 4;
  player.inventory.add(item('healing_injector'));
  const before = player.next_attack_tick;
  act(world, player, new UseItemAction(0));
  assert.equal(player.hp, 7);
  assert.equal(player.inventory.slots[0].item.id, 'empty_injector');
  assert.ok(player.next_attack_tick >= Math.max(before, world.tick) + 3);
  // Too soon for another.
  player.inventory.slots[1] = new ItemStack(item('healing_injector'));
  act(world, player, new UseItemAction(1));
  assert.equal(player.hp, 7);
});

test('boost injectors raise the level for rolls, never for requirements', () => {
  const { world, player } = makeWorld(1);
  player.xp.melee = Skills.xpForLevel(10);
  player.inventory.add(item('edge_injector'));
  act(world, player, new UseItemAction(0));
  assert.ok(player.boostOf('melee') > 0);
  assert.equal(player.effectiveLevel('melee'), 10 + player.boostOf('melee'));
  assert.equal(player.level('melee'), 10);
});

test('equipping needs the level, and swaps with what was worn', () => {
  const { world, player } = makeWorld(1);
  player.inventory.add(item('alloy_blade'));
  act(world, player, new EquipAction(0));
  assert.equal(player.weapon, null);
  player.xp.melee = Skills.xpForLevel(10);
  player.weapon = item('scrap_blade');
  act(world, player, new EquipAction(0));
  assert.equal(player.weapon.id, 'alloy_blade');
  assert.equal(player.inventory.slots[0].item.id, 'scrap_blade');
  act(world, player, new UnequipAction());
  assert.equal(player.weapon, null);
});

test('drops land on your tile and can be taken back', () => {
  const { world, player } = makeWorld(1);
  player.inventory.add(item('scrap_metal'));
  act(world, player, new DropAction(0));
  assert.equal(player.inventory.freeSlots(), 28);
  const [ground] = world.groundItemsAt(player.tile);
  assert.equal(ground.item.id, 'scrap_metal');
  act(world, player, new TakeAction(ground.id));
  assert.equal(player.inventory.countOf(item('scrap_metal')), 1);
  assert.equal(world.ground_items.size, 0);
});

test('actions apply in the order sent, even within one tick', () => {
  const { world, player } = makeWorld(1);
  player.inventory.add(item('scrap_metal'));
  const swap = new SwapItemsAction(0, 5);
  swap.seq = 1;
  const drop = new DropAction(5);
  drop.seq = 2;
  act(world, player, drop, swap);
  assert.equal(world.ground_items.size, 1);
  assert.equal(player.last_action_seq, 2);
});

test('actions survive a trip through JSON (the network boundary)', () => {
  const sent = new CraftAction(1003, 2, 5);
  sent.seq = 9;
  const received = Action.fromJSON(JSON.parse(JSON.stringify(sent)));
  assert.ok(received instanceof CraftAction);
  assert.equal(received.seq, 9);
  assert.equal(received.recipe_index, 2);
  assert.equal(received.slot(), 'move');
});

test('storage: deposit, withdraw, gas apart from its canister', () => {
  const world = new World(DEFAULT_MAP);
  const locker = [...world.stations.values()].find((s) => s.def.id === 'storage_locker');
  const player = world.spawn(1, { x: locker.tile.x + 1, y: locker.tile.y });
  player.inventory.add(item('scrap_metal'), 3);
  player.inventory.add(item('canister'));
  player.inventory.add(item('vent_gas'), 37);
  const gasSlot = player.inventory.slots.findIndex((s) => s && s.item.id === 'vent_gas');
  act(world, player, new DepositAction(0, 2), new DepositAction(gasSlot, DepositAction.ALL));
  assert.equal(player.storage.countOf(item('scrap_metal')), 2);
  assert.equal(player.storage.countOf(item('vent_gas')), 37);
  assert.equal(player.storage.countOf(item('canister')), 1);
  act(world, player, new WithdrawAction('vent_gas', WithdrawAction.ALL));
  assert.ok(messages(world, player.id).some((m) => m.includes('empty canister')));
  act(world, player, new WithdrawAction('canister', 1));
  act(world, player, new WithdrawAction('vent_gas', WithdrawAction.ALL));
  assert.equal(player.inventory.countOf(item('vent_gas')), 37);
  act(world, player, new DepositAllAction());
  assert.equal(player.inventory.freeSlots(), 28);
  // Away from the locker, nothing happens.
  player.teleport(world.spawn_point);
  act(world, player, new WithdrawAction('scrap_metal', 1));
  assert.equal(player.inventory.freeSlots(), 28);
});

test('dying drops everything into a wreck only you can salvage, and prints you at spawn', () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(4);
  const player = world.spawnPlayer('Tester');
  const other = world.spawnPlayer('Other');
  player.teleport({ x: 30, y: 30 });
  player.weapon = item('scrap_blade');
  player.armor.head = item('scrap_helmet');
  player.inventory.add(item('scrap_metal'), 4);
  world.kill(player, null);
  // Down where they fell for a few ticks (the death animation), still holding everything.
  assert.ok(player.isDead());
  assert.deepEqual(player.tile, { x: 30, y: 30 });
  assert.equal(world.wrecks.size, 0);
  for (let i = 0; i < World.DYING_TICKS; i++) world.runTick();
  assert.ok(!player.isDead());
  assert.deepEqual(player.tile, world.spawn_point);
  assert.equal(player.hp, player.maxHp());
  assert.equal(player.weapon, null);
  assert.equal(player.inventory.freeSlots(), 28);
  const [wreck] = world.wrecks.values();
  assert.equal(wreck.owner_id, player.id);
  assert.equal(wreck.items.length, 6);
  assert.equal(wreck.expire_tick, world.tick + World.WRECK_TICKS);
  other.teleport({ x: wreck.tile.x + 1, y: wreck.tile.y });
  act(world, other, new InteractAction(wreck.id));
  assert.ok(messages(world, other.id).some((m) => m.includes("isn't yours")));
  player.teleport({ x: wreck.tile.x + 1, y: wreck.tile.y });
  act(world, player, new InteractAction(wreck.id));
  assert.equal(world.wrecks.size, 0);
  assert.equal(player.inventory.countOf(item('scrap_metal')), 4);
  assert.equal(player.inventory.countOf(item('scrap_blade')), 1);
});

test('a loaded save carries on exactly as the original would have', () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(11);
  const player = world.spawnPlayer('Tester');
  player.inventory.add(item('scrap_metal'), 3);
  player.storage.deposit(item('alloy_plating'), 2);
  for (let i = 0; i < 120; i++) world.runTick();
  const copy = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  for (let i = 0; i < 300; i++) {
    world.runTick();
    copy.runTick();
  }
  const strip = (w) => {
    const d = SaveGame.toDict(w);
    return JSON.stringify(d);
  };
  assert.equal(strip(copy), strip(world));
  assert.equal(copy.entities.get(1).storage.countOf(item('alloy_plating')), 2);
});

test('the economy has no production loop that skips combat', () => {
  const { cycles } = checkLoops();
  assert.deepEqual(cycles, []);
});

test('NPCs on the game map fight back and leash home', () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(3);
  const player = world.spawnPlayer('Tester');
  const loader = [...world.entities.values()].find((e) => e.isNpc() && e.def.id === 'loader_mech');
  player.teleport({ x: loader.tile.x - 2, y: loader.tile.y });
  let attacked = false;
  runUntil(world, () => {
    attacked = attacked || world.events.some((e) => e.type === 'attack' && e.data.attacker === loader.id);
    player.hp = player.maxHp();
    return attacked;
  }, 40);
  assert.ok(attacked, 'an aggressive loader attacks a player in range');
});

test('Examine puts a description in the chat box without stopping anything', async () => {
  const { ExamineAction, MoveAction } = await import('../src/sim/actions.js');
  const { world, player } = makeWorld();
  const node = Object.values(Content.nodes)[0];
  act(world, player, new MoveAction({ x: player.tile.x + 5, y: player.tile.y }));
  act(world, player, new ExamineAction('node', node.id));
  assert.ok(messages(world, player.id).includes(node.description || node.display_name));
  assert.ok(player.isMoving(), 'still walking');
  act(world, player, new ExamineAction('npc', 'constructor'));
  assert.equal(messages(world, player.id).length, 0, 'nothing for an unknown id');
  assert.equal(Action.fromJSON({ type: 'examine', kind: 'npc', def: 'Bad id' }), null);
});
