import type { Hex } from './hex';

export type Color = 'ember' | 'tide' | 'grove' | 'dawn' | 'dusk' | 'neutral';
export type CardType = 'unit' | 'spell' | 'order';

export type Keyword =
  | 'swift'       // can act the round it is summoned
  | 'guardian'    // enemies that move next to it must stop
  | 'flying'      // moves over units, ignores Guardians
  | 'firstStrike' // strikes before the enemy in combat
  | 'drain'       // damage it deals heals your Sanctum
  | 'regenerate'  // fully heals at the end of each round
  | 'barrier'     // negates the next damage it would take
  | 'siege'       // deals double damage to Sanctums
  | 'deadly'      // destroys any unit it damages
  | 'infiltrate'; // can be summoned anywhere in your half of the board

export interface Unit {
  uid: number;
  cardId: string;
  owner: number;
  c: number;
  r: number;
  atk: number;
  hp: number;
  maxHp: number;
  speed: number;
  range: number;
  kw: Keyword[];
  exhausted: boolean;
  summonedRound: number;
  frozen: boolean;   // will not ready at the start of next round
  rootedUntil: number; // can't move until the end of this round number
  tempAtk: number;   // bonus power until end of round
}

export interface CardInst { iid: number; cardId: string; costMod: number }

export interface PlayerState {
  name: string;
  deckId: string;
  deck: string[];        // card ids, top = end of array. Hidden in views.
  hand: CardInst[];      // hidden from the opponent in views
  mana: number;
  maxMana: number;
  spellMana: number;
  sanctum: number;
  fatigue: number;
  mulliganDone: boolean;
  graveyard: string[];   // card ids of friendly units that died
  isAI?: boolean;
  spellsCast: number;
}

export type Phase = 'mulligan' | 'action' | 'over';

export interface GameState {
  round: number;
  phase: Phase;
  turn: number;          // player whose action it is
  initiative: number;    // player who acts first this round
  passes: number;        // consecutive passes
  players: PlayerState[];
  units: Unit[];
  nextId: number;
  winner: number | null; // -1 = draw
  seed: number;
  log: LogEntry[];
  lastPlayed: { player: number; cardId: string } | null;
}

export interface LogEntry { p: number; text: string; round: number }

/** A target picked by a player: a hex, a unit or a Sanctum. null = skipped optional target. */
export type Target = { c: number; r: number } | { uid: number } | { sanctum: number } | null;

export type Action =
  | { type: 'play'; iid: number; targets: Target[] }
  | { type: 'order'; uid: number; to?: Hex; attack?: { uid: number } | { sanctum: number } }
  | { type: 'pass' }
  | { type: 'mulligan'; iids: number[] }
  | { type: 'concede' };

export type GameEvent =
  | { t: 'round'; round: number; initiative: number }
  | { t: 'draw'; p: number; burned?: string }
  | { t: 'play'; p: number; cardId: string; targets: Target[] }
  | { t: 'summon'; uid: number; unit: Unit }
  | { t: 'move'; uid: number; path: Hex[] }
  | { t: 'attack'; uid: number; target: { uid: number } | { sanctum: number }; ranged: boolean }
  | { t: 'damage'; uid: number; amount: number }
  | { t: 'sanctumDamage'; p: number; amount: number }
  | { t: 'sanctumHeal'; p: number; amount: number }
  | { t: 'heal'; uid: number; amount: number }
  | { t: 'barrier'; uid: number }
  | { t: 'death'; uid: number }
  | { t: 'buff'; uid: number; atk: number; hp: number }
  | { t: 'freeze'; uid: number }
  | { t: 'ready'; uid: number }
  | { t: 'bounce'; uid: number }
  | { t: 'teleport'; uid: number; to: Hex }
  | { t: 'orbPulse'; p: number; orb: Hex }
  | { t: 'pass'; p: number }
  | { t: 'fx'; kind: string; at: Hex | null; p?: number; uid?: number }
  | { t: 'mana'; p: number }
  | { t: 'gameOver'; winner: number };
