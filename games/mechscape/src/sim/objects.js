// Things placed on tiles that players use from a neighbouring tile (gather
// nodes, stations, wrecks), and items lying on the ground.

import { UP, DOWN, LEFT, RIGHT, add } from './grid.js';

export class WorldObject {
  constructor(id, tile) {
    this.id = id;
    this.tile = { ...tile };
  }

  displayName() {
    return '';
  }

  blocksMovement() {
    return false;
  }

  blocksSight() {
    return false;
  }

  /** Players use objects from one of the four tiles touching their sides. */
  isAdjacent(other) {
    return Math.abs(other.x - this.tile.x) + Math.abs(other.y - this.tile.y) === 1;
  }

  interactionTiles() {
    return [add(this.tile, UP), add(this.tile, DOWN), add(this.tile, LEFT), add(this.tile, RIGHT)];
  }
}

/** A resource node (a wreck to salvage, a vent to siphon, a plant, a husk). */
export class GatherNode extends WorldObject {
  constructor(id, def, tile) {
    super(id, tile);
    this.def = def;
    /** Depleted until the world tick reaches this. */
    this.respawn_tick = 0;
    /** Temporary nodes disappear at this tick (-1 = never). */
    this.expire_tick = -1;
    /** Successes since it last (re)appeared, for max_successes. */
    this.successes = 0;
  }

  displayName() {
    return this.def.display_name;
  }

  blocksMovement() {
    return this.def.blocks_movement;
  }

  blocksSight() {
    return this.def.blocks_sight;
  }

  isDepleted(tick) {
    return tick < this.respawn_tick;
  }

  /** Temporary nodes are gone once depleted or past their lifetime. */
  isGone(tick) {
    if (!this.def.temporary) return false;
    return this.isDepleted(tick) || (this.expire_tick >= 0 && tick >= this.expire_tick);
  }
}

/** A crafting station (or the storage locker, or the manufactory). */
export class Station extends WorldObject {
  constructor(id, def, tile) {
    super(id, tile);
    this.def = def;
  }

  displayName() {
    return this.def.display_name;
  }

  blocksMovement() {
    return this.def.blocks_movement;
  }

  blocksSight() {
    return this.def.blocks_sight;
  }
}

/**
 * What's left where a player died: everything they carried and wore, which
 * only they can salvage. Crumbles, contents and all, at expire_tick. Blocks
 * nothing.
 */
export class Wreck extends WorldObject {
  constructor(id, ownerId, tile, items, expireTick) {
    super(id, tile);
    this.owner_id = ownerId;
    this.items = items;
    this.expire_tick = expireTick;
  }

  displayName() {
    return 'Your wreck';
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

/** An item lying on a tile. Anyone can take it until it despawns. */
export class GroundItem {
  constructor(id, item, count, tile, despawnTick) {
    this.id = id;
    this.item = item;
    this.count = count;
    this.tile = { ...tile };
    this.despawn_tick = despawnTick;
  }
}

/** A committed attack that hasn't landed yet (see Combat.commit). */
export class PendingHit {
  constructor(attackerId, targetId, damage, impactTick) {
    this.attacker_id = attackerId;
    this.target_id = targetId;
    this.damage = damage;
    this.impact_tick = impactTick;
    /** A fun weapon's effect ('paint', 'confetti') instead of damage, or ''. */
    this.fun = '';
  }
}
