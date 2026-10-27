// One class per role, and their abilities. The server applies these numbers;
// the client shows them on the action bar and in tooltips.
//
// An ability:
//   target     'enemy'          your hostile target
//              'friendly'       your friendly target, or yourself if you have none
//              'self'           yourself
//              'enemiesAround'  every living enemy within [radius] of you
//              'alliesAround'   every living raider within [radius] of you
//   range      how far it reaches past the target's edge
//   cast       cast time in seconds (0: instant). Moving cancels a cast.
//   cooldown   seconds before it can be used again, counted from when it lands
//   gcd        false if it ignores the global cooldown (default true)
//   damage     [min, max] rolled per hit; heal the same for healing
//   threat     extra threat multiplier on top of the class's
//   taunt      makes the target attack you
//   aura       a buff or debuff it applies: { duration, every (tick seconds),
//              damage / heal per tick, damageTaken / damageDone multipliers }
//   icon       two letters for the action button; color its background

import { MELEE_RANGE } from './combat.js';

export const ABILITIES = {
  // Guardian (tank): holds threat and soaks hits.
  strike: {
    name: 'Strike', icon: 'St', color: '#8c6b3f', target: 'enemy', range: MELEE_RANGE,
    damage: [110, 130],
    desc: 'A quick weapon strike.',
  },
  shieldSlam: {
    name: 'Shield Slam', icon: 'SS', color: '#4a7bd1', target: 'enemy', range: MELEE_RANGE, cooldown: 6,
    damage: [220, 260], threat: 1.5,
    desc: 'Slams the target with your shield. Causes extra threat.',
  },
  thunderClap: {
    name: 'Thunder Clap', icon: 'TC', color: '#6a7fa8', target: 'enemiesAround', radius: 8, cooldown: 6,
    damage: [80, 100],
    desc: 'Damages every enemy within 8 yards.',
  },
  taunt: {
    name: 'Taunt', icon: 'Ta', color: '#b03a2e', target: 'enemy', range: 25, cooldown: 8, gcd: false,
    taunt: true,
    desc: 'Forces the target to attack you and puts you at the top of its threat list.',
  },
  shieldWall: {
    name: 'Shield Wall', icon: 'SW', color: '#c9a227', target: 'self', cooldown: 30, gcd: false,
    aura: { duration: 8, damageTaken: 0.5 },
    desc: 'Halves the damage you take for 8 seconds.',
  },

  // Cleric (healer): keeps the group alive.
  smite: {
    name: 'Smite', icon: 'Sm', color: '#d9b84a', target: 'enemy', range: 30, cast: 1.5,
    damage: [150, 170],
    desc: 'Smites the target with holy light.',
  },
  flashHeal: {
    name: 'Flash Heal', icon: 'FH', color: '#3fbf6a', target: 'friendly', range: 40, cast: 1.5,
    heal: [450, 500],
    desc: 'Heals a friendly target.',
  },
  renew: {
    name: 'Renew', icon: 'Re', color: '#62d98c', target: 'friendly', range: 40,
    aura: { duration: 12, every: 3, heal: 120 },
    desc: 'Heals a friendly target every 3 seconds for 12 seconds.',
  },
  holyWord: {
    name: 'Holy Word', icon: 'HW', color: '#f2e394', target: 'friendly', range: 40, cooldown: 20,
    heal: [1100, 1200],
    desc: 'Instantly heals a friendly target for a large amount.',
  },
  circleOfHealing: {
    name: 'Circle of Healing', icon: 'CH', color: '#8fe0a8', target: 'alliesAround', radius: 15, cooldown: 10,
    heal: [250, 300],
    desc: 'Heals every raider within 15 yards of you, including you.',
  },

  // Sorcerer (DPS): deals the damage.
  firebolt: {
    name: 'Firebolt', icon: 'FB', color: '#d1543f', target: 'enemy', range: 35, cast: 2,
    damage: [400, 440],
    desc: 'Hurls a bolt of fire.',
  },
  fireBlast: {
    name: 'Fire Blast', icon: 'Bl', color: '#e8833a', target: 'enemy', range: 30, cooldown: 8,
    damage: [260, 300],
    desc: 'Instantly blasts the target with fire.',
  },
  ignite: {
    name: 'Ignite', icon: 'Ig', color: '#a8321f', target: 'enemy', range: 35,
    aura: { duration: 12, every: 2, damage: 70 },
    desc: 'Burns the target every 2 seconds for 12 seconds.',
  },
  arcaneExplosion: {
    name: 'Arcane Explosion', icon: 'AE', color: '#9a5fd1', target: 'enemiesAround', radius: 8,
    damage: [140, 160],
    desc: 'Damages every enemy within 8 yards.',
  },
  arcanePower: {
    name: 'Arcane Power', icon: 'AP', color: '#c27fe8', target: 'self', cooldown: 45, gcd: false,
    aura: { duration: 10, damageDone: 1.3 },
    desc: 'Increases your damage by 30% for 10 seconds.',
  },
};

/**
 *   maxHealth  starting and maximum health
 *   threat     multiplier on the threat their damage causes
 *   abilities  in action bar order
 */
export const CLASSES = {
  tank: {
    name: 'Guardian', maxHealth: 7000, threat: 3,
    abilities: ['strike', 'shieldSlam', 'thunderClap', 'taunt', 'shieldWall'],
  },
  healer: {
    name: 'Cleric', maxHealth: 4500, threat: 1,
    abilities: ['smite', 'flashHeal', 'renew', 'holyWord', 'circleOfHealing'],
  },
  dps: {
    name: 'Sorcerer', maxHealth: 4500, threat: 1,
    abilities: ['firebolt', 'fireBlast', 'ignite', 'arcaneExplosion', 'arcanePower'],
  },
};

/** Healing causes this much threat per point healed, on every enemy fighting the healed raider. */
export const HEAL_THREAT = 0.5;

/** Chance of a critical hit or heal, which does 1.5x. */
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 1.5;

/** True if a raider of [role] has [abilityId]. */
export function hasAbility(role, abilityId) {
  return CLASSES[role]?.abilities.includes(abilityId) ?? false;
}

/** True for abilities whose aura is harmful (a debuff on an enemy). */
export function isHarmful(abilityId) {
  const target = ABILITIES[abilityId]?.target;
  return target === 'enemy' || target === 'enemiesAround';
}
