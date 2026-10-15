// What the server sends each client after every tick, and how the client
// applies it.
//
// A snapshot is the whole visible state as plain data: every entity, the
// gather nodes, ground items, the viewer's own wrecks, and the tick's events.
// The client keeps a mirror World built from the same map, and applies each
// snapshot onto it in place: things keep their ids and their objects, so
// views holding a reference keep working. The mirror never runs ticks.
//
// Some things are only sent to the player they belong to: their inventory,
// storage, wrecks, and their private events (messages, XP drops, menus).
//
// Full state every tick is simple and, for a few friends on one small map,
// small enough. Sending only what changed can come later without changing
// the mirror.

import { Content } from './defs.js';
import { ItemStack, Inventory, Storage } from './inventory.js';
import { NO_TARGET } from './grid.js';
import { Trading } from './trade.js';

/** Event types only the entity they belong to is told about. */
const PRIVATE_EVENTS = new Set(['message', 'xp', 'level_up', 'open_station', 'open_storage', 'wreck', 'boost',
  'trade_request', 'open_trade', 'close_trade', 'traded']);

/** Event types everyone hears about, wherever they are. */
const GLOBAL_EVENTS = new Set(['chat', 'broadcast']);

/**
 * The world as [viewerId] may see it: only the area they're in (other
 * players, NPCs, gather nodes, items on the ground and what happens there),
 * plus their own private parts.
 */
export function takeSnapshot(world, viewerId) {
  const viewer = world.entities.get(viewerId);
  const area = viewer ? world.areaIdAt(viewer.tile) : -1;
  const here = (tile) => area < 0 || world.areaIdAt(tile) === area;
  const entities = [];
  for (const e of world.entities.values()) {
    if (e.id !== viewerId && !here(e.tile) && !(e.isNpc() && e.isDead() && here(e.spawn_tile))) continue;
    const out = {
      id: e.id,
      tile: e.tile,
      path: e.path,
      steps: e.steps_this_tick,
      running: e.running,
      hp: e.hp,
      activity: e.activity,
      face: e.face_target,
      combat: e.last_combat_tick,
      boosts: e.boosts,
    };
    if (e.isNpc()) {
      out.dead_until = e.dead_until;
      out.husk_tile = e.husk_tile;
      // NPCs that aren't on the map (pets, a boss's adds) are built from their def.
      if (e.dynamic) {
        out.def = e.def.id;
        out.spawn = e.spawn_tile;
      }
    } else {
      out.name = e.display_name;
      out.xp = e.xp;
      out.weapon = e.weapon ? e.weapon.id : '';
      out.armor = Object.fromEntries(Object.entries(e.armor).map(([slot, item]) => [slot, item.id]));
      if (e.id === viewerId) {
        out.inventory = e.inventory.slots.map((s) => (s ? [s.item.id, s.count] : null));
        out.storage = e.storage.items().map((item) => [item.id, e.storage.countOf(item)]);
        out.train_endurance = e.train_endurance;
        out.seq = e.last_action_seq;
        out.next_use = e.next_use_tick;
        out.next_attack = e.next_attack_tick;
        out.trade = Trading.view(world, e);
      }
    }
    entities.push(out);
  }
  const nodes = [];
  for (const n of world.nodes.values()) {
    if (!here(n.tile)) continue;
    nodes.push({ id: n.id, def: n.def.id, tile: n.tile, respawn: n.respawn_tick, expire: n.expire_tick, successes: n.successes });
  }
  const wrecks = [];
  for (const w of world.wrecks.values()) {
    if (w.owner_id !== viewerId) continue;
    wrecks.push({ id: w.id, tile: w.tile, expire: w.expire_tick, items: w.items.map((s) => [s.item.id, s.count]) });
  }
  const ground = [];
  for (const g of world.ground_items.values()) {
    if (!here(g.tile)) continue;
    ground.push({ id: g.id, item: g.item.id, count: g.count, tile: g.tile, despawn: g.despawn_tick });
  }
  const events = world.events.filter((ev) => {
    if (ev.entity === viewerId || GLOBAL_EVENTS.has(ev.type)) return true;
    if (PRIVATE_EVENTS.has(ev.type)) return false;
    const who = world.entities.get(ev.entity);
    return !who || here(who.tile) || here(who.spawn_tile);
  });
  return { tick: world.tick, map: world.map_name, area, entities, nodes, wrecks, ground, events };
}

/**
 * Makes the mirror [world] match [snap]. [viewerId] is the player whose
 * snapshot this is (their wrecks are the only ones sent).
 */
export function applySnapshot(world, snap, viewerId) {
  world.tick = snap.tick;
  world.events = snap.events;

  const seen = new Set();
  for (const data of snap.entities) {
    seen.add(data.id);
    let e = world.entities.get(data.id);
    if (!e && data.def !== undefined) {
      const def = Content.npcs[data.def];
      if (!def) continue;
      e = world.addNpc(def, data.spawn || data.tile, data.id);
    }
    if (!e) {
      if (data.name === undefined) continue; // An NPC this map doesn't have: a different map build.
      e = world.spawn(data.id, data.tile);
    }
    e.tile = { ...data.tile };
    e.path = data.path.map((t) => ({ ...t }));
    e.steps_this_tick = data.steps.map((t) => ({ ...t }));
    e.running = data.running;
    e.hp = data.hp;
    e.activity = data.activity;
    e.face_target = data.face ? { ...data.face } : NO_TARGET;
    e.last_combat_tick = data.combat;
    e.boosts = data.boosts || {};
    if (e.isNpc()) {
      e.dead_until = data.dead_until;
      e.husk_tile = data.husk_tile ? { ...data.husk_tile } : NO_TARGET;
      continue;
    }
    e.display_name = data.name;
    e.xp = { ...data.xp };
    e.weapon = data.weapon ? Content.item(data.weapon) : null;
    const armor = {};
    for (const [slot, id] of Object.entries(data.armor)) {
      const item = Content.item(id);
      if (item) armor[slot] = item;
    }
    // Keep the same object while nothing changed, so views can compare cheaply.
    if (!sameArmor(e.armor, armor)) e.armor = armor;
    if (data.inventory) {
      if (!e.inventory) e.inventory = new Inventory();
      data.inventory.forEach((line, i) => {
        const item = line && Content.item(line[0]);
        if (i < Inventory.SIZE) e.inventory.slots[i] = item ? new ItemStack(item, line[1]) : null;
      });
      e.storage = new Storage();
      for (const [id, count] of data.storage) {
        const item = Content.item(id);
        if (item) e.storage.deposit(item, count);
      }
      e.train_endurance = data.train_endurance;
      e.last_action_seq = data.seq;
      e.next_use_tick = data.next_use;
      e.next_attack_tick = data.next_attack;
      e.trade_view = data.trade || null;
    }
  }
  // Players and NPCs that come and go (pets, adds) that weren't sent have gone, or are somewhere else.
  for (const e of [...world.entities.values()]) {
    if (seen.has(e.id)) continue;
    if (!e.isNpc()) world.removePlayer(e.id);
    else if (e.dynamic) world.removeNpc(e.id);
  }
  // Nodes and ground items elsewhere weren't sent; only what's in this area is complete.
  const here = (tile) => snap.area === undefined || snap.area < 0 || world.areaIdAt(tile) === snap.area;

  // Gather nodes: map nodes change state; husks come and go.
  const nodeIds = new Set();
  for (const data of snap.nodes) {
    nodeIds.add(data.id);
    let node = world.nodes.get(data.id);
    if (!node || node.def.id !== data.def) {
      const def = Content.nodeDef(data.def);
      if (!def) continue;
      if (node) world.removeObject(node.id);
      const there = world.objectAt(data.tile);
      if (there) world.removeObject(there.id);
      node = world.addNode(def, data.tile, data.id);
    }
    node.respawn_tick = data.respawn;
    node.expire_tick = data.expire;
    node.successes = data.successes;
  }
  for (const [id, node] of [...world.nodes]) if (!nodeIds.has(id) && here(node.tile)) world.removeObject(id);

  const wreckIds = new Set();
  for (const data of snap.wrecks) {
    wreckIds.add(data.id);
    const items = data.items.map(([id, count]) => new ItemStack(Content.item(id), count)).filter((s) => s.item);
    let wreck = world.wrecks.get(data.id);
    if (!wreck) wreck = world.addWreck(viewerId, data.tile, items, data.expire, data.id);
    wreck.items = items;
    wreck.expire_tick = data.expire;
  }
  for (const id of [...world.wrecks.keys()]) if (!wreckIds.has(id)) world.removeObject(id);

  const groundIds = new Set();
  for (const data of snap.ground) {
    groundIds.add(data.id);
    const item = Content.item(data.item);
    if (!item) continue;
    let ground = world.ground_items.get(data.id);
    if (!ground || ground.item !== item) {
      world.removeGroundItem(data.id);
      ground = world.dropItem(item, data.count, data.tile, data.despawn, data.id);
    }
    ground.count = data.count;
    ground.tile = { ...data.tile };
    ground.despawn_tick = data.despawn;
  }
  for (const [id, g] of [...world.ground_items]) if (!groundIds.has(id) && here(g.tile)) world.removeGroundItem(id);
}

function sameArmor(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}
