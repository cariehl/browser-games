// Multi-tick activities: gathering, crafting, fighting, walking to a
// station, picking things up. World calls process() once per tick, after
// movement; returning false ends the task.

import { Combat } from './combat.js';
import { Skills } from './skills.js';
import { StationKind } from './defs.js';
import { Features } from './features.js';

/**
 * What using a station of each kind does, for kinds that features add
 * (the gantry, the commission board, landmarks...): kind -> fn(world, entity, station).
 */
export const StationHandlers = Object.create(null);

export class Task {
  process(_world, _entity) {
    return false;
  }
}

/**
 * Fight a target: chase it until in reach, then attack whenever the cooldown
 * allows, until one of you dies or you do something else.
 */
export class AttackTask extends Task {
  constructor(targetId) {
    super();
    this.target_id = targetId;
    this._chasingTile = null;
  }

  process(world, entity) {
    const target = world.entities.get(this.target_id);
    if (!target || target.isDead() || target === entity) return false;
    // Players are only ever targets of fun weapons.
    if (!target.isNpc() && !entity.isNpc() && !(entity.weapon && entity.weapon.fun_effect)) return false;

    const p = Combat.profile(entity);
    entity.face_target = { ...target.tile };

    if (!Combat.canHit(world, entity.tile, target.tile, p.reach)) {
      const brain = entity.brain();
      if (brain && brain.holdsPosition(entity, target)) {
        entity.path = [];
        return true;
      }
      // Out of reach, or (ranged) no line of sight: close in. Re-plan when
      // the target has moved or we've stopped short.
      const moved = !this._chasingTile || this._chasingTile.x !== target.tile.x || this._chasingTile.y !== target.tile.y;
      if (!entity.isMoving() || moved) {
        this._chasingTile = { ...target.tile };
        entity.path = world.pathToAdjacentTile(entity.tile, target.tile, entity);
        if (entity.path.length === 0) {
          if (brain) brain.cannotReach(world, entity);
          else world.message(entity.id, "I can't reach that.");
          return false;
        }
      }
      return true;
    }

    entity.path = [];
    // next_attack_tick is the earliest strike; commit the tick before it.
    const strike = world.tick + Combat.WINDUP_TICKS;
    if (strike < entity.next_attack_tick) return true;
    if (p.ammo && !entity.inventory.remove(p.ammo, 1)) {
      world.message(entity.id, `You have no ${p.ammo.display_name.toLowerCase()}s left.`);
      return false;
    }
    entity.next_attack_tick = strike + p.speed;
    Combat.commit(world, entity, target, p, strike);
    return true;
  }
}

/**
 * Walk to a node, then attempt to gather from it every few ticks until the
 * node depletes, the inventory fills, or the player does something else.
 */
export class GatherTask extends Task {
  constructor(nodeId) {
    super();
    this.node_id = nodeId;
    this._started = false;
    this._nextAttempt = 0;
  }

  process(world, entity) {
    const node = world.nodes.get(this.node_id);
    if (!node) return false;
    if (!node.isAdjacent(entity.tile)) {
      if (entity.isMoving()) return true;
      world.message(entity.id, "I can't reach that.");
      return false;
    }
    const def = node.def;
    entity.face_target = { ...node.tile };

    if (node.isDepleted(world.tick)) {
      if (!this._started) world.message(entity.id, `There's nothing left to ${def.verb} here.`);
      return false;
    }
    if (!this._started) return this._start(world, entity, def);

    if (world.tick < this._nextAttempt) return true;
    // The inventory can fill up between attempts, so check before rolling.
    if (!this._hasRoom(entity, def)) {
      this._inventoryFull(world, entity, def);
      return false;
    }
    this._nextAttempt = world.tick + def.action_ticks;
    world.emitEvent(entity.id, 'gather_attempt', { node: node.id });

    if (world.rng.randf() >= def.successChance(entity.level(def.skill))) return true;

    let got = def.loot;
    if (def.rare_loot && world.rng.randf() < def.rare_chance) got = def.rare_loot;
    if (!entity.inventory.add(got)) {
      this._inventoryFull(world, entity, def);
      return false;
    }
    world.message(entity.id, `You ${def.verb} some ${got.display_name.toLowerCase()}.`);
    world.grantXp(entity, def.skill, def.xp);
    if (def.bonus_table && world.rng.randf() < def.bonus_chance) findBonus(world, entity, def.bonus_table);
    Features.call('onGather', world, entity, node);

    node.successes++;
    const capped = def.max_successes > 0 && node.successes >= def.max_successes;
    if (capped || world.rng.randf() < def.deplete_chance) {
      node.successes = 0;
      // Temporary nodes (husks) need a non-zero window so isDepleted() holds
      // until cleanup removes them at the end of this tick.
      node.respawn_tick = world.tick + Math.max(def.respawn_ticks, 1);
      world.message(entity.id, `The ${def.display_name.toLowerCase()} has been stripped bare.`);
      return false;
    }
    if (!this._hasRoom(entity, def)) {
      this._inventoryFull(world, entity, def);
      return false;
    }
    return true;
  }

  _start(world, entity, def) {
    if (entity.level(def.skill) < def.level_required) {
      world.message(entity.id, `You need ${Skills.withArticle(def.skill)} level of ${def.level_required} to ${def.verb} this.`);
      return false;
    }
    if (!this._hasRoom(entity, def)) {
      this._inventoryFull(world, entity, def);
      return false;
    }
    this._started = true;
    // First attempt comes after one full cycle, like OSRS.
    this._nextAttempt = world.tick + def.action_ticks;
    entity.activity = def.skill;
    world.message(entity.id, `You begin to ${def.verb} the ${def.display_name.toLowerCase()}.`);
    return true;
  }

  /** Room for whatever the next success might give. */
  _hasRoom(entity, def) {
    return def.possibleLoot().every((item) => entity.inventory.canAdd(item));
  }

  _inventoryFull(world, entity, def) {
    const loot = def.loot;
    if (loot.container) {
      const can = loot.container.display_name.toLowerCase();
      if (entity.inventory.countOf(loot) > 0) world.message(entity.id, `Your ${can}s are full.`);
      else world.message(entity.id, `You need an empty ${can} to ${def.verb} into. Press one at a metal press.`);
      return;
    }
    world.message(entity.id, `Your inventory is too full to hold any more ${loot.display_name.toLowerCase()}.`);
  }
}

/**
 * Make a recipe at a station, one batch every recipe.action_ticks, until the
 * requested amount is made, materials run out, or the player does something
 * else. A count of -1 means "All".
 */
export class CraftTask extends Task {
  constructor(stationId, recipe, count) {
    super();
    this.station_id = stationId;
    this.recipe = recipe;
    this.remaining = count;
    this._started = false;
    this._nextMake = 0;
  }

  process(world, entity) {
    const station = world.stations.get(this.station_id);
    const recipe = this.recipe;
    if (!station || !station.isAdjacent(entity.tile)) return false;
    entity.face_target = { ...station.tile };

    if (!this._started) {
      if (entity.level(recipe.skill) < recipe.level_required) {
        world.message(entity.id, `You need ${Skills.withArticle(recipe.skill)} level of ${recipe.level_required} to make ${a(recipe.displayName())}.`);
        return false;
      }
      if (!recipe.hasMaterials(entity.inventory)) {
        world.message(entity.id, `You don't have the materials to make ${a(recipe.displayName())}.`);
        return false;
      }
      this._started = true;
      this._nextMake = world.tick + recipe.action_ticks;
      entity.activity = recipe.skill;
      return true;
    }

    if (world.tick < this._nextMake) return true;
    this._nextMake = world.tick + recipe.action_ticks;

    if (!recipe.consume(entity.inventory)) return false;
    if (!entity.inventory.add(recipe.output, recipe.output_count)) {
      recipe.refund(entity.inventory);
      world.message(entity.id, 'Your inventory is too full to make that.');
      return false;
    }
    if (recipe.output_count > 1) world.message(entity.id, `You make ${recipe.output_count} ${plural(recipe.displayName())}.`);
    else world.message(entity.id, `You make ${a(recipe.displayName())}.`);
    world.grantXp(entity, recipe.skill, recipe.xp);

    if (this.remaining > 0) {
      this.remaining--;
      if (this.remaining === 0) return false;
    }
    if (!recipe.hasMaterials(entity.inventory)) {
      if (this.remaining > 0) world.message(entity.id, "You've run out of materials.");
      return false;
    }
    return true;
  }
}

/** Walk to a station, then tell the client to open its menu. */
export class StationTask extends Task {
  constructor(stationId) {
    super();
    this.station_id = stationId;
  }

  process(world, entity) {
    const station = world.stations.get(this.station_id);
    if (!station) return false;
    if (!station.isAdjacent(entity.tile)) {
      if (entity.isMoving()) return true;
      world.message(entity.id, "I can't reach that.");
      return false;
    }
    switch (station.def.kind) {
      case StationKind.STORAGE:
        world.emitEvent(entity.id, 'open_storage', { station: station.id });
        break;
      case StationKind.RESPAWN:
        world.message(entity.id, `The ${station.def.display_name.toLowerCase()} hums. If you die, you'll be printed here.`);
        world.emitEvent(entity.id, 'open_reconfigure', { station: station.id });
        break;
      case StationKind.PORTAL: {
        const link = world.linkAt(station.tile);
        if (!link) {
          world.message(entity.id, "It doesn't lead anywhere yet.");
          break;
        }
        world.travel(entity, link.to);
        world.message(entity.id, link.text || `You go through the ${station.def.display_name.toLowerCase()}.`);
        break;
      }
      default:
        if (StationHandlers[station.def.kind]) StationHandlers[station.def.kind](world, entity, station);
        else world.emitEvent(entity.id, 'open_station', { station: station.id });
    }
    return false;
  }
}

/** Walk onto a ground item's tile, then pick it up. */
export class TakeTask extends Task {
  constructor(groundId) {
    super();
    this.ground_id = groundId;
  }

  process(world, entity) {
    const ground = world.ground_items.get(this.ground_id);
    if (!ground) return false; // Someone else took it, or it despawned.
    if (entity.tile.x !== ground.tile.x || entity.tile.y !== ground.tile.y) return entity.isMoving();
    if (!entity.inventory.putStack(ground.item, ground.count)) {
      world.message(entity.id, "You don't have enough inventory space to hold that.");
      return false;
    }
    world.removeGroundItem(this.ground_id);
    return false;
  }
}

/** Walk to your wreck, then take everything that fits in one go. */
export class WreckTask extends Task {
  constructor(wreckId) {
    super();
    this.wreck_id = wreckId;
  }

  process(world, entity) {
    const wreck = world.wrecks.get(this.wreck_id);
    if (!wreck) return false;
    const onIt = wreck.tile.x === entity.tile.x && wreck.tile.y === entity.tile.y;
    if (!wreck.isAdjacent(entity.tile) && !onIt) {
      if (entity.isMoving()) return true;
      world.message(entity.id, "I can't reach that.");
      return false;
    }
    entity.face_target = { ...wreck.tile };
    const left = [];
    for (const stack of wreck.items) if (!entity.inventory.putStack(stack.item, stack.count)) left.push(stack);
    const took = wreck.items.length - left.length;
    wreck.items = left;
    if (wreck.isEmpty()) {
      world.removeObject(wreck.id);
      world.message(entity.id, 'You salvage everything from your wreck.');
    } else if (took > 0) {
      world.message(entity.id, 'You salvage what you can carry. The rest is still in your wreck.');
    } else {
      world.message(entity.id, "You don't have room to salvage anything.");
    }
    return false;
  }
}

/** A roll on a bonus loot table: into the pack if it fits, otherwise onto the ground at your feet. */
export function findBonus(world, entity, table) {
  const found = table.roll(world.rng);
  if (!found || !found.item) return;
  const { item, count } = found;
  const what = count > 1 ? `${count} ${plural(item.display_name)}` : a(item.display_name);
  if (entity.inventory.add(item, count)) {
    world.message(entity.id, `You also find ${what}.`);
  } else {
    world.dropItem(item, count, entity.tile);
    world.message(entity.id, `You also find ${what}, but it falls to the ground.`);
  }
  const rare = ['cosmetic', 'pet'].includes(item.kind);
  world.emitEvent(entity.id, 'found', { item: item.id, count, rare });
  if (rare) world.announce(`${entity.display_name} found ${a(item.display_name)}!`);
}

/** "a scrap blade" / "an alloy blade" */
export function a(name) {
  const lower = name.toLowerCase();
  return ('aeiou'.includes(lower[0]) ? 'an ' : 'a ') + lower;
}

/** "gas cartridge" -> "gas cartridges" */
export function plural(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('s') ? lower : lower + 's';
}
