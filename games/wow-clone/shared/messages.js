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

import { PARTY_MAX, PARTY_MIN } from './constants.js';

/** Why the lobby leader can't start yet, or null when they can. [players]: [{ ready }]. */
export function startBlocker(players) {
  if (players.length < PARTY_MIN) return `Need at least ${PARTY_MIN} players.`;
  if (players.length > PARTY_MAX) return `At most ${PARTY_MAX} players.`;
  if (!players.every((p) => p.ready)) return 'Waiting for everyone to ready up.';
  return null;
}
