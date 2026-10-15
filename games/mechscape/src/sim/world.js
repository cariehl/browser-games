// The whole game state as plain data. No DOM, no rendering: this must run
// unchanged inside a headless Node server.

import { Grid, NO_TARGET, eq, key, UP, DOWN, LEFT, RIGHT, add, MAX_STEP } from './grid.js';
import { Rng } from './rng.js';
import { Skills, TOUGHNESS } from './skills.js';
import { MapData, MapKind, loadLayout } from './map_data.js';
import { EntityState, NpcState } from './entity.js';
import { GatherNode, Station, Wreck, GroundItem } from './objects.js';
import { Inventory, ItemStack } from './inventory.js';
import { Combat } from './combat.js';
import { AttackTask } from './tasks.js';
import { StationKind } from './defs.js';
import { TICK_SECONDS } from './constants.js';
import { Trading } from './trade.js';

/** The game world: every area's map and how they connect (see data/maps/world.json). */
export const DEFAULT_MAP = 'data/maps/world.json';
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

  /**
   * [mapPath]: a registered world layout (.json) or single .map path, '' for
   * an empty field, or left out for World.defaultMap.
   */
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
    /**
     * The maps the world is made of, each placed at its own offset in one
     * coordinate space: { index, id, name, offset, size, dark, ground }.
     */
    this.areas = [];
    /** Props drawn on the map: { def, tile }. Static; never saved or sent. */
    this.decor = [];
    /** Hatches, lifts and gates: tile key of the station -> { to, text }. */
    this.links = new Map();
    /** Zone ids in use, each a bit in _zoneBits. */
    this.zoneIds = [];

    this._terrain = new Map(); // tile key -> TerrainDef
    this._objects = new Map(); // id -> WorldObject
    this._objectTiles = new Map(); // tile key -> WorldObject
    this._nextObjectId = 1000;
    this._nextGroundId = 1;
    this._nextNpcId = World.MAX_PLAYER_ID + 1;

    if (mapPath === '') {
      this._setupGrid(EMPTY_SIZE);
      this._addArea({ id: 'field', name: '' }, { x: 0, y: 0 }, EMPTY_SIZE, null);
      this._buildMasks();
      return;
    }
    const layout = mapPath.endsWith('.json') ? loadLayout(mapPath) : { areas: [{ id: 'main', map: mapPath, at: [0, 0] }] };
    if (!layout) throw new Error(`Couldn't load world ${mapPath}`);
    const maps = layout.areas.map((area) => {
      const map = MapData.loadFile(area.map);
      if (!map) throw new Error(`Couldn't load map ${area.map}`);
      return map;
    });
    const size = { x: 0, y: 0 };
    layout.areas.forEach((area, i) => {
      size.x = Math.max(size.x, area.at[0] + maps[i].size.x);
      size.y = Math.max(size.y, area.at[1] + maps[i].size.y);
    });
    this._setupGrid(size);
    let spawns = 0;
    layout.areas.forEach((area, i) => {
      const offset = { x: area.at[0], y: area.at[1] };
      this._addArea(area, offset, maps[i].size, maps[i]);
      if (maps[i].spawn) spawns++;
    });
    if (spawns !== 1) throw new Error(`${mapPath}: the world needs exactly one spawn tile (found ${spawns}).`);
    // Places things map by map, each in its fixed order.
    layout.areas.forEach((area, i) => this.loadMap(maps[i], this.areas[i].offset));
    this.map_name = layout.name || maps[0].name;
    for (const link of layout.links || []) {
      const from = this._areaTile(link.from);
      const to = this._areaTile(link.to);
      if (from && to) this.links.set(key(from), { to, text: link.text || '' });
    }
    this._buildMasks();
  }

  _setupGrid(size) {
    this.size = { ...size };
    this._grid = new Grid(size.x, size.y);
    /** Area index per tile; 255 is the void between areas (solid). */
    this._areaOf = new Uint8Array(size.x * size.y).fill(255);
    this._zoneBits = new Uint32Array(size.x * size.y);
    this._groundOf = new Array(size.x * size.y).fill(null);
    this._grid.solid.fill(1);
  }

  /** Marks out an area's tiles: which area they're in, their heights, ground and zones. */
  _addArea(entry, offset, size, map) {
    const index = this.areas.length;
    const area = {
      index, id: entry.id, name: entry.name || (map ? map.name : ''), offset: { ...offset }, size: { ...size },
      dark: !!entry.dark, ground: map ? map.defaultGround : null, music: entry.music || '',
    };
    this.areas.push(area);
    const w = this.size.x;
    for (let y = 0; y < size.y; y++) {
      for (let x = 0; x < size.x; x++) {
        const k = (y + offset.y) * w + x + offset.x;
        this._areaOf[k] = index;
        this._grid.solid[k] = 0;
        if (map) {
          this._grid.heights[k] = map.heights[y * size.x + x];
          this._groundOf[k] = map.ground[y * size.x + x];
        }
      }
    }
    for (const zone of entry.zones || []) this._markZone(zone, offset, { x: offset.x + size.x - 1, y: offset.y + size.y - 1 });
    if (map) {
      for (const zone of map.zones) this._markZone(zone.id, add(offset, zone.from), add(offset, zone.to));
      for (const d of map.decor) this.decor.push({ def: d.def, tile: add(offset, d.tile) });
    }
  }

  _markZone(id, from, to) {
    let bit = this.zoneIds.indexOf(id);
    if (bit < 0) {
      bit = this.zoneIds.length;
      this.zoneIds.push(id);
    }
    if (bit >= 32) throw new Error('Too many zone kinds (32 at most).');
    for (let y = from.y; y <= to.y; y++) {
      for (let x = from.x; x <= to.x; x++) this._zoneBits[y * this.size.x + x] |= 1 << bit;
    }
  }

  /** [areaId, x, y] (tile in that area's own coordinates) as a world tile, or null. */
  _areaTile(spec) {
    const area = this.areas.find((a) => a.id === spec[0]);
    if (!area) {
      console.error(`No area "${spec[0]}" in the layout.`);
      return null;
    }
    return { x: area.offset.x + spec[1], y: area.offset.y + spec[2] };
  }

  /** Path masks: NPCs keep out of safe zones; mechs stay in mech zones. */
  _buildMasks() {
    const n = this.size.x * this.size.y;
    this._npcMask = new Uint8Array(n);
    this._mechMask = new Uint8Array(n);
    const safe = this.zoneBit('safe');
    const mech = this.zoneBit('mech');
    for (let i = 0; i < n; i++) {
      if (safe && (this._zoneBits[i] & safe)) this._npcMask[i] = 1;
      if (!mech || !(this._zoneBits[i] & mech)) this._mechMask[i] = 1;
    }
  }

  /** Places everything in a parsed map, in its fixed order, shifted by [offset]. */
  loadMap(map, offset = { x: 0, y: 0 }) {
    if (!this.map_name) this.map_name = map.name;
    if (map.spawn) this.spawn_point = add(offset, map.spawn);
    for (const p of map.placements) {
      const tile = add(offset, p.tile);
      switch (p.kind) {
        case MapKind.TERRAIN: this.setTerrain(tile, p.def); break;
        case MapKind.NODE: this.addNode(p.def, tile); break;
        case MapKind.STATION: this.addStation(p.def, tile); break;
        case MapKind.NPC: this.spawnNpc(p.def, tile); break;
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
    const area = this.areaIdAt(tile);
    for (const player of this.players()) {
      if (player.isDead() || !player.canBeAttacked() || this.areaIdAt(player.tile) !== area || this.inZone(player.tile, 'safe')) continue;
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

  /**
   * An NPC that isn't part of the map (a pet, a boss's add): it comes and
   * goes, and isn't saved. [id]: the id to use (a mirror copying the server).
   */
  addNpc(def, tile, id = -1) {
    if (id < 0) id = this._nextNpcId++;
    else this._nextNpcId = Math.max(this._nextNpcId, id + 1);
    const npc = new NpcState(id, def, tile);
    npc.dynamic = true;
    this.entities.set(id, npc);
    return npc;
  }

  /** Takes a come-and-go NPC out of the world. Hits to or from it miss, and anyone fighting it stops. */
  removeNpc(id) {
    const npc = this.entities.get(id);
    if (!npc || !npc.isNpc()) return;
    this.entities.delete(id);
    this.pending_hits = this.pending_hits.filter((h) => h.target_id !== id && h.attacker_id !== id);
    for (const other of this.entities.values()) {
      if (other.task instanceof AttackTask && other.task.target_id === id) other.clearTask();
    }
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

  /** Moves [entity] at once to [tile] (or the nearest free tile to it): hatches, lifts and gates. */
  travel(entity, tile) {
    let to = this.freeTileNear(tile, 3);
    if (eq(to, NO_TARGET)) to = { ...tile };
    entity.clearTask();
    entity.teleport(to);
    this.emitEvent(entity.id, 'teleport', { entity: entity.id, tile: to });
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

  /** The area (map) a tile is in, or null in the void between areas. */
  areaAt(tile) {
    if (!this.inBounds(tile)) return null;
    const index = this._areaOf[tile.y * this.size.x + tile.x];
    return index === 255 ? null : this.areas[index];
  }

  /** The index of the area a tile is in, or -1. */
  areaIdAt(tile) {
    const area = this.areaAt(tile);
    return area ? area.index : -1;
  }

  /** The bit for zone [id] in the zone mask, or 0 if no tile has it. */
  zoneBit(id) {
    const bit = this.zoneIds.indexOf(id);
    return bit < 0 ? 0 : 1 << bit;
  }

  /** Whether [tile] is in a zone of kind [id] (safe, build, mech, arena...). */
  inZone(tile, id) {
    if (!this.inBounds(tile)) return false;
    const bit = this.zoneBit(id);
    return bit !== 0 && (this._zoneBits[tile.y * this.size.x + tile.x] & bit) !== 0;
  }

  /** Every zone id [tile] is in. */
  zonesAt(tile) {
    if (!this.inBounds(tile)) return [];
    const bits = this._zoneBits[tile.y * this.size.x + tile.x];
    return this.zoneIds.filter((_, i) => bits & (1 << i));
  }

  /** Ground level of a tile (see Grid). */
  heightAt(tile) {
    return this._grid.heightAt(tile);
  }

  /** What the ground of a tile looks like: its GroundDef, or its area's default (null for none). */
  groundAt(tile) {
    if (!this.inBounds(tile)) return null;
    const own = this._groundOf[tile.y * this.size.x + tile.x];
    if (own) return own;
    const area = this.areaAt(tile);
    return area ? area.ground : null;
  }

  /** Whether stepping between two touching tiles isn't up or down a cliff. */
  edgeOk(a, b) {
    return Math.abs(this.heightAt(a) - this.heightAt(b)) <= MAX_STEP;
  }

  /** Where the hatch, lift or gate on [tile] leads: { to, text }, or null. */
  linkAt(tile) {
    return this.links.get(key(tile)) || null;
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
    const outside = this._areaOf[tile.y * this.size.x + tile.x] === 255;
    this._grid.setSolid(tile, outside || (terrain != null && terrain.blocks_movement) || (object != null && object.blocksMovement()));
  }

  /** How [entity] may path: NPCs keep out of safe zones. */
  pathOptions(entity) {
    if (entity && entity.isNpc()) return { mask: this._npcMask };
    return {};
  }

  /** Tiles to walk, excluding [from]. Empty if [to] can't be reached. [entity]: who's walking (NPCs keep out of safe zones). */
  findPath(from, to, entity = null) {
    if (!this.isWalkable(to) || eq(from, to)) return [];
    const path = this._grid.findPath(from, to, this.pathOptions(entity));
    path.shift();
    return path;
  }

  /** Shortest path to any tile an object can be used from. */
  pathToAdjacent(from, object, entity = null) {
    return this.pathToAdjacentTile(from, object.tile, entity);
  }

  /** Shortest path to one of the four tiles touching [target]'s sides, without a cliff between. */
  pathToAdjacentTile(from, target, entity = null) {
    let best = [];
    for (const dir of [UP, DOWN, LEFT, RIGHT]) {
      const t = add(target, dir);
      if (!this.isWalkable(t) || eq(t, from) || !this.edgeOk(t, target)) continue;
      const path = this.findPath(from, t, entity);
      if (path.length && (best.length === 0 || path.length < best.length)) best = path;
    }
    return best;
  }
}
