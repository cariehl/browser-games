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

export const Raider = schema({
  name: t.string(),
  role: t.string(),
  /** Ground position (y is up in the client scene) and facing in radians. Facing 0 looks down -z. */
  x: t.float32(),
  z: t.float32(),
  facing: t.float32(),
  /** False while their connection is down and the server waits for them. */
  connected: t.boolean(),
}, 'Raider');

export const RaidState = schema({
  /** By session id. */
  raiders: t.map(Raider),
  /** Which encounter the group is on. Step 3 fills in the real sequence. */
  encounter: t.string(),
}, 'RaidState');
