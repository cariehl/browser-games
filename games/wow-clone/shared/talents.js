// Talent trees: three per class. A raider spends TALENT_POINTS when they
// first spawn in a raid, and can't act until they have. Going deeper in a
// tree takes points in it: each tier needs TIER_POINTS more in the tiers
// above. The last tier of each tree is a capstone that grants an ability.
//
// A talent's effects apply once per rank:
//   { power, tag, value }      +value damage and healing for abilities with [tag]
//   { crit, tag, value }       +value crit chance for abilities with [tag]
//   { cooldown, ability, value }    -value seconds of cooldown
//   { castTime, ability, value }    -value seconds of cast time
//   { auraDuration, ability, value } +value seconds on its buff or debuff
//   { health, value }          +value max health (a fraction)
//   { threat, value }          +value threat (a fraction)
//   { damageTaken, value }     -value damage taken (a fraction)
//   { grant, ability }         adds the ability to the action bar
// A tag is an ability id, a school (physical, holy, fire, frost, arcane),
// 'heal' for anything that heals, or 'all'. The server applies these; the
// client shows them in the talent picker and tooltips.

import { ABILITIES, CLASSES, CRIT_CHANCE } from './classes.js';

export const TALENT_POINTS = 10;
export const TIER_POINTS = 2;
export const TIERS = 4;

const t = (id, name, tier, ranks, desc, effects) => ({ id, name, tier, ranks, desc, effects });

export const TREES = {
  tank: [
    {
      id: 'protection', name: 'Protection', color: '#4a7bd1', blurb: 'Survive anything.',
      talents: [
        t('toughness', 'Toughness', 0, 3, '+4% maximum health per rank.', [{ type: 'health', value: 0.04 }]),
        t('improvedShieldWall', 'Improved Shield Wall', 0, 2, 'Shield Wall cooldown -5 sec per rank.', [{ type: 'cooldown', ability: 'shieldWall', value: 5 }]),
        t('defiance', 'Defiance', 1, 3, '+10% threat per rank.', [{ type: 'threat', value: 0.1 }]),
        t('anticipation', 'Anticipation', 2, 2, '-3% damage taken per rank.', [{ type: 'damageTaken', value: 0.03 }]),
        t('lastStand', 'Last Stand', 3, 1, 'Learn Last Stand: instantly heal yourself for 2000.', [{ type: 'grant', ability: 'lastStand' }]),
      ],
    },
    {
      id: 'arms', name: 'Arms', color: '#8c6b3f', blurb: 'Hit hard, hold threat with damage.',
      talents: [
        t('weaponMastery', 'Weapon Mastery', 0, 3, '+5% physical damage per rank.', [{ type: 'power', tag: 'physical', value: 0.05 }]),
        t('improvedStrike', 'Improved Strike', 0, 2, '+10% Strike crit chance per rank.', [{ type: 'crit', tag: 'strike', value: 0.1 }]),
        t('tacticalMastery', 'Tactical Mastery', 1, 2, 'Taunt cooldown -2 sec per rank.', [{ type: 'cooldown', ability: 'taunt', value: 2 }]),
        t('impale', 'Impale', 2, 3, '+3% crit chance per rank.', [{ type: 'crit', tag: 'all', value: 0.03 }]),
        t('mortalStrike', 'Mortal Strike', 3, 1, 'Learn Mortal Strike: a heavy melee strike.', [{ type: 'grant', ability: 'mortalStrike' }]),
      ],
    },
    {
      id: 'thunder', name: 'Thunder', color: '#6a7fa8', blurb: 'Tank packs of enemies.',
      talents: [
        t('thunderingBlows', 'Thundering Blows', 0, 3, '+15% Thunder Clap damage per rank.', [{ type: 'power', tag: 'thunderClap', value: 0.15 }]),
        t('improvedThunderClap', 'Improved Thunder Clap', 0, 2, 'Thunder Clap cooldown -1.5 sec per rank.', [{ type: 'cooldown', ability: 'thunderClap', value: 1.5 }]),
        t('shieldSpecialization', 'Shield Specialization', 1, 2, 'Shield Slam cooldown -1 sec per rank.', [{ type: 'cooldown', ability: 'shieldSlam', value: 1 }]),
        t('gatheringStorm', 'Gathering Storm', 2, 3, '+10% Shield Slam damage per rank.', [{ type: 'power', tag: 'shieldSlam', value: 0.1 }]),
        t('shockwave', 'Shockwave', 3, 1, 'Learn Shockwave: damage every enemy within 10 yards, with double threat.', [{ type: 'grant', ability: 'shockwave' }]),
      ],
    },
  ],
  healer: [
    {
      id: 'holy', name: 'Holy', color: '#f2e394', blurb: 'Big, efficient heals.',
      talents: [
        t('healingFocus', 'Healing Focus', 0, 3, '+4% healing per rank.', [{ type: 'power', tag: 'heal', value: 0.04 }]),
        t('improvedRenew', 'Improved Renew', 0, 2, 'Renew lasts 3 sec longer per rank (one more tick).', [{ type: 'auraDuration', ability: 'renew', value: 3 }]),
        t('divineFury', 'Divine Fury', 1, 2, 'Flash Heal cast time -0.25 sec per rank.', [{ type: 'castTime', ability: 'flashHeal', value: 0.25 }]),
        t('holySpecialization', 'Holy Specialization', 2, 3, '+4% heal crit chance per rank.', [{ type: 'crit', tag: 'heal', value: 0.04 }]),
        t('guardianSpirit', 'Guardian Spirit', 3, 1, 'Learn Guardian Spirit: an ally takes 60% less damage for 8 sec.', [{ type: 'grant', ability: 'guardianSpirit' }]),
      ],
    },
    {
      id: 'discipline', name: 'Discipline', color: '#e8d27a', blurb: 'Fast, instant healing.',
      talents: [
        t('mentalStrength', 'Mental Strength', 0, 3, '+4% maximum health per rank.', [{ type: 'health', value: 0.04 }]),
        t('improvedHolyWord', 'Improved Holy Word', 0, 2, 'Holy Word cooldown -4 sec per rank.', [{ type: 'cooldown', ability: 'holyWord', value: 4 }]),
        t('meditation', 'Meditation', 1, 3, '+10% Circle of Healing per rank.', [{ type: 'power', tag: 'circleOfHealing', value: 0.1 }]),
        t('innerFocus', 'Inner Focus', 2, 2, '+3% crit chance per rank.', [{ type: 'crit', tag: 'all', value: 0.03 }]),
        t('penance', 'Penance', 3, 1, 'Learn Penance: an instant heal on an 8 sec cooldown.', [{ type: 'grant', ability: 'penance' }]),
      ],
    },
    {
      id: 'retribution', name: 'Retribution', color: '#f0a040', blurb: 'Heal, and smite while you do.',
      talents: [
        t('searingLight', 'Searing Light', 0, 3, '+10% Smite damage per rank.', [{ type: 'power', tag: 'smite', value: 0.1 }]),
        t('improvedSmite', 'Improved Smite', 0, 2, 'Smite cast time -0.25 sec per rank.', [{ type: 'castTime', ability: 'smite', value: 0.25 }]),
        t('holyReach', 'Holy Reach', 1, 2, '+4% holy crit chance per rank.', [{ type: 'crit', tag: 'holy', value: 0.04 }]),
        t('blessedResilience', 'Blessed Resilience', 2, 2, '-3% damage taken per rank.', [{ type: 'damageTaken', value: 0.03 }]),
        t('holyFire', 'Holy Fire', 3, 1, 'Learn Holy Fire: burn an enemy, then again over 8 sec.', [{ type: 'grant', ability: 'holyFire' }]),
      ],
    },
  ],
  dps: [
    {
      id: 'fire', name: 'Fire', color: '#d1543f', blurb: 'Burst and big crits.',
      talents: [
        t('burningSoul', 'Burning Soul', 0, 3, '+5% fire damage per rank.', [{ type: 'power', tag: 'fire', value: 0.05 }]),
        t('improvedFireBlast', 'Improved Fire Blast', 0, 2, 'Fire Blast cooldown -1.5 sec per rank.', [{ type: 'cooldown', ability: 'fireBlast', value: 1.5 }]),
        t('kindling', 'Kindling', 1, 2, 'Firebolt cast time -0.25 sec per rank.', [{ type: 'castTime', ability: 'firebolt', value: 0.25 }]),
        t('criticalMass', 'Critical Mass', 2, 3, '+4% fire crit chance per rank.', [{ type: 'crit', tag: 'fire', value: 0.04 }]),
        t('pyroblast', 'Pyroblast', 3, 1, 'Learn Pyroblast: a huge fireball after a 3.5 sec cast.', [{ type: 'grant', ability: 'pyroblast' }]),
      ],
    },
    {
      id: 'frost', name: 'Frost', color: '#5fb4e8', blurb: 'A whole new kit of frost spells.',
      talents: [
        t('frostbolt', 'Frostbolt', 0, 1, 'Learn Frostbolt: a strong frost nuke.', [{ type: 'grant', ability: 'frostbolt' }]),
        t('iceArmor', 'Ice Armor', 0, 3, '+4% maximum health per rank.', [{ type: 'health', value: 0.04 }]),
        t('piercingIce', 'Piercing Ice', 1, 3, '+5% frost damage per rank.', [{ type: 'power', tag: 'frost', value: 0.05 }]),
        t('shatter', 'Shatter', 2, 2, '+5% frost crit chance per rank.', [{ type: 'crit', tag: 'frost', value: 0.05 }]),
        t('glacialSpike', 'Glacial Spike', 3, 1, 'Learn Glacial Spike: a massive frost nuke on a 12 sec cooldown.', [{ type: 'grant', ability: 'glacialSpike' }]),
      ],
    },
    {
      id: 'arcane', name: 'Arcane', color: '#9a5fd1', blurb: 'Cooldowns and instant casts.',
      talents: [
        t('arcaneFocus', 'Arcane Focus', 0, 3, '+5% arcane damage per rank.', [{ type: 'power', tag: 'arcane', value: 0.05 }]),
        t('arcaneMastery', 'Arcane Mastery', 0, 2, 'Arcane Power cooldown -10 sec per rank.', [{ type: 'cooldown', ability: 'arcanePower', value: 10 }]),
        t('improvedArcaneExplosion', 'Improved Arcane Explosion', 1, 2, '+15% Arcane Explosion damage per rank.', [{ type: 'power', tag: 'arcaneExplosion', value: 0.15 }]),
        t('arcanePotency', 'Arcane Potency', 2, 2, 'Arcane Power lasts 2.5 sec longer per rank.', [{ type: 'auraDuration', ability: 'arcanePower', value: 2.5 }]),
        t('arcaneBarrage', 'Arcane Barrage', 3, 1, 'Learn Arcane Barrage: an instant arcane volley every 4 sec.', [{ type: 'grant', ability: 'arcaneBarrage' }]),
      ],
    },
  ],
};

/** The talent with [id] in [role]'s trees and the index of its tree, or null. */
export function findTalent(role, id) {
  for (const [tree, spec] of (TREES[role] ?? []).entries()) {
    const talent = spec.talents.find((x) => x.id === id);
    if (talent) return { talent, tree };
  }
  return null;
}

/** Points spent in tree [tree] on tiers below [tier]. */
function pointsAbove(role, picks, tree, tier) {
  let sum = 0;
  for (const talent of TREES[role][tree].talents) if (talent.tier < tier) sum += picks[talent.id] ?? 0;
  return sum;
}

/**
 * Why [picks] ({ talentId: rank }) isn't a valid build for [role], or null.
 * [complete]: every point must be spent (true when choosing for real).
 */
export function talentProblem(role, picks, complete = true) {
  if (!TREES[role]) return 'Unknown class.';
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return 'Pick your talents.';
  let total = 0;
  for (const [id, rank] of Object.entries(picks)) {
    const found = findTalent(role, id);
    if (!found) return 'Unknown talent.';
    if (!Number.isInteger(rank) || rank < 0 || rank > found.talent.ranks) return `Bad rank for ${found.talent.name}.`;
    if (rank > 0 && pointsAbove(role, picks, found.tree, found.talent.tier) < found.talent.tier * TIER_POINTS) {
      return `${found.talent.name} needs ${found.talent.tier * TIER_POINTS} points above it in ${TREES[role][found.tree].name}.`;
    }
    total += rank;
  }
  if (total > TALENT_POINTS) return `Only ${TALENT_POINTS} points to spend.`;
  if (complete && total < TALENT_POINTS) return `Spend all ${TALENT_POINTS} points (${TALENT_POINTS - total} left).`;
  return null;
}

/** True if one more point can go into [id] on top of [picks]. */
export function canAddPoint(role, picks, id) {
  const found = findTalent(role, id);
  if (!found) return false;
  return !talentProblem(role, { ...picks, [id]: (picks[id] ?? 0) + 1 }, false);
}

/** True if a point can come out of [id] without breaking a deeper talent. */
export function canRemovePoint(role, picks, id) {
  if (!picks[id]) return false;
  return !talentProblem(role, { ...picks, [id]: picks[id] - 1 }, false);
}

export function pointsSpent(picks) {
  return Object.values(picks).reduce((a, b) => a + b, 0);
}

export function pointsInTree(role, picks, tree) {
  return pointsAbove(role, picks, tree, TIERS);
}

/**
 * A ready-made build for [role] centred on tree [tree]: down to its
 * capstone, then the rest into that tree and then the others.
 */
export function presetBuild(role, tree) {
  const picks = {};
  let left = TALENT_POINTS;
  const add = (talent) => {
    while (left > 0 && (picks[talent.id] ?? 0) < talent.ranks && canAddPoint(role, picks, talent.id)) {
      picks[talent.id] = (picks[talent.id] ?? 0) + 1;
      left--;
    }
  };
  const main = TREES[role][tree].talents;
  // Just enough in each tier to open the next, then the capstone.
  for (let tier = 0; tier < TIERS - 1; tier++) {
    for (const talent of main.filter((x) => x.tier === tier)) {
      while (left > 0 && pointsInTree(role, picks, tree) < (tier + 1) * TIER_POINTS && (picks[talent.id] ?? 0) < talent.ranks) {
        picks[talent.id] = (picks[talent.id] ?? 0) + 1;
        left--;
      }
    }
  }
  for (const talent of main.filter((x) => x.tier === TIERS - 1)) add(talent);
  for (const talent of main) add(talent);
  for (const [i, spec] of TREES[role].entries()) if (i !== tree) for (const talent of spec.talents) add(talent);
  return picks;
}

/** The tags an ability answers to (see the top of this file). */
function tagsOf(abilityId) {
  const ability = ABILITIES[abilityId];
  const tags = [abilityId, 'all'];
  if (ability?.school) tags.push(ability.school);
  if (ability?.heal || ability?.aura?.heal) tags.push('heal');
  if (abilityId === 'attack') tags.push('physical');
  return tags;
}

/** What [picks] add up to for a raider of [role]: the numbers combat reads. */
export function talentStats(role, picks = {}) {
  const stats = { power: {}, crit: {}, cooldown: {}, castTime: {}, auraDuration: {}, health: 0, threat: 0, damageTaken: 0, grants: [] };
  for (const [id, rank] of Object.entries(picks)) {
    const found = findTalent(role, id);
    if (!found || !rank) continue;
    for (const e of found.talent.effects) {
      if (e.type === 'grant') stats.grants.push(e.ability);
      else if (e.tag) stats[e.type][e.tag] = (stats[e.type][e.tag] ?? 0) + e.value * rank;
      else if (e.ability) stats[e.type][e.ability] = (stats[e.type][e.ability] ?? 0) + e.value * rank;
      else stats[e.type] += e.value * rank;
    }
  }
  return stats;
}

/** The damage and healing multiplier for [abilityId] ('attack' for auto-attack). */
export function powerFor(stats, abilityId) {
  return 1 + tagsOf(abilityId).reduce((sum, tag) => sum + (stats?.power[tag] ?? 0), 0);
}

export function critFor(stats, abilityId) {
  return CRIT_CHANCE + tagsOf(abilityId).reduce((sum, tag) => sum + (stats?.crit[tag] ?? 0), 0);
}

export function cooldownFor(stats, abilityId) {
  return Math.max(0, (ABILITIES[abilityId]?.cooldown ?? 0) - (stats?.cooldown[abilityId] ?? 0));
}

export function castTimeFor(stats, abilityId) {
  return Math.max(0, (ABILITIES[abilityId]?.cast ?? 0) - (stats?.castTime[abilityId] ?? 0));
}

export function auraDurationFor(stats, abilityId) {
  return (ABILITIES[abilityId]?.aura?.duration ?? 0) + (stats?.auraDuration[abilityId] ?? 0);
}

/** The action bar for [role] with [picks]: the class's abilities, then any granted. */
export function abilitiesOf(role, picks = {}) {
  return [...(CLASSES[role]?.abilities ?? []), ...talentStats(role, picks).grants];
}
