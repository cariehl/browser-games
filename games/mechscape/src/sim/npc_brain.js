// How an NPC behaves: respawning, picking fights, wandering, the leash,
// giving up and fighting back. World and AttackTask ask the brain instead of
// branching on NPC types, so a ranged NPC or a boss is a new brain (a
// subclass), not more branches.
//
// The leash is deliberately kitable: an NPC dragged past it walks home
// without healing, like OSRS. Only giving up because it can't reach its
// target heals it to full (no safespots).

import { NO_TARGET, eq } from './grid.js';
import { AttackTask } from './tasks.js';
import { Combat } from './combat.js';

/** Chance per idle tick that an NPC wanders somewhere. */
const WANDER_CHANCE = 0.08;

let standard = null;
/** Named brains (NpcDef.brain): name -> brain. */
const named = Object.create(null);

export class NpcBrain {
  /** The brain NPCs use when their def doesn't name one. */
  static standard() {
    if (!standard) standard = new NpcBrain();
    return standard;
  }

  /** Makes [brain] available to NPC defs as "brain": "[name]". */
  static register(name, brain) {
    named[name] = brain;
  }

  /** The brain for an NpcDef: its named one, or the standard brain. */
  static forDef(def) {
    return (def.brain && named[def.brain]) || NpcBrain.standard();
  }

  /** Once per tick, before anything moves: respawn when due, otherwise pick a fight or wander. */
  think(world, npc) {
    if (npc.isDead()) {
      this._waitToRespawn(world, npc);
      return;
    }
    if (npc.task != null) return;
    if (npc.def.aggressive) {
      const prey = world.nearestPlayer(npc.tile, npc.def.aggro_radius);
      if (prey) {
        npc.task = new AttackTask(prey.id);
        return;
      }
    }
    if (!npc.isMoving() && world.rng.randf() < WANDER_CHANCE) {
      const r = npc.def.wander_radius;
      const dest = {
        x: npc.spawn_tile.x + world.rng.randiRange(-r, r),
        y: npc.spawn_tile.y + world.rng.randiRange(-r, r),
      };
      if (world.isWalkable(dest)) npc.path = world.findPath(npc.tile, dest, npc);
    }
  }

  /** Just before its task runs. False drops the task: dragged past the leash, it walks home. */
  beforeTask(world, npc) {
    if (!(npc.task instanceof AttackTask)) return true;
    const target = world.entities.get(npc.task.target_id);
    if (!target || target.isDead()) return true;
    const away = Math.max(Math.abs(target.tile.x - npc.spawn_tile.x), Math.abs(target.tile.y - npc.spawn_tile.y));
    if (away > npc.def.leash_radius) {
      npc.path = world.findPath(npc.tile, npc.spawn_tile, npc);
      return false;
    }
    return true;
  }

  /**
   * Out of reach of [target]: true to hold still instead of stepping closer.
   * Two fighters chasing each other would otherwise shadow each other forever.
   */
  holdsPosition(npc, target) {
    return target.isMoving() && target.task instanceof AttackTask && target.task.target_id === npc.id;
  }

  /** Its target can't be reached: walk home and heal to full (no safespots). */
  cannotReach(world, npc) {
    npc.path = world.findPath(npc.tile, npc.spawn_tile, npc);
    npc.damage_by = {};
    if (npc.hp < npc.maxHp()) {
      npc.hp = npc.maxHp();
      world.emitEvent(npc.id, 'heal', { entity: npc.id });
    }
  }

  /** Hit by [attacker]: an idle NPC always fights back, stopping where it is. */
  retaliate(npc, attacker) {
    if (npc.task != null) return;
    npc.path = [];
    Combat.fightBack(npc, attacker);
  }

  /** The respawn countdown starts when its husk is gone. */
  _waitToRespawn(world, npc) {
    if (!eq(npc.husk_tile, NO_TARGET)) {
      const husk = world.nodeAt(npc.husk_tile);
      if (husk && husk.def === npc.def.husk) {
        npc.dead_until = world.tick + npc.def.respawn_ticks;
        return;
      }
      npc.husk_tile = NO_TARGET;
    }
    if (world.tick >= npc.dead_until) {
      npc.dead_until = -1;
      npc.hp = npc.maxHp();
      npc.damage_by = {};
      npc.teleport(npc.spawn_tile);
      npc.next_attack_tick = world.tick;
      world.emitEvent(npc.id, 'respawn', { entity: npc.id });
    }
  }
}
