// Synced state schemas. Colyseus sends only what changed each patch; the
// client reads the same field names without needing these classes.

import { schema, t } from '@colyseus/schema';

export const LobbyPlayer = schema({
  name: t.string(),
  role: t.string(),
  ready: t.boolean(),
}, 'LobbyPlayer');

export const LobbyState = schema({
  /** By session id. */
  players: t.map(LobbyPlayer),
  /** Session id of the player who can start the raid (the longest here). */
  leaderId: t.string(),
  /** True from the moment the leader starts until the party has left. */
  launching: t.boolean(),
}, 'LobbyState');

/** A buff or debuff on a unit, keyed in its auras map by "ability:sourceId". */
export const Aura = schema({
  ability: t.string(),
  /** Who applied it. */
  sourceId: t.string(),
  /** When it wears off, in RaidState.time seconds. */
  ends: t.float64(),
}, 'Aura');

/** What raiders and enemies share. Times are RaidState.time seconds. Health 0 is dead. */
function unitFields() {
  return {
    name: t.string(),
    /** Ground position (y is up in the client scene) and facing in radians. Facing 0 looks down -z. */
    x: t.float32(),
    z: t.float32(),
    facing: t.float32(),
    health: t.int32(),
    maxHealth: t.int32(),
    /** The unit they have selected (raider) or are attacking (enemy), '' for none. */
    targetId: t.string(),
    /** The ability being cast, '' when not casting, and when the cast began and lands. */
    castAbility: t.string(),
    castStart: t.float64(),
    castEnd: t.float64(),
    auras: t.map(Aura),
  };
}

export const Raider = schema({
  ...unitFields(),
  role: t.string(),
  /** False while their connection is down and the server waits for them. */
  connected: t.boolean(),
  /** False until they spend their talent points (on first spawn); they can't act before. */
  talentsChosen: t.boolean(),
  /** Talent ranks by talent id (shared/talents.js). */
  talents: t.map('uint8'),
  /** Their action bar: the class's abilities plus any their talents grant. */
  abilities: t.array('string'),
  /** Auto-attacking their target (started by right-clicking an enemy or a melee ability). */
  attacking: t.boolean(),
  /** When the global cooldown ends. */
  gcdEnd: t.float64(),
  /** When each ability (by id) is ready again; missing means ready. */
  cooldowns: t.map('float64'),
  /** Counts server teleports (spawn, release), so the client snaps instead of predicting. */
  warp: t.uint16(),
}, 'Raider');

export const Enemy = schema({
  ...unitFields(),
  /** A key of ENEMY_KINDS (shared/enemies.js). */
  kind: t.string(),
  /** Threat by raider session id. */
  threat: t.map('float32'),
}, 'Enemy');

export const RaidState = schema({
  /** Seconds since the raid began, advanced every tick: the clock for every time field. */
  time: t.float64(),
  /** By session id. */
  raiders: t.map(Raider),
  /** By id ("enemy-1", ...); never collides with a session id. */
  enemies: t.map(Enemy),
  /** Which encounter the group is on. Step 3 fills in the real sequence. */
  encounter: t.string(),
}, 'RaidState');
