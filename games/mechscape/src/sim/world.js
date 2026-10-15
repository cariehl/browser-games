// The whole game state as plain data. No DOM, no rendering: this must run
// unchanged inside a headless Node server.

import { Grid, NO_TARGET, eq, key, UP, DOWN, LEFT, RIGHT, add } from './grid.js';
import { Rng } from './rng.js';
import { Skills, TOUGHNESS } from './skills.js';
import { MapData, MapKind } from './map_data.js';
import { EntityState, NpcState } from './entity.js';
import { GatherNode, Station, Wreck, GroundItem } from './objects.js';
import { Inventory, ItemStack } from './inventory.js';
import { Combat } from './combat.js';
import { AttackTask } from './tasks.js';
import { StationKind } from './defs.js';
import { TICK_SECONDS } from './constants.js';
import { Trading } from './trade.js';

export const DEFAULT_MAP = 'data/maps/scrapyard.map';
const USE_DEFAULT = '<default>';
const EMPTY_SIZE = { x: 32, y: 32 };

export class World {
  /** HP regenerates by 1 every this many ticks, outside combat. */
  static REGEN_TICKS = 10;
  /** Ground items despawn after this long (3 minutes, like OSRS). */
  static GROUND_ITEM_TICKS = 300;
  /** A husk lies where its NPC fell, or on the nearest free tile up to this far. */
  static HUSK_RADIUS = 2;
  static TICK_SECONDS = TICK_SECONDS;
  /** A player's wreck crumbles this long after they die (15 minutes). */
  static WRECK_TICKS = 1500;
  /** How far from where they fell a wreck may be placed, if the tile is taken. */
  static WRECK_RADIUS = 8;
  /** Players take ids from 1 up to this; NPC ids start above it. */
  static MAX_PLAYER_ID = 499;
  /** What new World() builds. Tests point this at their own fixed map. */
  static defaultMap = DEFAULT_MAP;

  /** [mapPath]: a registered .map path, '' for an empty field, or left out for World.defaultMap. */
  constructor(mapPath = USE_DEFAULT) {
    if (mapPath === USE_DEFAULT) mapPath = World.defaultMap;
    this.tick = 0;
    this.map_name = '';
    this.size = { ...EMPTY_SIZE };
    this.spawn_point = { x: 0, y: 0 };
    /** id -> EntityState (players and NpcStates) */
    this.entities = new Map();
    /** id -> GatherNode */
    this.nodes = new Map();
    /** id -> Station */
    this.stations = new Map();
    /** id -> Wreck */
    this.wrecks = new Map();
    /** id -> GroundItem */
    this.ground_items = new Map();
    /** Committed attacks waiting to land (see Combat.commit). */
    this.pending_hits = [];
    /** Open trades by id (see trade.js). Not saved. */
    this.trades = new Map();
    this._nextTradeId = 1;
    /** Everything that happened during the latest tick, for views: { entity, type, data } */
    this.events = [];
    this.rng = new Rng();
    /** Lines for everyone, shown at the start of the next tick (see announce()). */
    this._announcements = [];

    this._terrain = new Map(); // tile key -> TerrainDef
    this._objects = new Map(); // id -> WorldObject
    this._objectTiles = new Map(); // tile key -> WorldObject
    this._nextObjectId = 1000;
    this._nextGroundId = 1;
    this._nextNpcId = World.MAX_PLAYER_ID + 1;

    const map = mapPath !== '' ? MapData.loadFile(mapPath) : null;
    if (mapPath !== '' && !map) throw new Error(`Couldn't load map ${mapPath}`);
    this._setupGrid(map ? map.size : EMPTY_SIZE);
    if (map) this.loadMap(map);
  }

  _setupGrid(size) {
    this.size = { ...size };
    this._grid = new Grid(size.x, size.y);
  }

  /** Places everything in a parsed map, in its fixed order. */
  loadMap(map) {
    this.map_name = map.name;
    this.spawn_point = { ...map.spawn };
    for (const p of map.placements) {
      switch (p.kind) {
        case MapKind.TERRAIN: this.setTerrain(p.tile, p.def); break;
        case MapKind.NODE: this.addNode(p.def, p.tile); break;
        case MapKind.STATION: this.addStation(p.def, p.tile); break;
        case MapKind.NPC: this.spawnNpc(p.def, p.tile); break;
      }
    }
  }

  // --- Tick -------------------------------------------------------------

  /**
   * One game tick. The order is fixed so outcomes are deterministic.
   * [actions]: Map of entity id -> Map of slot -> Action, drained from the queue.
   */
  runTick(actions = new Map()) {
    this.tick++;
    this.events = [];
    for (const text of this._announcements) this.emitEvent(-1, 'broadcast', { text });
    this._announcements = [];

    // 1. Consume queued input, in the order the client sent it.
    for (const [id, bySlot] of actions) {
      const entity = this.entities.get(id);
      if (!entity) continue;
      const queued = [...bySlot.values()];
      const order = queued.map((_, i) => i).sort((a, b) => (queued[a].seq - queued[b].seq) || (a - b));
      for (const i of order) {
        const action = queued[i];
        try {
          if (entity.trade_id >= 0 && !action.keepsTrade()) {
            const trade = Trading.of(this, entity);
            if (trade) Trading.cancel(this, trade, 'The trade was called off.');
          }
          if (action.cancelsTask()) entity.clearTask();
          action.apply(this, entity);
        } catch (err) {
          // One player's bad input mustn't stop the world for everyone.
          console.error(`action ${action.constructor.TYPE} from ${id} failed:`, err);
        }
        entity.last_action_seq = Math.max(entity.last_action_seq, action.seq);
      }
    }

    Trading.check(this);

    // 2. NPC brains: respawns, aggression, idle wandering.
    for (const entity of this.entities.values()) {
      const brain = entity.brain();
      if (brain) brain.think(this, entity);
    }

    // 3. Movement.
    for (const entity of this.entities.values()) if (!entity.isDead()) entity.step();

    // 4. Ongoing tasks, after movement so arriving and acting share a tick.
    //    Hits committed last tick land first; damage and deaths resolve here.
    this._landHits();
    for (const entity of this.entities.values()) {
      if (entity.isDead() || entity.task == null) continue;
      const brain = entity.brain();
      if (brain && !brain.beforeTask(this, entity)) {
        entity.clearTask();
        continue;
      }
      if (!entity.task.process(this, entity)) entity.clearTask();
    }

    // 5. Regeneration, and boosts running out.
    for (const entity of this.entities.values()) {
      for (const skill of Object.keys(entity.boosts)) {
        if (this.tick >= entity.boosts[skill].until) {
          delete entity.boosts[skill];
          this.message(entity.id, `Your ${Skills.displayName(skill)} boost has worn off.`);
        }
      }
    }
    if (this.tick % World.REGEN_TICKS === 0) {
      for (const entity of this.entities.values()) {
        if (!entity.isDead() && !entity.inCombat(this.tick) && entity.hp < entity.maxHp()) entity.hp++;
      }
    }

    // 6. Clean up husks that were finished off or left too long, wrecks,
    //    and ground items nobody took.
    for (const node of [...this.nodes.values()]) if (node.isGone(this.tick)) this.removeObject(node.id);
    for (const wreck of [...this.wrecks.values()]) {
      if (this.tick >= wreck.expire_tick) {
        this.removeObject(wreck.id);
        this.message(wreck.owner_id, 'Your wreck has crumbled, and everything in it is gone.');
      }
    }
    for (const ground of [...this.ground_items.values()]) {
      if (this.tick >= ground.despawn_tick) this.ground_items.delete(ground.id);
    }
  }

  /** Lands every committed hit that's due; rescans after each, since one can kill. */
  _landHits() {
    let i = 0;
    while (i < this.pending_hits.length) {
      const hit = this.pending_hits[i];
      if (hit.impact_tick > this.tick) {
        i++;
        continue;
      }
      this.pending_hits.splice(i, 1);
      Combat.impact(this, hit);
      i = 0;
    }
  }

  // --- Events -----------------------------------------------------------

  emitEvent(entityId, type, data = {}) {
    this.events.push({ entity: entityId, type, data });
  }

  message(entityId, text) {
    this.emitEvent(entityId, 'message', { text });
  }

  /** A line everyone online sees in their chatbox (someone joined, a quest done). Sent with the next tick. */
  announce(text) {
    this._announcements.push(text);
  }

  grantXp(entity, skill, amount) {
    const before = entity.level(skill);
    entity.xp[skill] = Math.min((entity.xp[skill] || 0) + amount, Skills.MAX_XP);
    this.emitEvent(entity.id, 'xp', { skill, amount });
    const after = entity.level(skill);
    if (after > before) {
      if (skill === TOUGHNESS) entity.hp += after - before;
      this.emitEvent(entity.id, 'level_up', { skill, level: after });
      this.message(entity.id, `Congratulations, you've just advanced your ${Skills.displayName(skill)} level. You are now level ${after}.`);
    }
  }

  // --- Entities and objects ----------------------------------------------

  /** Adds a player with a given id (tests and save loading). */
  spawn(id, tile) {
    const entity = new EntityState(id, tile);
    this.entities.set(id, entity);
    return entity;
  }

  /** A new player at the map's spawn point, with the lowest free player id. */
  spawnPlayer(displayName) {
    for (let id = 1; id <= World.MAX_PLAYER_ID; id++) {
      if (!this.entities.has(id)) {
        const player = this.spawn(id, this.spawn_point);
        player.display_name = displayName;
        return player;
      }
    }
    return null;
  }

  /**
   * Takes a player out of the world (they logged out). Hits to or from them
   * miss and anyone fighting them stops. Their wreck stays and crumbles as
   * usual; ground items stay too.
   */
  removePlayer(id) {
    const player = this.entities.get(id);
    if (!player || player.isNpc()) return null;
    const trade = Trading.of(this, player);
    if (trade) Trading.cancel(this, trade, `${player.display_name} has left.`);
    this.entities.delete(id);
    this.pending_hits = this.pending_hits.filter((h) => h.target_id !== id && h.attacker_id !== id);
    for (const other of this.entities.values()) {
      if (other.task instanceof AttackTask && other.task.target_id === id) other.clearTask();
    }
    return player;
  }

  /** The living player closest to [tile] (Chebyshev) within [radius], ties to the lowest id. */
  nearestPlayer(tile, radius) {
    let best = null;
    let bestDistance = radius + 1;
    for (const player of this.players()) {
      if (player.isDead()) continue;
      const d = Math.max(Math.abs(player.tile.x - tile.x), Math.abs(player.tile.y - tile.y));
      if (d < bestDistance) {
        best = player;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Every player (not NPCs), lowest id first. */
  players() {
    return [...this.entities.values()].filter((e) => e.isPlayer()).sort((a, b) => a.id - b.id);
  }

  spawnNpc(def, tile) {
    const npc = new NpcState(this._nextNpcId++, def, tile);
    this.entities.set(npc.id, npc);
    return npc;
  }

  /** Puts an item on the ground. Ordinary stackables merge into a pile on that tile. */
  dropItem(item, count, tile, despawnTick = -1, id = -1) {
    const until = despawnTick >= 0 ? despawnTick : this.tick + World.GROUND_ITEM_TICKS;
    if (item.stackable && !item.container && id < 0) {
      for (const ground of this.ground_items.values()) {
        if (eq(ground.tile, tile) && ground.item === item) {
          ground.count += count;
          ground.despawn_tick = until;
          return ground;
        }
      }
    }
    if (id < 0 || this.ground_items.has(id)) id = this._nextGroundId;
    this._nextGroundId = Math.max(this._nextGroundId, id + 1);
    const ground = new GroundItem(id, item, count, tile, until);
    this.ground_items.set(id, ground);
    return ground;
  }

  removeGroundItem(id) {
    this.ground_items.delete(id);
  }

  /** Items on a tile, newest first (the one on top). */
  groundItemsAt(tile) {
    const out = [];
    for (const ground of this.ground_items.values()) if (eq(ground.tile, tile)) out.unshift(ground);
    return out;
  }

  npcSpawnedAt(tile) {
    for (const e of this.entities.values()) if (e.isNpc() && eq(e.spawn_tile, tile)) return e;
    return null;
  }

  /**
   * Kills an entity. NPCs leave a husk and respawn once it's gone. Players
   * drop everything into a wreck only they can salvage, and are printed at
   * the manufactory (the map's spawn point) with full HP.
   */
  kill(entity, killer) {
    entity.hp = 0;
    entity.clearTask();
    entity.path = [];
    const trade = Trading.of(this, entity);
    if (trade) Trading.cancel(this, trade, 'The trade was called off.');
    let huskTile = NO_TARGET;
    if (entity.isNpc() && entity.def.husk) huskTile = this.freeTileNear(entity.tile, World.HUSK_RADIUS);
    this.emitEvent(entity.id, 'death', { entity: entity.id, killer: killer ? killer.id : -1, husk_tile: huskTile });
    // Hits still on their way to it miss.
    this.pending_hits = this.pending_hits.filter((h) => h.target_id !== entity.id);
    // Anyone fighting it stops.
    for (const other of this.entities.values()) {
      if (other.task instanceof AttackTask && other.task.target_id === entity.id) other.clearTask();
    }
    if (entity.isNpc()) {
      const npc = entity;
      npc.dead_until = this.tick + npc.def.respawn_ticks;
      if (killer) this.message(killer.id, `The ${npc.def.display_name.toLowerCase()} collapses into a husk.`);
      for (const loot of npc.def.drops) {
        if (loot.item && this.rng.randf() < loot.chance) {
          this.dropItem(loot.item, this.rng.randiRange(loot.min_count, loot.max_count), npc.tile);
        }
      }
      if (!eq(huskTile, NO_TARGET)) {
        const husk = this.addNode(npc.def.husk, huskTile);
        npc.husk_tile = huskTile;
        if (npc.def.husk.lifetime_ticks > 0) husk.expire_tick = this.tick + npc.def.husk.lifetime_ticks;
      }
      return;
    }
    this.message(entity.id, 'Oh dear, you are dead!');
    const wreck = this._wreckBelongings(entity);
    entity.teleport(this.spawn_point);
    entity.hp = entity.maxHp();
    this.emitEvent(entity.id, 'printed', { entity: entity.id });
    if (wreck) {
      this.emitEvent(entity.id, 'wreck', { wreck: wreck.id, tile: wreck.tile });
      this.message(entity.id, `You're printed fresh at the manufactory. Your wreck lies near (${wreck.tile.x}, ${wreck.tile.y}). It will crumble in ${Math.round(World.WRECK_TICKS * TICK_SECONDS / 60)} minutes.`);
    } else {
      this.message(entity.id, "You're printed fresh at the manufactory.");
    }
  }

  /** Moves everything a dying player carries and wears into a new wreck. Null if nothing. */
  _wreckBelongings(player) {
    const items = [];
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = player.inventory.slots[i];
      if (stack) {
        items.push(stack);
        player.inventory.slots[i] = null;
      }
    }
    if (player.weapon) {
      items.push(new ItemStack(player.weapon));
      player.weapon = null;
    }
    for (const slot of Object.keys(player.armor)) items.push(new ItemStack(player.armor[slot]));
    player.armor = {};
    if (items.length === 0) return null;
    return this.addWreck(player.id, this.wreckTileNear(player.tile), items, this.tick + World.WRECK_TICKS);
  }

  /** The tile itself or the nearest free one; a wreck must never be lost. */
  wreckTileNear(tile) {
    for (const radius of [World.HUSK_RADIUS, World.WRECK_RADIUS, Math.max(this.size.x, this.size.y)]) {
      const found = this.freeTileNear(tile, radius);
      if (!eq(found, NO_TARGET)) return found;
    }
    return { ...tile };
  }

  addWreck(ownerId, tile, items, expireTick, id = -1) {
    if (id < 0 || this._objects.has(id)) id = this._takeObjectId();
    this._nextObjectId = Math.max(this._nextObjectId, id + 1);
    const wreck = new Wreck(id, ownerId, tile, items, expireTick);
    this.wrecks.set(id, wreck);
    this._placeObject(wreck);
    return wreck;
  }

  addNode(def, tile, id = -1) {
    if (id < 0 || this._objects.has(id)) id = this._takeObjectId();
    this._nextObjectId = Math.max(this._nextObjectId, id + 1);
    const node = new GatherNode(id, def, tile);
    this.nodes.set(id, node);
    this._placeObject(node);
    return node;
  }

  addStation(def, tile) {
    const station = new Station(this._takeObjectId(), def, tile);
    this.stations.set(station.id, station);
    this._placeObject(station);
    return station;
  }

  /** Whether [tile] is beside a storage locker. */
  storageInReach(tile) {
    for (const station of this.stations.values()) {
      if (station.def.kind === StationKind.STORAGE && station.isAdjacent(tile)) return true;
    }
    return false;
  }

  getObject(id) {
    return this._objects.get(id) || null;
  }

  objectAt(tile) {
    return this._objectTiles.get(key(tile)) || null;
  }

  nodeAt(tile) {
    const object = this.objectAt(tile);
    return object instanceof GatherNode ? object : null;
  }

  stationAt(tile) {
    const object = this.objectAt(tile);
    return object instanceof Station ? object : null;
  }

  _takeObjectId() {
    return this._nextObjectId++;
  }

  _placeObject(object) {
    const k = key(object.tile);
    if (this._objectTiles.has(k)) {
      console.warn(`Two objects on tile ${k}; the second replaces the first.`);
      this.removeObject(this._objectTiles.get(k).id);
    }
    this._objects.set(object.id, object);
    this._objectTiles.set(k, object);
    this._refreshTile(object.tile);
  }

  removeObject(id) {
    const object = this._objects.get(id);
    if (!object) return;
    this._objects.delete(id);
    this._objectTiles.delete(key(object.tile));
    this.nodes.delete(id);
    this.stations.delete(id);
    this.wrecks.delete(id);
    this._refreshTile(object.tile);
  }

  // --- Map --------------------------------------------------------------

  /**
   * [tile] if it's walkable with nothing on it, otherwise the nearest such
   * tile within [radius] (ring by ring, each ring row by row). NO_TARGET if none.
   */
  freeTileNear(tile, radius) {
    for (let r = 0; r <= radius; r++) {
      for (let y = tile.y - r; y <= tile.y + r; y++) {
        for (let x = tile.x - r; x <= tile.x + r; x++) {
          if (Math.max(Math.abs(x - tile.x), Math.abs(y - tile.y)) !== r) continue;
          const t = { x, y };
          if (this.isWalkable(t) && !this.objectAt(t)) return t;
        }
      }
    }
    return NO_TARGET;
  }

  /** Which area (map) a tile belongs to. One area until the world has several. */
  areaIdAt(_tile) {
    return 0;
  }

  inBounds(tile) {
    return this._grid.inBounds(tile);
  }

  isWalkable(tile) {
    return this.inBounds(tile) && !this._grid.isSolid(tile);
  }

  setTerrain(tile, def) {
    if (!this.inBounds(tile)) return;
    if (def) this._terrain.set(key(tile), def);
    else this._terrain.delete(key(tile));
    this._refreshTile(tile);
  }

  terrainAt(tile) {
    return this._terrain.get(key(tile)) || null;
  }

  /** Every terrain tile: Map of tile key -> TerrainDef. For drawing; don't modify. */
  terrainTiles() {
    return this._terrain;
  }

  /** Whether anything on the tile stops ranged attacks. */
  blocksSight(tile) {
    const terrain = this._terrain.get(key(tile));
    if (terrain && terrain.blocks_sight) return true;
    const object = this._objectTiles.get(key(tile));
    return object != null && object.blocksSight();
  }

  _refreshTile(tile) {
    if (!this.inBounds(tile)) return;
    const terrain = this._terrain.get(key(tile));
    const object = this._objectTiles.get(key(tile));
    this._grid.setSolid(tile, (terrain != null && terrain.blocks_movement) || (object != null && object.blocksMovement()));
  }

  /** Tiles to walk, excluding [from]. Empty if [to] can't be reached. */
  findPath(from, to) {
    if (!this.isWalkable(to) || eq(from, to)) return [];
    const path = this._grid.findPath(from, to);
    path.shift();
    return path;
  }

  /** Shortest path to any tile an object can be used from. */
  pathToAdjacent(from, object) {
    return this.pathToAdjacentTile(from, object.tile);
  }

  /** Shortest path to one of the four tiles touching [target]'s sides. */
  pathToAdjacentTile(from, target) {
    let best = [];
    for (const dir of [UP, DOWN, LEFT, RIGHT]) {
      const t = add(target, dir);
      if (!this.isWalkable(t) || eq(t, from)) continue;
      const path = this.findPath(from, t);
      if (path.length && (best.length === 0 || path.length < best.length)) best = path;
    }
    return best;
  }
}
