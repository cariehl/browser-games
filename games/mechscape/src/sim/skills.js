// Skill ids and the experience curve. Uses RuneScape's curve: level 2 at 83
// XP, level 92 at about half of level 99, and 99 at 13,034,431 XP. Names,
// guide text and starting levels are in data/skills.json.

import { Content } from './defs.js';

export const SALVAGING = 'salvaging';
export const SIPHONING = 'siphoning';
/** Gathering alien plants (ventbloom). */
export const XENOBIOLOGY = 'xenobiology';
/** Manufacturing: weapons, armor and gear, at the weapons bench and metal press. */
export const ENGINEERING = 'engineering';
/** Manufacturing from living things: injectors at the bio-still. */
export const SPLICING = 'splicing';
export const MELEE = 'melee';
export const FIREARMS = 'firearms';
/** Hitpoints: max HP equals Toughness level. */
export const TOUGHNESS = 'toughness';
/** Defence: makes you harder to hit. */
export const ENDURANCE = 'endurance';

export const Skills = {
  SALVAGING, SIPHONING, XENOBIOLOGY, ENGINEERING, SPLICING, MELEE, FIREARMS, TOUGHNESS, ENDURANCE,
  /** Skills the prototype actually implements. */
  ALL: [MELEE, FIREARMS, TOUGHNESS, ENDURANCE, SALVAGING, SIPHONING, XENOBIOLOGY, ENGINEERING, SPLICING],
  /** Combat and combat-support skills. The economy's loop rule ignores these. */
  COMBAT: ['melee', 'unarmed', 'firearms', 'explosives', 'toughness', 'endurance', 'hunting'],
  MAX_LEVEL: 99,
  MAX_XP: 200000000,

  xpForLevel(level) {
    return XP_TABLE[Math.min(Math.max(level, 1), 99)];
  },

  levelForXp(xp) {
    let level = 1;
    while (level < 99 && xp >= XP_TABLE[level + 1]) level++;
    return level;
  },

  /** Its name from data/skills.json, or "some_skill" -> "Some Skill". */
  displayName(skill) {
    const def = Content.skills && Content.skills[skill];
    return def && def.display_name ? def.display_name : capitalize(skill);
  },

  /** The level every new character starts at (data/skills.json). */
  startingLevel(skill) {
    const def = Content.skills && Content.skills[skill];
    return def ? def.starting_level : 1;
  },

  /** "a Salvaging", "an Engineering", for messages. */
  withArticle(skill) {
    const name = capitalize(skill);
    return ('aeiou'.includes(name[0].toLowerCase()) ? 'an ' : 'a ') + name;
  },
};

const XP_TABLE = (() => {
  const table = new Array(100).fill(0);
  let points = 0;
  for (let level = 2; level <= 99; level++) {
    const n = level - 1;
    points += Math.floor(n + 300 * Math.pow(2, n / 7));
    table[level] = Math.floor(points / 4);
  }
  return table;
})();

/** Godot's String.capitalize: words split on _ and spaces, each capitalised. */
export function capitalize(text) {
  return String(text)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
