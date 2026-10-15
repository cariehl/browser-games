// Combat rules: attack profiles, hit chance, max hit, reach, and resolving
// one attack. Everything here runs inside the tick, server-side.
//
// Formulas (tune freely; they live only here):
//   attack roll  = (attack level + 8) * (accuracy + 64)
//   defence roll = (defence level + 8) * (defence bonus + 64)
//                  (players: Endurance level, and the armor they wear)
//   hit chance   = OSRS comparison of the two rolls
//   max hit      = 1 + floor((level + 5) * power / 60)
//   a successful hit deals 1..max hit; a failed one is a 0 (a blue splat)
//   XP           = 4 per damage to the weapon's skill (or Endurance), plus
//                  1.33 per damage to Toughness
//
// Timing: an attack is committed the tick before it strikes (see commit()).
// Damage, ammo and XP are settled then; the hit lands on the strike tick
// (see impact()) whatever either side does in between, so the wind-up can
// play before the hitsplat.

import { MELEE, ENDURANCE, TOUGHNESS } from './skills.js';
import { PendingHit } from './objects.js';
import { AttackTask } from './tasks.js';
import { Features } from './features.js';
import { Content } from './defs.js';

/** Ticks between committing an attack and its strike. */
export const WINDUP_TICKS = 1;

export const Combat = {
  WINDUP_TICKS,

  /** What an attacker swings with this tick. */
  profile(entity) {
    if (entity.isNpc()) {
      const def = entity.stats();
      return {
        skill: '', speed: def.attack_speed, reach: def.attack_range,
        attack_level: def.attack_level, accuracy: def.accuracy, max_hit: def.max_hit, ammo: null,
      };
    }
    const w = entity.weapon;
    const skill = w ? w.combatSkill : MELEE;
    const attackLevel = entity.effectiveLevel(skill);
    return {
      skill,
      speed: w ? w.attackSpeed : 4,
      reach: w ? w.attackRange : 1,
      accuracy: w ? w.accuracy : 0,
      ammo: w ? w.ammo : null,
      attack_level: attackLevel,
      max_hit: Combat.maxHit(attackLevel, w ? w.power : 0),
      fun: w ? w.fun_effect : '',
    };
  },

  hitChance(attackLevel, accuracy, defenceLevel, defenceBonus) {
    const a = (attackLevel + 8) * (accuracy + 64);
    const d = (defenceLevel + 8) * (defenceBonus + 64);
    if (a > d) return 1 - (d + 2) / (2 * (a + 1));
    return a / (2 * (d + 1));
  },

  maxHit(level, power) {
    return 1 + Math.floor((level + 5) * power / 60);
  },

  /** In reach, and for ranged attacks, with a clear line of sight? */
  canHit(world, from, to, reach) {
    if (!Combat.inReach(from, to, reach)) return false;
    // Melee can't reach up or down a cliff.
    if (reach <= 1) return world.edgeOk(from, to);
    return Combat.hasLineOfSight(world, from, to);
  },

  /**
   * Blocked by any tile with blocks_sight (walls, rocks, mech hulls; not
   * fences, drones or the weapons bench). Walks the tiles a straight line
   * passes between the two (both ends excluded).
   */
  hasLineOfSight(world, from, to) {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    // Ground higher than both ends (a ridge, a cliff seen from below) blocks the shot too.
    const top = Math.max(world.heightAt(from), world.heightAt(to)) + 0.5;
    const ridge = (t) => world.heightAt(t) > top;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = from.x + (to.x - from.x) * t;
      const py = from.y + (to.y - from.y) * t;
      // Check both roundings, so a line grazing a wall corner counts as blocked.
      if (world.blocksSight({ x: Math.floor(px), y: Math.floor(py) }) && world.blocksSight({ x: Math.ceil(px), y: Math.ceil(py) })) return false;
      const near = { x: godotRound(px), y: godotRound(py) };
      if (world.blocksSight(near) || ridge(near)) return false;
    }
    return true;
  },

  /**
   * Whether [attacker] can hit [target] from where they stand, measured
   * between the nearest tiles of their footprints (mechs are 2 × 2).
   */
  canHitEntity(world, attacker, target, reach) {
    const [from, to] = Combat.nearestTiles(attacker, target);
    // Standing inside something big: close enough for anything.
    if (from.x === to.x && from.y === to.y) return attacker.size > 1 || target.size > 1;
    return Combat.canHit(world, from, to, reach);
  },

  /** The closest tile of [a]'s footprint to [b]'s, and of [b]'s to [a]'s. */
  nearestTiles(a, b) {
    const pick = (a0, a1, b0, b1) => {
      if (a1 < b0) return [a1, b0];
      if (b1 < a0) return [a0, b1];
      const v = Math.max(a0, b0);
      return [v, v];
    };
    const sa = a.size || 1;
    const sb = b.size || 1;
    const [ax, bx] = pick(a.tile.x, a.tile.x + sa - 1, b.tile.x, b.tile.x + sb - 1);
    const [ay, by] = pick(a.tile.y, a.tile.y + sa - 1, b.tile.y, b.tile.y + sb - 1);
    return [{ x: ax, y: ay }, { x: bx, y: by }];
  },

  /** Melee (reach 1) needs a tile touching the target's side; ranged, within reach in any direction. */
  inReach(from, to, reach) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (reach <= 1) return Math.abs(dx) + Math.abs(dy) === 1;
    const c = Math.max(Math.abs(dx), Math.abs(dy));
    return c >= 1 && c <= reach;
  },

  /** [defence level, defence bonus] */
  defence(entity) {
    if (entity.isNpc()) {
      const stats = entity.stats();
      return [stats.defence_level, stats.defence_bonus];
    }
    return [entity.effectiveLevel(ENDURANCE), entity.armorBonus()];
  },

  /**
   * Commits one attack: rolls the damage and grants the XP now, and
   * schedules the hit to land on [strikeTick]. Ammo is spent by the caller.
   */
  commit(world, attacker, target, p, strikeTick) {
    if (p.fun) {
      // Fun weapons never hurt, never miss and never train anything.
      attacker.last_combat_tick = world.tick;
      world.emitEvent(attacker.id, 'attack', { attacker: attacker.id, target: target.id, strike_tick: strikeTick });
      const hit = new PendingHit(attacker.id, target.id, 0, strikeTick);
      hit.fun = p.fun;
      world.pending_hits.push(hit);
      return;
    }
    const [defLevel, defBonus] = Combat.defence(target);
    const chance = Combat.hitChance(p.attack_level, p.accuracy, defLevel, defBonus);
    let damage = 0;
    if (world.rng.randf() < chance) damage = world.rng.randiRange(1, p.max_hit);
    // Never more than the target has left once hits already on their way
    // land, so XP (granted now) is only ever for damage that will be dealt.
    damage = Math.min(damage, Combat.hpAfterPending(world, target));

    attacker.last_combat_tick = world.tick;
    world.emitEvent(attacker.id, 'attack', { attacker: attacker.id, target: target.id, strike_tick: strikeTick });
    if (damage > 0 && !attacker.isNpc()) {
      const skill = attacker.train_endurance ? ENDURANCE : p.skill;
      world.grantXp(attacker, skill, damage * 4);
      world.grantXp(attacker, TOUGHNESS, Math.round(damage * 4 / 3));
    }
    world.pending_hits.push(new PendingHit(attacker.id, target.id, damage, strikeTick));
  },

  /** HP [target] will have once every hit already committed against it lands. */
  hpAfterPending(world, target) {
    let hp = target.hp;
    for (const hit of world.pending_hits) if (hit.target_id === target.id) hp -= hit.damage;
    return Math.max(hp, 0);
  },

  /** Lands a committed hit: damage (the hitsplat), then death or retaliation. */
  impact(world, hit) {
    const target = world.entities.get(hit.target_id);
    if (!target || target.isDead()) return;
    const attacker = world.entities.get(hit.attacker_id) || null;
    if (hit.fun) {
      Combat.funHit(world, hit, target);
      return;
    }
    // Nobody gets hurt in a safe zone.
    const safe = !target.isNpc() && world.inZone(target.tile, 'safe');
    let damage = safe ? 0 : Math.min(hit.damage, target.hp);
    damage = Math.max(0, Math.min(Features.reduce('hitDamage', damage, world, attacker, target), target.hp));
    target.last_combat_tick = world.tick;
    if (attacker) attacker.last_combat_tick = world.tick;
    world.emitEvent(target.id, 'hit', { attacker: hit.attacker_id, target: target.id, damage });
    target.hp -= damage;
    if (target.isNpc() && damage > 0) {
      target.damage_by[hit.attacker_id] = (target.damage_by[hit.attacker_id] || 0) + damage;
    }
    if (target.hp <= 0) {
      world.kill(target, attacker);
      return;
    }
    if (attacker && !attacker.isDead()) Combat._retaliate(target, attacker);
  },

  /** A paintball or a confetti blade: no damage, no fight, just a mess. */
  funHit(world, hit, target) {
    const data = { attacker: hit.attacker_id, target: target.id, effect: hit.fun };
    if (hit.fun === 'paint') {
      const { paint_colors: colors, paint_ticks: ticks } = Content.rules.combat;
      const color = colors[world.rng.randiRange(0, colors.length - 1)];
      target.paint = { color, until: world.tick + ticks };
      data.color = color;
    }
    world.emitEvent(target.id, 'fun_hit', data);
  },

  /** Idle targets fight back: NPCs as their brain decides, players when they aren't busy. */
  _retaliate(target, attacker) {
    const brain = target.brain();
    if (brain) {
      brain.retaliate(target, attacker);
      return;
    }
    if (target.task != null || target.isMoving()) return;
    Combat.fightBack(target, attacker);
  },

  /** Starts fighting back, after a short reaction delay. */
  fightBack(target, attacker) {
    target.task = new AttackTask(attacker.id);
    target.next_attack_tick = Math.max(target.next_attack_tick, attacker.last_combat_tick + 1);
  },
};

/** Godot's roundi: halves away from zero. */
export function godotRound(v) {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}
