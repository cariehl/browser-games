import { loadContentFromDisk } from '../src/sim/load_node.js';
import { World, DEFAULT_MAP } from '../src/sim/world.js';
import { Content } from '../src/sim/defs.js';

loadContentFromDisk();
World.defaultMap = 'tests/maps/test_yard.map';

export { World, Content, DEFAULT_MAP };

/** A test-yard world with a fixed seed and one player at [tile] (default: spawn). */
export function makeWorld(seed = 1, tile = null) {
  const world = new World();
  world.rng.setSeed(seed);
  const player = tile ? world.spawn(1, tile) : world.spawnPlayer('Tester');
  return { world, player };
}

/** Runs one tick with [actions] from the player (applied in order). */
export function act(world, player, ...actions) {
  const bySlot = new Map();
  for (const action of actions) bySlot.set(action.slot(), action);
  world.runTick(new Map([[player.id, bySlot]]));
}

/** Runs ticks until [done] returns true (or [max] ticks pass). Returns the ticks run. */
export function runUntil(world, done, max = 2000) {
  for (let i = 1; i <= max; i++) {
    world.runTick();
    if (done()) return i;
  }
  return -1;
}

export function messages(world, entityId) {
  return world.events.filter((e) => e.entity === entityId && e.type === 'message').map((e) => e.data.text);
}

/** Kills [entity] and, for a pilot, waits out the fall until the manufactory reprints them. */
export function die(world, entity, killer = null) {
  world.kill(entity, killer);
  if (entity.isNpc()) return;
  for (let i = 0; i < World.DYING_TICKS && entity.isDead(); i++) world.runTick();
}
