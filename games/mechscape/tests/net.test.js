// Multiplayer: what crosses the network, the server's game, and a real
// Colyseus server with two clients.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, act, World, Content, DEFAULT_MAP } from './helpers.js';
import { Action, AttackAction, MoveAction, DropAction, DebugGrantXpAction } from '../src/sim/actions.js';
import { takeSnapshot, applySnapshot } from '../src/sim/snapshot.js';
import { Game } from '../server/game.js';
import { WorldStore } from '../server/world_store.js';
import { Skills } from '../src/sim/skills.js';

const item = (id) => Content.item(id);
const wire = (data) => JSON.parse(JSON.stringify(data));

test('malformed actions from a client are turned away', () => {
  assert.equal(Action.fromJSON(null), null);
  assert.equal(Action.fromJSON({ type: 'fly', seq: 1 }), null);
  assert.equal(Action.fromJSON({ type: 'constructor', seq: 1 }), null);
  assert.equal(Action.fromJSON({ type: 'move', seq: 1 }), null);
  assert.equal(Action.fromJSON({ type: 'move', seq: 1, target: { x: 'a', y: 2 } }), null);
  assert.equal(Action.fromJSON({ type: 'attack', seq: 1, target_id: 1.5 }), null);
  assert.equal(Action.fromJSON({ type: 'set_run', seq: 1, run: 'yes' }), null);
  assert.equal(Action.fromJSON({ type: 'unequip', seq: 1, equip_slot: '__proto__' }), null);
  assert.equal(Action.fromJSON({ type: 'withdraw', seq: 1, item_id: 'constructor!', count: 1 }), null);
  // Only declared fields come through; extras are dropped.
  const move = Action.fromJSON({ type: 'move', seq: 3, target: { x: 4, y: 5, z: 9 }, apply: 1, slot: 'x' });
  assert.ok(move instanceof MoveAction);
  assert.deepEqual(move.target, { x: 4, y: 5 });
  assert.equal(move.slot(), 'move');
  assert.equal(move.seq, 3);
});

test('an action that throws is skipped and the tick carries on', () => {
  const { world, player } = makeWorld();
  const bad = new MoveAction({ x: 1, y: 1 });
  bad.apply = () => {
    throw new Error('boom');
  };
  const error = console.error;
  console.error = () => {};
  try {
    act(world, player, bad);
  } finally {
    console.error = error;
  }
  assert.equal(world.tick, 1);
});

test('removing a player stops hits and fights involving them', () => {
  const { world, player } = makeWorld(3, { x: 22, y: 22 });
  const sentry = world.npcSpawnedAt({ x: 23, y: 22 });
  player.xp.melee = Skills.xpForLevel(30);
  act(world, player, new AttackAction(sentry.id));
  for (let i = 0; i < 6; i++) world.runTick();
  world.removePlayer(player.id);
  assert.ok(!world.entities.has(player.id));
  assert.ok(world.pending_hits.every((h) => h.target_id !== player.id && h.attacker_id !== player.id));
  assert.ok(!(sentry.task && sentry.task.target_id === player.id));
  for (let i = 0; i < 5; i++) world.runTick();
});

test('a mirror fed snapshots matches the server world', () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(5);
  const me = world.spawnPlayer('Ann');
  const other = world.spawnPlayer('Bo');
  me.weapon = item('scrap_blade');
  me.armor.head = item('scrap_helmet');
  me.inventory.add(item('scrap_metal'), 3);
  me.storage.deposit(item('scrap_metal'), 7);
  other.inventory.add(item('scrap_metal'), 2);
  const mirror = new World(DEFAULT_MAP);
  const sync = () => applySnapshot(mirror, wire(takeSnapshot(world, me.id)), me.id);
  sync();

  // Fight the nearest NPC, drop things, die, and have someone leave.
  const npc = [...world.entities.values()].find((e) => e.isNpc());
  me.teleport({ x: npc.tile.x - 1, y: npc.tile.y });
  me.xp.melee = Skills.xpForLevel(40);
  act(world, me, new AttackAction(npc.id), new DropAction(0));
  for (let i = 0; i < 40; i++) {
    if (me.hp < 5) me.hp = me.maxHp();
    world.runTick();
    sync();
  }
  world.kill(other, null);
  for (let i = 0; i < World.DYING_TICKS; i++) {
    world.runTick();
    sync();
  }
  const otherWreck = [...world.wrecks.values()].find((w) => w.owner_id === other.id);
  assert.ok(otherWreck);
  world.kill(me, null);
  for (let i = 0; i < World.DYING_TICKS; i++) {
    world.runTick();
    sync();
  }
  world.removePlayer(other.id);
  world.runTick();
  sync();

  const expected = takeSnapshot(world, me.id);
  const got = takeSnapshot(mirror, me.id);
  expected.events = got.events = [];
  assert.deepEqual(wire(got), wire(expected));
  assert.ok(!mirror.entities.has(other.id));
  // Only your own wreck is sent.
  assert.ok(!mirror.wrecks.has(otherWreck.id));
  assert.equal([...mirror.wrecks.values()].length, 1);
});

test("snapshots keep other players' inventories and messages private", () => {
  const { world, player } = makeWorld();
  const other = world.spawnPlayer('Bo');
  other.inventory.add(item('scrap_metal'), 2);
  world.message(other.id, 'secret');
  world.emitEvent(other.id, 'hit', { target: other.id, damage: 1 });
  const snap = takeSnapshot(world, player.id);
  const seen = snap.entities.find((e) => e.id === other.id);
  assert.equal(seen.inventory, undefined);
  assert.equal(seen.storage, undefined);
  assert.deepEqual(snap.events.map((e) => e.type), ['hit']);
});

test('the game: join, leave and come back as the same pilot', () => {
  const game = new Game({ map: World.defaultMap });
  const ann = game.join('Ann');
  const bo = game.join(' Bo ');
  assert.equal(bo.display_name, 'Bo');
  assert.throws(() => game.join('ann'), /already playing/);
  assert.throws(() => game.join(''), /Pick a name/);
  assert.throws(() => game.join('a'.repeat(20)), /at most/);
  assert.throws(() => game.join('<b>'), /letters/);
  ann.inventory.add(item('scrap_metal'), 5);
  ann.teleport({ x: 3, y: 3 });
  game.leave(ann.id);
  assert.ok(!game.world.entities.has(ann.id));
  // A newcomer doesn't take Ann's id, so her wreck stays hers.
  const cy = game.join('Cy');
  assert.notEqual(cy.id, ann.id);
  const back = game.join('ANN');
  assert.equal(back.id, ann.id);
  assert.equal(back.inventory.countOf(item('scrap_metal')), 5);
  assert.deepEqual(back.tile, { x: 3, y: 3 });
  assert.equal(back.display_name, 'ANN');
});

test('the game refuses debug actions unless debug is on, and acts for the sender only', () => {
  const game = new Game({ map: World.defaultMap });
  const ann = game.join('Ann');
  const bo = game.join('Bo');
  const xp = new DebugGrantXpAction('melee', 1000).toJSON();
  assert.match(game.submit(ann.id, xp), /off/);
  assert.equal(game.submit(99, new MoveAction({ x: 1, y: 1 }).toJSON()), 'You are not in the game.');
  const before = bo.xp.melee || 0;
  game.debug = true;
  assert.equal(game.submit(ann.id, xp), '');
  game.loop.runTick();
  assert.equal(ann.xp.melee, before + 1000);
  assert.equal(bo.xp.melee || 0, before);
});

test('the server save survives a restart, with everyone logged out until they rejoin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mechscape-'));
  try {
    const store = new WorldStore(join(dir, 'world.json'));
    const game = new Game({ store, map: World.defaultMap });
    const ann = game.join('Ann');
    const bo = game.join('Bo');
    ann.inventory.add(item('scrap_metal'), 4);
    bo.inventory.add(item('scrap_metal'), 1);
    game.world.kill(bo, null);
    for (let i = 0; i < World.DYING_TICKS; i++) game.loop.runTick();
    const wreckId = [...game.world.wrecks.keys()][0];
    game.leave(ann.id);
    for (let i = 0; i < 100; i++) game.loop.runTick();
    assert.equal(game.lastSavedTick, 100);

    const again = new Game({ store, map: World.defaultMap });
    assert.equal(again.world.tick, 100);
    assert.equal(again.world.players().length, 0);
    const bo2 = again.join('Bo');
    assert.equal(again.world.wrecks.get(wreckId).owner_id, bo2.id);
    assert.equal(again.join('Ann').inventory.countOf(item('scrap_metal')), 4);
    // A fresh world ignores the save.
    assert.equal(new Game({ store, fresh: true, map: World.defaultMap }).world.tick, 0);
    // A broken save is moved aside and the backup is used.
    again.save();
    writeFileSync(join(dir, 'world.json'), '{ broken');
    const error = console.error;
    console.error = () => {};
    try {
      assert.equal(new Game({ store, map: World.defaultMap }).world.tick, 100);
    } finally {
      console.error = error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real server: two clients see each other and their actions', async () => {
  const { startServer } = await import('../server/index.js');
  const { Client } = await import('@colyseus/sdk');
  World.defaultMap = DEFAULT_MAP;
  const server = await startServer({ port: 0, savePath: null, quiet: true });
  const url = `http://localhost:${server.port}`;
  const connect = async (name) => {
    const room = await new Client(url).join('scrapyard', { name });
    const client = { room, ticks: [], notices: [] };
    client.welcome = new Promise((resolve) => room.onMessage('welcome', resolve));
    room.onMessage('tick', (snap) => client.ticks.push(snap));
    room.onMessage('notice', (n) => client.notices.push(n.text));
    return client;
  };
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out');
  };
  try {
    const ann = await connect('Ann');
    const bo = await connect('Bo');
    const annId = (await ann.welcome).id;
    const boId = (await bo.welcome).id;
    assert.notEqual(annId, boId);
    await assert.rejects(new Client(url).join('scrapyard', { name: 'ann' }), /already playing/);

    // Ann walks; Bo's snapshots show her moving.
    const start = server.game.world.entities.get(annId).tile;
    const target = { x: start.x, y: start.y - 3 };
    ann.room.send('action', { ...new MoveAction(target).toJSON(), seq: 1 });
    await waitFor(() => bo.ticks.some((s) => {
      const e = s.entities.find((x) => x.id === annId);
      return e && e.tile.x === target.x && e.tile.y === target.y;
    }));
    // Bo never sees Ann's inventory; Ann sees her own and her action's seq.
    const last = ann.ticks.at(-1).entities.find((x) => x.id === annId);
    assert.equal(last.seq, 1);
    assert.equal(bo.ticks.at(-1).entities.find((x) => x.id === annId).inventory, undefined);
    // Debug actions are refused with a notice.
    bo.room.send('action', new DebugGrantXpAction('melee', 50).toJSON());
    await waitFor(() => bo.notices.length);
    // Ann leaves for good: she's gone from Bo's world.
    await ann.room.leave();
    await waitFor(() => !bo.ticks.at(-1).entities.some((x) => x.id === annId));
    await bo.room.leave();
  } finally {
    await server.close();
  }
});
