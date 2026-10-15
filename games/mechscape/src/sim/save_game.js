// Turns the World into plain JSON-friendly data and back.
//
// What's saved: the tick, the random number generator's exact state, every
// entity (tile, path, HP, XP, inventory, weapon, armor, storage, combat and
// death timers), node depletion timers, husks, wrecks, ground items and hits
// in flight. Enough that a loaded world carries on exactly as the saved one
// would have.
//
// What isn't: in-progress tasks. Like logging out in OSRS, you come back
// standing still. The static map isn't saved either: World builds it from
// the map file, and map things are matched by tile (nodes) and spawn tile
// (NPCs), never by id, so editing the map doesn't scramble a save.
//
// Storage of the text (localStorage in the browser, a file or database on a
// server) is the caller's business.

import { World } from './world.js';
import { Content } from './defs.js';
import { ItemStack, Inventory } from './inventory.js';
import { PendingHit } from './objects.js';
import { NO_TARGET, eq } from './grid.js';
import { Features } from './features.js';

/** Version 1 is the first three.js save format; 2 adds the features' state (quests, the mech, the hab...). */
export const SAVE_VERSION = 2;

export const SaveGame = {
  VERSION: SAVE_VERSION,

  toDict(world) {
    const players = [];
    const npcs = [];
    for (const entity of world.entities.values()) {
      if (entity.isNpc() && entity.dynamic) continue; // Pets and adds come back from what spawned them.
      if (entity.isNpc()) {
        const npc = entityDict(entity);
        npc.def = entity.def.id;
        npc.dead_until = entity.dead_until;
        if (!eq(entity.husk_tile, NO_TARGET)) npc.husk_tile = entity.husk_tile;
        npcs.push(npc);
      } else {
        players.push(SaveGame.playerToDict(entity));
      }
    }
    const nodes = [];
    for (const node of world.nodes.values()) {
      const entry = { tile: node.tile, respawn_tick: node.respawn_tick, expire_tick: node.expire_tick, successes: node.successes };
      if (node.def.temporary) {
        // Husks aren't part of the map, so record what they are too.
        entry.def = node.def.id;
        entry.id = node.id;
      }
      nodes.push(entry);
    }
    return {
      version: SAVE_VERSION,
      tick: world.tick,
      rng_state: [...world.rng.state],
      next_object_id: world._nextObjectId,
      next_npc_id: world._nextNpcId,
      next_ground_id: world._nextGroundId,
      map: world.map_name,
      players,
      npcs,
      nodes,
      wrecks: [...world.wrecks.values()].map((w) => ({
        id: w.id, owner: w.owner_id, tile: w.tile, expire_tick: w.expire_tick,
        items: w.items.map((s) => ({ item: s.item.id, count: s.count })),
      })),
      ground_items: [...world.ground_items.values()].map((g) => ({
        id: g.id, item: g.item.id, count: g.count, tile: g.tile, despawn_tick: g.despawn_tick,
      })),
      pending_hits: world.pending_hits.map((h) => ({
        attacker: h.attacker_id, target: h.target_id, damage: h.damage, impact_tick: h.impact_tick, fun: h.fun || '',
      })),
      features: Features.collect('save', world),
    };
  },

  /** Builds a World from saved data. Throws if the data can't be used. */
  fromDict(data, mapPath = World.defaultMap) {
    if (typeof data !== 'object' || data == null || typeof data.version !== 'number') throw new Error('not a save');
    if (data.version > SAVE_VERSION) throw new Error(`made by a newer build (version ${data.version})`);
    const world = new World(mapPath);
    world.tick = data.tick;
    world.rng.state = [...data.rng_state];

    const bySavedId = new Map();
    const npcsBySpawn = new Map();
    for (const e of world.entities.values()) if (e.isNpc()) npcsBySpawn.set(`${e.spawn_tile.x},${e.spawn_tile.y}`, e);
    for (const entry of data.npcs) {
      const npc = npcsBySpawn.get(`${entry.spawn_tile.x},${entry.spawn_tile.y}`);
      if (!npc || (entry.def && npc.def.id !== entry.def)) continue; // That spawn no longer exists.
      applyEntity(npc, entry);
      bySavedId.set(entry.id, npc);
      npc.dead_until = entry.dead_until;
      if (entry.husk_tile) npc.husk_tile = { ...entry.husk_tile };
    }
    for (const entry of data.players) bySavedId.set(entry.id, SaveGame.playerFromDict(world, entry));

    world._nextObjectId = Math.max(world._nextObjectId, data.next_object_id);
    for (const entry of data.nodes) {
      let node = null;
      if (entry.def) {
        const def = Content.nodeDef(entry.def);
        if (def && !world.objectAt(entry.tile)) node = world.addNode(def, entry.tile, entry.id ?? -1);
      } else {
        node = world.nodeAt(entry.tile);
      }
      if (node) {
        node.respawn_tick = entry.respawn_tick;
        node.successes = entry.successes || 0;
        node.expire_tick = entry.expire_tick;
      }
    }
    world._nextNpcId = Math.max(world._nextNpcId, data.next_npc_id);

    for (const entry of data.wrecks || []) {
      const contents = [];
      for (const line of entry.items) {
        const item = Content.item(line.item);
        if (item) contents.push(new ItemStack(item, line.count));
      }
      world.addWreck(entry.owner, world.wreckTileNear(entry.tile), contents, entry.expire_tick, entry.id);
    }
    for (const entry of data.ground_items || []) {
      const item = Content.item(entry.item);
      if (item) world.dropItem(item, entry.count, entry.tile, entry.despawn_tick, entry.id);
    }
    world._nextGroundId = Math.max(world._nextGroundId, data.next_ground_id || 1);
    Features.feed('load', data.features, world);

    // A save from a different map: its tiles mean nothing here, so players
    // start over at this map's spawn, and hits in flight are dropped.
    if (data.map === world.map_name) {
      for (const entry of data.pending_hits || []) {
        const attacker = bySavedId.get(entry.attacker);
        const target = bySavedId.get(entry.target);
        if (attacker && target) {
          const hit = new PendingHit(attacker.id, target.id, entry.damage, entry.impact_tick);
          if (entry.fun) hit.fun = entry.fun;
          world.pending_hits.push(hit);
        }
      }
    } else {
      for (const e of world.entities.values()) {
        if (!e.isNpc()) {
          e.teleport(world.spawn_point);
          e.spawn_tile = { ...world.spawn_point };
        }
      }
    }
    return world;
  },

  /** One player as plain data (also how the server keeps a logged-out player). */
  playerToDict(entity) {
    const player = entityDict(entity);
    player.display_name = entity.display_name;
    player.inventory = entity.inventory.slots.map((s) => (s ? { item: s.item.id, count: s.count } : null));
    player.weapon = entity.weapon ? entity.weapon.id : '';
    player.armor = Object.fromEntries(Object.entries(entity.armor).map(([slot, item]) => [slot, item.id]));
    player.train_endurance = entity.train_endurance;
    player.storage = Object.fromEntries(entity.storage.items().map((item) => [item.id, entity.storage.countOf(item)]));
    player.f = Features.collect('savePlayer', entity);
    return player;
  },

  /** Adds a player from playerToDict() data to [world], with id [id] (default: the saved one). */
  playerFromDict(world, entry, id = entry.id) {
    const player = world.spawn(id, entry.tile);
    applyEntity(player, entry);
    // Saved somewhere that's no longer part of the map (an area moved): back to spawn.
    if (world.areaIdAt(player.tile) < 0) {
      player.teleport(world.spawn_point);
      player.spawn_tile = { ...world.spawn_point };
    }
    player.display_name = entry.display_name || '';
    player.inventory = new Inventory();
    entry.inventory.forEach((line, i) => {
      const item = line && Content.item(line.item);
      if (item && i < Inventory.SIZE) player.inventory.slots[i] = new ItemStack(item, line.count);
    });
    player.weapon = entry.weapon ? Content.item(entry.weapon) : null;
    for (const [slot, itemId] of Object.entries(entry.armor || {})) {
      const item = Content.item(itemId);
      if (item && item.isArmor()) player.armor[slot] = item;
    }
    player.train_endurance = !!entry.train_endurance;
    for (const [itemId, count] of Object.entries(entry.storage || {})) {
      const item = Content.item(itemId);
      if (item) player.storage.deposit(item, count);
    }
    Features.feed('loadPlayer', entry.f, world, player);
    return player;
  },

  toJSON(world) {
    return JSON.stringify(SaveGame.toDict(world), null, 1);
  },

  fromJSON(text, mapPath = World.defaultMap) {
    return SaveGame.fromDict(JSON.parse(text), mapPath);
  },
};

function entityDict(entity) {
  return {
    id: entity.id,
    tile: entity.tile,
    spawn_tile: entity.spawn_tile,
    path: entity.path,
    running: entity.running,
    hp: entity.hp,
    xp: { ...entity.xp },
    next_attack_tick: entity.next_attack_tick,
    last_combat_tick: entity.last_combat_tick,
    next_use_tick: entity.next_use_tick,
  };
}

function applyEntity(entity, entry) {
  entity.tile = { ...entry.tile };
  entity.spawn_tile = { ...entry.spawn_tile };
  entity.path = (entry.path || []).map((t) => ({ ...t }));
  entity.steps_this_tick = [{ ...entity.tile }];
  entity.running = !!entry.running;
  entity.hp = entry.hp;
  if (!entity.isNpc()) entity.xp = { ...entry.xp };
  entity.next_attack_tick = entry.next_attack_tick;
  entity.last_combat_tick = entry.last_combat_tick;
  entity.next_use_tick = entry.next_use_tick || 0;
}
