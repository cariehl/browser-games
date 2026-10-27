// Messages that aren't state. State (who's in the lobby, where raiders stand)
// syncs through the schemas in server/state.js.
//
// Lobby, client -> server:
//   join options  { name, role }
//   'setRole'     { role }
//   'setReady'    { ready }
//   'start'       {}  (leader only)
// Lobby, server -> client:
//   'launch'      { reservation }  a seat in the new raid room
//   'notice'      { text }         something to show the player
//
// Raid: created by the lobby with { party: [{ name, role }] }; seats are
// reserved with { name, role }. Clients never pick those themselves.
// Raid, client -> server:
//   'talents'   { picks }                    spend talent points ({ talentId: rank }), once per raid
//   'move'      { forward, strafe, facing }  movement keys held (-1, 0, 1) and where they look
//   'target'    { id }                       select a unit ('' clears)
//   'cast'      { ability }                  use an ability on the current target
//   'attack'    { on }                       start (true) or stop auto-attacking the current target
//   'stopCast'  {}
//   'release'   {}                           respawn at the entrance when dead
// Raid, server -> client:
//   'hit'       { source, target, ability, amount, heal, crit, tick }  damage or healing done
//   'error'     { text }                     why an action failed

import { PARTY_MAX, PARTY_MIN } from './constants.js';

/** Why the lobby leader can't start yet, or null when they can. [players]: [{ ready }]. */
export function startBlocker(players) {
  if (players.length < PARTY_MIN) return `Need at least ${PARTY_MIN} players.`;
  if (players.length > PARTY_MAX) return `At most ${PARTY_MAX} players.`;
  if (!players.every((p) => p.ready)) return 'Waiting for everyone to ready up.';
  return null;
}

const AXIS = [-1, 0, 1];

/** A 'move' message's fields, checked, or null if malformed. */
export function cleanMove(data) {
  const { forward, strafe, facing } = data ?? {};
  if (!AXIS.includes(forward) || !AXIS.includes(strafe)) return null;
  if (typeof facing !== 'number' || !Number.isFinite(facing)) return null;
  // Keep facing in (-π, π] so it can't grow without bound.
  return { forward, strafe, facing: Math.atan2(Math.sin(facing), Math.cos(facing)) };
}

/** A string id field of at most [max] characters, or null. */
export function cleanId(value, max = 40) {
  return typeof value === 'string' && value.length <= max ? value : null;
}
