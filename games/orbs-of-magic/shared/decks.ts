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
      'e_berserker', 'e_pyromancer', 'e_war_cry', 'e_blitz', 'e_warlord', 'e_scorch', 'e_fireball', 'e_phoenix'),
  },
  {
    id: 'frozen_tide', name: 'Frozen Bastion', archetype: 'Control', colors: ['tide', 'dawn'], signature: 't_leviathan',
    blurb: 'Freeze, bounce and wall up until the Leviathan rises.',
    howToPlay: 'Hold the line with Guardians, answer threats with Frostbolt, Smite and Riptide, draw cards, then take over late with Storm Callers and the Leviathan.',
    cards: two('t_coral_sentry', 't_undertow', 't_frostbolt', 'd_holy_light', 'd_shieldmaiden', 't_mistling', 't_insight', 't_riptide',
      't_mirror_mage', 'd_smite', 't_glacial', 't_deep_freeze', 't_stormcaller', 't_tidal_wave', 't_leviathan'),
  },
  {
    id: 'ancient_awakening', name: 'Ancient Awakening', archetype: 'Ramp', colors: ['grove', 'tide'], signature: 'g_titan',
    blurb: 'Grow your mana absurdly fast and drop titans nobody can answer.',
    howToPlay: 'Play Druids, Sproutlings and Overgrowth early to gain extra mana crystals, stall with Treants and Entangle, then land Dragons, Leviathans and the Worldroot Titan.',
    cards: two('g_sproutling', 'g_entangle', 'g_druid', 'g_boar', 't_frostbolt', 'g_overgrowth', 'g_treant', 't_mirror_mage',
      't_insight', 'g_packmother', 'g_behemoth', 't_stormcaller', 'g_dragon', 't_leviathan', 'g_titan'),
  },
  {
    id: 'silver_vanguard', name: 'Silver Vanguard', archetype: 'Midrange', colors: ['dawn', 'grove'], signature: 'd_paladin',
    blurb: 'Efficient, sturdy units that buff each other and trade up.',
    howToPlay: 'Curve out with solid units every round, win fights with Feral Growth and Predator\'s Pounce, and out-value the enemy with Paladins and the Seraph.',
    cards: two('d_squire', 'd_archer', 'd_shieldmaiden', 'g_boar', 'g_feral', 'd_holy_light', 'd_banner', 'd_captain', 'g_treant',
      'g_pounce', 'd_paladin', 'g_stag', 'd_smite', 'd_bastion', 'd_seraph'),
  },
  {
    id: 'grave_pact', name: 'Grave Pact', archetype: 'Combo', colors: ['dusk', 'ember'], signature: 'k_final_rite',
    blurb: 'Every death drains the enemy. Then sacrifice everything at once.',
    howToPlay: 'Assemble Soul Siphons and Necromancers, fill the board with Imps and Skeletons, then cast Final Rite: each sacrificed unit deals 2, plus 1 more per Siphon.',
    cards: two('k_grave_imp', 'e_spark_imp', 'e_firebolt', 'k_dark_pact', 'k_plague_rat', 'k_bone_horde', 'e_powder_goblin', 'k_cultist',
      'e_flame_dancer', 'k_siphon', 'k_raise_dead', 'k_assassin', 'k_necromancer', 'e_war_cry', 'k_final_rite'),
  },
  {
    id: 'storm_raiders', name: 'Storm Raiders', archetype: 'Tempo', colors: ['ember', 'tide'], signature: 't_wave_rider',
    blurb: 'Fliers and cheap tricks. Always one step ahead.',
    howToPlay: 'Fly over blockers to reach enemy territory, and use cheap spells to push, freeze and bounce defenders at the perfect moment. Sea Witch makes everything cheaper.',
    cards: two('e_spark_imp', 'e_firebolt', 't_undertow', 't_wave_rider', 't_mistling', 'e_torch_raider', 'e_blitz', 't_frostbolt',
      'e_war_cry', 't_sea_witch', 'e_pyromancer', 't_riptide', 'k_wraith', 'e_phoenix', 't_stormcaller'),
  },
  {
    id: 'legion_of_dawn', name: 'Legion of Dawn', archetype: 'Go-Wide', colors: ['dawn', 'dusk'], signature: 'd_glorious',
    blurb: 'An endless army of soldiers and skeletons, then one glorious charge.',
    howToPlay: 'Spread out across the board with Recruits and Skeletons, protect them with Barriers, and swing with everything after Glorious Charge.',
    cards: two('d_squire', 'k_grave_imp', 'k_bone_horde', 'd_archer', 'd_shieldmaiden', 'd_call_arms', 'd_captain', 'd_banner', 'k_siphon',
      'd_divine_aegis', 'k_necromancer', 'd_glorious', 'k_vampire', 'd_paladin', 'd_seraph'),
  },
  {
    id: 'wild_hunt', name: 'Wild Hunt', archetype: 'Stompy', colors: ['grove', 'ember'], signature: 'e_colossus',
    blurb: 'Big beasts, bigger fights. Smash through the front line.',
    howToPlay: 'Play the biggest body you can every round, use Pounce and Fireball to clear the way, and trample in with Colossi and Behemoths.',
    cards: two('g_boar', 'e_ashfang', 'e_torch_raider', 'g_feral', 'g_pounce', 'e_berserker', 'g_treant', 'e_firebolt', 'g_stag',
      'g_packmother', 'e_warlord', 'g_behemoth', 'e_fireball', 'e_colossus', 'g_dragon'),
  },
  {
    id: 'night_court', name: 'Night Court', archetype: 'Attrition', colors: ['dusk', 'tide'], signature: 'k_lich',
    blurb: 'Drain life, kill everything, and outlast the opponent.',
    howToPlay: 'Trade efficiently with Deadly units and removal, heal with Drain, and reset the board with the Lich Queen when you fall behind.',
    cards: two('t_coral_sentry', 'k_plague_rat', 't_frostbolt', 'k_embrace', 'k_wraith', 't_undertow', 't_mirror_mage', 't_insight',
      'k_vampire', 't_glacial', 'k_raise_dead', 't_riptide', 't_deep_freeze', 'k_lich', 't_leviathan'),
  },
];
