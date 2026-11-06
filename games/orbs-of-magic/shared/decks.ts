import { CARDS } from './cards';
import type { Color } from './types';

export interface DeckDef {
  id: string;
  name: string;
  archetype: string;
  colors: Color[];
  blurb: string;
  howToPlay: string;
  /** [cardId, copies] — always 30 cards. */
  cards: [string, number][];
  signature: string; // card id shown on the deck box
}

const two = (...ids: string[]): [string, number][] => ids.map((id) => [id, 2]);

export const DECKS: DeckDef[] = [
  {
    id: 'wildfire', name: 'Wildfire', archetype: 'Aggro', colors: ['ember'], signature: 'e_torch_raider',
    blurb: 'Swift units and burn. Hit the Sanctum before the enemy gets going.',
    howToPlay: 'Flood the board early, grab the Ley Orbs, and use Firebolts to clear blockers. Save Scorch the Earth and War Cry to finish.',
    cards: two('e_spark_imp', 'e_cinder_scout', 'e_firebolt', 'e_torch_raider', 'e_ashfang', 'e_powder_goblin', 'e_flame_dancer',
      'e_berserker', 'e_pyromancer', 'e_war_cry', 'c_pyra', 'e_warlord', 'e_scorch', 'e_fireball', 'e_phoenix'),
  },
  {
    id: 'frozen_tide', name: 'Frozen Bastion', archetype: 'Control', colors: ['tide', 'dawn'], signature: 't_leviathan',
    blurb: 'Freeze, bounce and wall up until the Leviathan rises.',
    howToPlay: 'Hold the line with Guardians, answer threats with Frostbolt, Smite and Riptide, draw cards, then take over late with Storm Callers and the Leviathan.',
    cards: two('t_coral_sentry', 't_undertow', 't_frostbolt', 'd_holy_light', 'd_shieldmaiden', 'c_nerith', 't_insight', 't_riptide',
      't_mirror_mage', 'd_smite', 't_glacial', 't_deep_freeze', 't_stormcaller', 't_tidal_wave', 't_leviathan'),
  },
  {
    id: 'ancient_awakening', name: 'Ancient Awakening', archetype: 'Ramp', colors: ['grove', 'tide'], signature: 'g_titan',
    blurb: 'Grow your mana absurdly fast and drop titans nobody can answer.',
    howToPlay: 'Play Druids, Sproutlings and Overgrowth early to gain extra mana crystals, stall with Treants and Entangle, then land Dragons, Leviathans and the Worldroot Titan.',
    cards: two('g_sproutling', 'g_entangle', 'g_druid', 'c_thornak', 't_frostbolt', 'g_overgrowth', 'g_treant', 't_mirror_mage',
      't_insight', 'g_packmother', 'g_behemoth', 't_stormcaller', 'g_dragon', 't_leviathan', 'g_titan'),
  },
  {
    id: 'silver_vanguard', name: 'Silver Vanguard', archetype: 'Midrange', colors: ['dawn', 'grove'], signature: 'd_paladin',
    blurb: 'Efficient, sturdy units that buff each other and trade up.',
    howToPlay: 'Curve out with solid units every round, win fights with Feral Growth and Predator\'s Pounce, and out-value the enemy with Paladins and the Seraph.',
    cards: two('c_sera', 'd_archer', 'd_shieldmaiden', 'g_boar', 'g_feral', 'd_holy_light', 'd_banner', 'd_captain', 'g_treant',
      'g_pounce', 'd_paladin', 'g_stag', 'd_smite', 'd_bastion', 'd_seraph'),
  },
  {
    id: 'grave_pact', name: 'Grave Pact', archetype: 'Combo', colors: ['dusk', 'ember'], signature: 'k_final_rite',
    blurb: 'Every death drains the enemy. Then sacrifice everything at once.',
    howToPlay: 'Assemble Soul Siphons and Necromancers, fill the board with Imps and Skeletons, then cast Final Rite: each sacrificed unit deals 2, plus 1 more per Siphon.',
    cards: two('k_grave_imp', 'e_spark_imp', 'e_firebolt', 'k_dark_pact', 'c_morvath', 'k_bone_horde', 'e_powder_goblin', 'k_cultist',
      'e_flame_dancer', 'k_siphon', 'k_raise_dead', 'k_assassin', 'k_necromancer', 'e_war_cry', 'k_final_rite'),
  },
  {
    id: 'storm_raiders', name: 'Storm Raiders', archetype: 'Tempo', colors: ['ember', 'tide'], signature: 't_wave_rider',
    blurb: 'Fliers and cheap tricks. Always one step ahead.',
    howToPlay: 'Fly over blockers to reach enemy territory, and use cheap spells to push, freeze and bounce defenders at the perfect moment. Sea Witch makes everything cheaper.',
    cards: two('e_spark_imp', 'e_firebolt', 't_undertow', 't_wave_rider', 't_mistling', 'e_torch_raider', 'c_nerith', 't_frostbolt',
      'e_war_cry', 't_sea_witch', 'e_pyromancer', 't_riptide', 'e_powder_goblin', 'e_phoenix', 't_stormcaller'),
  },
  {
    id: 'legion_of_dawn', name: 'Legion of Dawn', archetype: 'Go-Wide', colors: ['dawn', 'dusk'], signature: 'd_glorious',
    blurb: 'An endless army of soldiers and skeletons, then one glorious charge.',
    howToPlay: 'Spread out across the board with Recruits and Skeletons, protect them with Barriers, and swing with everything after Glorious Charge.',
    cards: two('d_squire', 'k_grave_imp', 'k_bone_horde', 'd_archer', 'd_shieldmaiden', 'd_call_arms', 'd_captain', 'c_sera', 'k_siphon',
      'd_divine_aegis', 'k_necromancer', 'd_glorious', 'k_vampire', 'd_paladin', 'd_seraph'),
  },
  {
    id: 'wild_hunt', name: 'Wild Hunt', archetype: 'Stompy', colors: ['grove', 'ember'], signature: 'e_colossus',
    blurb: 'Big beasts, bigger fights. Smash through the front line.',
    howToPlay: 'Play the biggest body you can every round, use Pounce and Fireball to clear the way, and trample in with Colossi and Behemoths.',
    cards: two('g_boar', 'c_thornak', 'e_torch_raider', 'g_feral', 'g_pounce', 'e_berserker', 'g_treant', 'e_firebolt', 'g_stag',
      'g_packmother', 'e_warlord', 'g_behemoth', 'e_fireball', 'e_colossus', 'g_dragon'),
  },
  {
    id: 'night_court', name: 'Night Court', archetype: 'Attrition', colors: ['dusk', 'tide'], signature: 'k_lich',
    blurb: 'Drain life, kill everything, and outlast the opponent.',
    howToPlay: 'Trade efficiently with Deadly units and removal, heal with Drain, and reset the board with the Lich Queen when you fall behind.',
    cards: two('t_coral_sentry', 'k_plague_rat', 't_frostbolt', 'k_embrace', 'k_wraith', 'c_morvath', 't_mirror_mage', 't_insight',
      'k_vampire', 't_glacial', 'k_raise_dead', 't_riptide', 't_deep_freeze', 'k_lich', 't_leviathan'),
  },
];

/** A deck as sent over the wire: prebuilt or player-built. */
export interface DeckList { id: string; name: string; cards: [string, number][] }

export const DECK_SIZE = 30;
export const MAX_COPIES = 3;
export const MAX_COLORS = 2;

export function deckCount(cards: [string, number][]) { return cards.reduce((a, [, n]) => a + n, 0); }

export function deckColors(cards: [string, number][]): Color[] {
  const cs: Color[] = [];
  for (const [id] of cards) { const c = CARDS[id]?.color; if (c && !cs.includes(c)) cs.push(c); }
  return cs;
}

export function deckIcon(cards: [string, number][]): string {
  const defs = cards.map(([id]) => CARDS[id]).filter(Boolean);
  const champ = defs.find((d) => d.champion);
  if (champ) return champ.icon;
  return defs.sort((a, b) => b.cost - a.cost)[0]?.icon ?? '🔮';
}

/** Returns an error message, or null if the deck is legal. */
export function validateDeck(cards: unknown): string | null {
  if (!Array.isArray(cards)) return 'Deck must be a list.';
  let total = 0;
  for (const entry of cards) {
    if (!Array.isArray(entry) || entry.length !== 2) return 'Bad deck entry.';
    const [id, n] = entry;
    const d = CARDS[id as string];
    if (!d || d.token) return `Unknown card ${String(id)}.`;
    if (!Number.isInteger(n) || n < 1 || n > MAX_COPIES) return `Max ${MAX_COPIES} copies of ${d.name}.`;
    total += n;
  }
  if (total !== DECK_SIZE) return `Decks need exactly ${DECK_SIZE} cards (this one has ${total}).`;
  if (deckColors(cards as [string, number][]).length > MAX_COLORS) return `Decks can use at most ${MAX_COLORS} colors.`;
  return null;
}

export function prebuiltList(id: string): DeckList {
  const d = DECKS.find((x) => x.id === id) ?? DECKS[0];
  return { id: d.id, name: d.name, cards: d.cards };
}
