// Movement and combat geometry the client and server must agree on. The
// server simulates with these; the client uses them to predict its own
// character and to grey out abilities that would fail.

import { confine } from './arena.js';
import { ENEMY_KINDS } from './enemies.js';

/** Running speed, units per second. Backpedalling is slower, as in WoW. */
export const RUN_SPEED = 7;
export const BACK_SPEED = 4.5;

/** The global cooldown most abilities trigger, in seconds. */
export const GCD = 1.5;

export const RAIDER_RADIUS = 0.5;

/** Melee abilities reach this far past the edge of their target. */
export const MELEE_RANGE = 2.5;

/** Tab only picks enemies this close. */
export const TAB_RANGE = 40;

/** The unit vector a unit with [facing] looks along. Facing 0 looks down -z. */
export function forwardOf(facing) {
  return { x: -Math.sin(facing), z: -Math.cos(facing) };
}

/** The facing that looks from [from] toward [to]. */
export function facingToward(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A unit's body radius: an enemy's from its kind, otherwise a raider's. */
export function radiusOf(unit) {
  return ENEMY_KINDS[unit.kind]?.radius ?? RAIDER_RADIUS;
}

/** How far [target]'s edge is from [caster]'s center: what ability ranges measure. */
export function reach(caster, target) {
  return Math.max(0, distance(caster, target) - radiusOf(target));
}

/** True if [target] is in front of [unit] (anywhere in its front half). */
export function isFacing(unit, target) {
  const f = forwardOf(unit.facing);
  return f.x * (target.x - unit.x) + f.z * (target.z - unit.z) >= -1e-6;
}

/**
 * Where a raider at [pos] ends up after [dt] seconds of [input]
 * ({ forward, strafe }, each -1, 0 or 1) while looking along [facing].
 */
export function stepMovement(pos, facing, input, dt) {
  const { forward, strafe } = input;
  if (!forward && !strafe) return { x: pos.x, z: pos.z };
  const f = forwardOf(facing);
  // Right is forward turned a quarter clockwise (seen from above).
  let dx = f.x * forward + -f.z * strafe;
  let dz = f.z * forward + f.x * strafe;
  const len = Math.hypot(dx, dz);
  const speed = forward < 0 ? BACK_SPEED : RUN_SPEED;
  dx = (dx / len) * speed * dt;
  dz = (dz / len) * speed * dt;
  return confine(pos.x + dx, pos.z + dz, RAIDER_RADIUS);
}

export function isMoving(input) {
  return !!(input?.forward || input?.strafe);
}
