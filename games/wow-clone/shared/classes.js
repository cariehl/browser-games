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
//   school     physical, holy, fire, frost or arcane: what talents boost
//   icon       two letters for the action button; color its background
//
// Talents (shared/talents.js) change some of these numbers per raider and
// grant the abilities marked "talent".

import { MELEE_RANGE } from './combat.js';

export const ABILITIES = {
  // Guardian (tank): holds threat and soaks hits.
  strike: {
    name: 'Strike', icon: 'St', color: '#8c6b3f', target: 'enemy', range: MELEE_RANGE, school: 'physical',
    damage: [110, 130],
    desc: 'A quick weapon strike.',
  },
  shieldSlam: {
    name: 'Shield Slam', icon: 'SS', color: '#4a7bd1', target: 'enemy', range: MELEE_RANGE, cooldown: 6, school: 'physical',
    damage: [220, 260], threat: 1.5,
    desc: 'Slams the target with your shield. Causes extra threat.',
  },
  thunderClap: {
    name: 'Thunder Clap', icon: 'TC', color: '#6a7fa8', target: 'enemiesAround', radius: 8, cooldown: 6, school: 'physical',
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
    name: 'Smite', icon: 'Sm', color: '#d9b84a', target: 'enemy', range: 30, cast: 1.5, school: 'holy',
    damage: [150, 170],
    desc: 'Smites the target with holy light.',
  },
  flashHeal: {
    name: 'Flash Heal', icon: 'FH', color: '#3fbf6a', target: 'friendly', range: 40, cast: 1.5, school: 'holy',
    heal: [450, 500],
    desc: 'Heals a friendly target.',
  },
  renew: {
    name: 'Renew', icon: 'Re', color: '#62d98c', target: 'friendly', range: 40, school: 'holy',
    aura: { duration: 12, every: 3, heal: 120 },
    desc: 'Heals a friendly target every 3 seconds for 12 seconds.',
  },
  holyWord: {
    name: 'Holy Word', icon: 'HW', color: '#f2e394', target: 'friendly', range: 40, cooldown: 20, school: 'holy',
    heal: [1100, 1200],
    desc: 'Instantly heals a friendly target for a large amount.',
  },
  circleOfHealing: {
    name: 'Circle of Healing', icon: 'CH', color: '#8fe0a8', target: 'alliesAround', radius: 15, cooldown: 10, school: 'holy',
    heal: [250, 300],
    desc: 'Heals every raider within 15 yards of you, including you.',
  },

  // Sorcerer (DPS): deals the damage.
  firebolt: {
    name: 'Firebolt', icon: 'FB', color: '#d1543f', target: 'enemy', range: 35, cast: 2, school: 'fire',
    damage: [400, 440],
    desc: 'Hurls a bolt of fire.',
  },
  fireBlast: {
    name: 'Fire Blast', icon: 'Bl', color: '#e8833a', target: 'enemy', range: 30, cooldown: 8, school: 'fire',
    damage: [260, 300],
    desc: 'Instantly blasts the target with fire.',
  },
  ignite: {
    name: 'Ignite', icon: 'Ig', color: '#a8321f', target: 'enemy', range: 35, school: 'fire',
    aura: { duration: 12, every: 2, damage: 70 },
    desc: 'Burns the target every 2 seconds for 12 seconds.',
  },
  arcaneExplosion: {
    name: 'Arcane Explosion', icon: 'AE', color: '#9a5fd1', target: 'enemiesAround', radius: 8, school: 'arcane',
    damage: [140, 160],
    desc: 'Damages every enemy within 8 yards.',
  },
  arcanePower: {
    name: 'Arcane Power', icon: 'AP', color: '#c27fe8', target: 'self', cooldown: 45, gcd: false, school: 'arcane',
    aura: { duration: 10, damageDone: 1.3 },
    desc: 'Increases your damage by 30% for 10 seconds.',
  },

  // Granted by talents (the capstone of each tree, and Frostbolt).
  lastStand: {
    name: 'Last Stand', icon: 'LS', color: '#d1a03f', target: 'self', cooldown: 60, gcd: false, talent: true,
    heal: [2000, 2000], school: 'physical',
    desc: 'Instantly heals you for 2000.',
  },
  mortalStrike: {
    name: 'Mortal Strike', icon: 'MS', color: '#7a2e26', target: 'enemy', range: MELEE_RANGE, cooldown: 6, talent: true,
    damage: [380, 420], school: 'physical',
    desc: 'A vicious strike for heavy damage.',
  },
  shockwave: {
    name: 'Shockwave', icon: 'Sw', color: '#5f86c9', target: 'enemiesAround', radius: 10, cooldown: 15, talent: true,
    damage: [250, 300], threat: 2, school: 'physical',
    desc: 'Damages every enemy within 10 yards, with double threat.',
  },
  guardianSpirit: {
    name: 'Guardian Spirit', icon: 'GS', color: '#bfe7ff', target: 'friendly', range: 40, cooldown: 60, gcd: false, talent: true,
    aura: { duration: 8, damageTaken: 0.4 }, school: 'holy',
    desc: 'Reduces the damage a friendly target takes by 60% for 8 seconds.',
  },
  penance: {
    name: 'Penance', icon: 'Pe', color: '#e8d27a', target: 'friendly', range: 40, cooldown: 8, talent: true,
    heal: [700, 760], school: 'holy',
    desc: 'Instantly heals a friendly target.',
  },
  holyFire: {
    name: 'Holy Fire', icon: 'HF', color: '#f0a040', target: 'enemy', range: 30, cast: 2, cooldown: 10, talent: true,
    damage: [300, 340], aura: { duration: 8, every: 2, damage: 50 }, school: 'holy',
    desc: 'Burns the target, then again every 2 seconds for 8 seconds.',
  },
  pyroblast: {
    name: 'Pyroblast', icon: 'Py', color: '#ff6a2a', target: 'enemy', range: 35, cast: 3.5, cooldown: 10, talent: true,
    damage: [900, 1000], school: 'fire',
    desc: 'A huge fireball after a long cast.',
  },
  frostbolt: {
    name: 'Frostbolt', icon: 'Fr', color: '#5fb4e8', target: 'enemy', range: 35, cast: 2.5, talent: true,
    damage: [480, 520], school: 'frost',
    desc: 'Launches a bolt of frost.',
  },
  glacialSpike: {
    name: 'Glacial Spike', icon: 'GS', color: '#a8e4ff', target: 'enemy', range: 35, cast: 3, cooldown: 12, talent: true,
    damage: [1100, 1200], school: 'frost',
    desc: 'Impales the target with a massive spike of ice.',
  },
  arcaneBarrage: {
    name: 'Arcane Barrage', icon: 'AB', color: '#b07fe8', target: 'enemy', range: 30, cooldown: 4, talent: true,
    damage: [330, 370], school: 'arcane',
    desc: 'Instantly fires a volley of arcane missiles.',
  },
};

/**
 *   maxHealth  starting and maximum health
 *   threat     multiplier on the threat their damage causes
 *   attack     auto-attack (right-click an enemy): a melee hit for a roll
 *              in [damage] every [swing] seconds while in range and facing
 *   abilities  in action bar order
 */
export const CLASSES = {
  tank: {
    name: 'Guardian', maxHealth: 7000, threat: 3,
    attack: { swing: 2, damage: [90, 110] },
    abilities: ['strike', 'shieldSlam', 'thunderClap', 'taunt', 'shieldWall'],
  },
  healer: {
    name: 'Cleric', maxHealth: 4500, threat: 1,
    attack: { swing: 2, damage: [30, 40] },
    abilities: ['smite', 'flashHeal', 'renew', 'holyWord', 'circleOfHealing'],
  },
  dps: {
    name: 'Sorcerer', maxHealth: 4500, threat: 1,
    attack: { swing: 2, damage: [30, 40] },
    abilities: ['firebolt', 'fireBlast', 'ignite', 'arcaneExplosion', 'arcanePower'],
  },
};

/** Healing causes this much threat per point healed, on every enemy fighting the healed raider. */
export const HEAL_THREAT = 0.5;

/** Chance of a critical hit or heal, which does 1.5x. */
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 1.5;

/** True for abilities whose aura is harmful (a debuff on an enemy). */
export function isHarmful(abilityId) {
  const target = ABILITIES[abilityId]?.target;
  return target === 'enemy' || target === 'enemiesAround';
}
