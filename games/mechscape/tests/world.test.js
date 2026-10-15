// The game world: areas, heights, zones and the links between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, runUntil, World, DEFAULT_MAP } from './helpers.js';
import { InteractAction, MoveAction } from '../src/sim/actions.js';
import { takeSnapshot } from '../src/sim/snapshot.js';

const world0 = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(2);
  return world;
};
const station = (world, id) => [...world.stations.values()].find((s) => s.def.id === id);

test('the world is four areas in one coordinate space', () => {
  const world = world0();
  assert.deepEqual(world.areas.map((a) => a.id), ['scrapyard', 'undercroft', 'deadfields', 'quiet_reach']);
  assert.equal(world.areaAt(world.spawn_point).id, 'scrapyard');
  assert.ok(world.areaAt(station(world, 'blueprint_cache').tile).dark);
  // Between areas is solid void.
  assert.equal(world.areaAt({ x: 100, y: 5 }), null);
  assert.ok(!world.isWalkable({ x: 100, y: 5 }));
});

test('cliffs block walking and ramps join levels', () => {
  const world = world0();
  // The Pit is a level below the ground around it.
  const rim = { x: 60, y: 40 };
  const floor = { x: 60, y: 41 };
  assert.equal(world.heightAt(rim) - world.heightAt(floor), 1);
  assert.ok(!world.edgeOk(rim, floor));
  const path = world.findPath(rim, floor);
  assert.ok(path.length > 1, 'walks round to a ramp');
  let prev = rim;
  for (const t of path) {
    assert.ok(Math.abs(world.heightAt(t) - world.heightAt(prev)) <= 0.5, `no jump at ${t.x},${t.y}`);
    prev = t;
  }
  assert.ok(path.some((t) => world.heightAt(t) === 0.5));
  // The loader yard is a level up; its west gate is a ramp.
  assert.equal(world.heightAt({ x: 70, y: 10 }), 2);
  assert.equal(world.heightAt({ x: 66, y: 10 }), 1.5);
});

test('a hatch takes you down to the Undercroft and the ladder brings you back', () => {
  const world = world0();
  const hatch = station(world, 'undercroft_hatch');
  const player = world.spawn(1, { x: hatch.tile.x, y: hatch.tile.y + 1 });
  act(world, player, new InteractAction(hatch.id));
  assert.equal(world.areaAt(player.tile).id, 'undercroft');
  assert.ok(world.events.some((e) => e.type === 'teleport' && e.entity === player.id));
  const ladder = station(world, 'undercroft_ladder');
  act(world, player, new InteractAction(ladder.id));
  runUntil(world, () => world.areaAt(player.tile).id === 'scrapyard', 10);
  assert.equal(world.areaAt(player.tile).id, 'scrapyard');
});

test('snapshots only hold your own area', () => {
  const world = world0();
  const up = world.spawnPlayer('Up');
  const down = world.spawnPlayer('Down');
  down.teleport({ x: 5, y: 64 });
  world.runTick();
  const snap = takeSnapshot(world, up.id);
  const ids = new Set(snap.entities.map((e) => e.id));
  assert.ok(ids.has(up.id));
  assert.ok(!ids.has(down.id), 'a player in another area is left out');
  const warden = [...world.entities.values()].find((e) => e.isNpc() && e.def.id === 'undercroft_warden');
  assert.ok(!ids.has(warden.id));
  const below = new Set(takeSnapshot(world, down.id).entities.map((e) => e.id));
  assert.ok(below.has(warden.id) && !below.has(up.id));
});

test('NPCs keep out of safe zones and leave players in them alone', () => {
  const world = world0();
  assert.ok(world.inZone({ x: 9, y: 9 }, 'safe'));
  const player = world.spawn(1, { x: 9, y: 9 });
  const loader = [...world.entities.values()].find((e) => e.isNpc() && e.def.id === 'loader_mech');
  assert.equal(world.nearestPlayer({ x: 9, y: 17 }, 20), null);
  assert.deepEqual(world.findPath({ x: 9, y: 17 }, { x: 9, y: 9 }, loader), []);
  assert.ok(world.findPath({ x: 9, y: 17 }, { x: 9, y: 9 }, player).length > 0);
  // Walking out of the hab makes you fair game again.
  act(world, player, new MoveAction({ x: 9, y: 20 }));
  runUntil(world, () => player.tile.y === 20, 30);
  assert.equal(world.nearestPlayer({ x: 9, y: 22 }, 5), player);
});
