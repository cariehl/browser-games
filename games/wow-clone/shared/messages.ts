// Messages that aren't state. State (who's in the lobby, where raiders stand)
// syncs through the schemas in state.ts.

import { PARTY_MAX, PARTY_MIN } from './constants';
import type { Role } from './roles';

/** Options a client passes when joining the lobby. */
export interface LobbyJoinOptions {
  name: string;
  role: Role;
}

/** Options the lobby reserves a raid seat with (clients never send these). */
export interface RaidJoinOptions {
  name: string;
  role: Role;
}

/** What the lobby creates a raid instance with. */
export interface RaidCreateOptions {
  party: RaidJoinOptions[];
}

/** Client -> lobby. */
export interface LobbyClientMessages {
  setRole: { role: Role };
  setReady: { ready: boolean };
  start: Record<string, never>;
}

/** Lobby -> client. `launch` carries a seat reservation for the new raid room. */
export interface LobbyServerMessages {
  launch: { reservation: unknown };
  notice: { text: string };
}

/** Why the lobby leader can't start yet, or null when they can. */
export function startBlocker(players: { ready: boolean }[]): string | null {
  if (players.length < PARTY_MIN) return `Need at least ${PARTY_MIN} players.`;
  if (players.length > PARTY_MAX) return `At most ${PARTY_MAX} players.`;
  if (!players.every((p) => p.ready)) return 'Waiting for everyone to ready up.';
  return null;
}
