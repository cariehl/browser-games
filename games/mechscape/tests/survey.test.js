// The survey expedition: puzzles that open the Quiet Reach, and specimens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, World, Content, DEFAULT_MAP, runUntil } from './helpers.js';
import { InteractAction } from '../src/sim/actions.js';
import { Survey } from '../src/sim/survey.js';
import { SaveGame } from '../src/sim/save_game.js';
import { takeSnapshot, applySnapshot } from '../src/sim/snapshot.js';
import { fromKey } from '../src/sim/grid.js';

const item = (id) => Content.item(id);
const fresh = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(3);
  return world;
};
const stationOf = (world, id) => [...world.stations.values()].find((s) => s.def.id === id);
const tilesOf = (world, id) => [...world.terrainTiles()].filter(([, t]) => t.id === id).map(([k]) => fromKey(k));
function use(world, player, station) {
  player.teleport(station.interactionTiles().find((t) => world.isWalkable(t)));
  act(world, player, new InteractAction(station.id));
  runUntil(world, () => !player.task, 10);
}

test('the bridge winch takes scrap and mends the bridge for everyone', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const winch = stationOf(world, 'bridge_winch');
  const bridge = tilesOf(world, 'broken_bridge');
  assert.ok(bridge.length > 0);
  assert.ok(bridge.every((t) => !world.isWalkable(t)));
  use(world, ann, winch);
  assert.ok(!Survey.isOpen(world, 'broken_bridge'), 'no scrap, no bridge');
  ann.inventory.add(item('scrap_metal'), 5);
  use(world, ann, winch);
  assert.ok(Survey.isOpen(world, 'broken_bridge'));
  assert.equal(ann.inventory.countOf(item('scrap_metal')), 0);
  assert.ok(bridge.every((t) => world.isWalkable(t) && world.terrainAt(t).id === 'mended_bridge'));
  assert.ok((ann.xp.xenobiology || 0) > 0);
  // Using it again costs nothing.
  ann.inventory.add(item('scrap_metal'), 5);
  use(world, ann, winch);
  assert.equal(ann.inventory.countOf(item('scrap_metal')), 5);
});

test('the door valve wants vent gas, and the projector only a look', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const door = tilesOf(world, 'gas_door');
  ann.inventory.add(item('canister'));
  ann.inventory.add(item('vent_gas'), 10);
  use(world, ann, stationOf(world, 'gas_valve'));
  assert.ok(door.every((t) => world.isWalkable(t) && !world.terrainAt(t)));
  assert.equal(ann.inventory.countOf(item('vent_gas')), 0);
  const veil = tilesOf(world, 'holo_veil');
  use(world, ann, stationOf(world, 'veil_projector'));
  assert.ok(veil.every((t) => world.isWalkable(t)));
});

test('opened puzzles survive a save and reach clients', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  Survey.open(world, 'broken_bridge');
  Survey.open(world, 'gas_door');
  const loaded = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  assert.deepEqual(loaded.opened, ['broken_bridge', 'gas_door']);
  assert.equal(tilesOf(loaded, 'broken_bridge').length, 0);
  assert.ok(tilesOf(loaded, 'mended_bridge').length > 0);
  const mirror = fresh();
  applySnapshot(mirror, takeSnapshot(world, ann.id), ann.id);
  assert.deepEqual(mirror.opened, ['broken_bridge', 'gas_door']);
  assert.equal(tilesOf(mirror, 'gas_door').length, 0);
});

test('every kind of specimen grows in the Reach, and sampling one says so', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  for (const id of ['glowcap_cluster', 'skyfern_patch', 'ruin_orchid']) {
    assert.ok([...world.nodes.values()].some((n) => n.def.id === id && world.areaAt(n.tile).id === 'quiet_reach'), id);
  }
  const node = [...world.nodes.values()].find((n) => n.def.id === 'skyfern_patch');
  ann.teleport(node.interactionTiles().find((t) => world.isWalkable(t)));
  act(world, ann, new InteractAction(node.id));
  let sampled = false;
  runUntil(world, () => (sampled = sampled || world.events.some((e) => e.type === 'sampled' && e.entity === ann.id)), 200);
  assert.ok(sampled);
  assert.ok(ann.inventory.countOf(item('skyfern_specimen')) > 0);
});
