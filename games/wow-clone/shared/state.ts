// Synced state schemas, shared so the client gets the same types the server
// writes. Colyseus sends only what changed each patch.

import { MapSchema, schema, t, type SchemaType } from '@colyseus/schema';

export const LobbyPlayer = schema({
  name: t.string(),
  role: t.string(),
  ready: t.boolean(),
}, 'LobbyPlayer');
export type LobbyPlayer = SchemaType<typeof LobbyPlayer>;

export const LobbyState = schema({
  /** By session id. */
  players: t.map(LobbyPlayer),
  /** Session id of the player who can start the raid (the longest here). */
  leaderId: t.string(),
  /** True from the moment the leader starts until the party has left. */
  launching: t.boolean(),
}, 'LobbyState');
export type LobbyState = SchemaType<typeof LobbyState>;

export const Raider = schema({
  name: t.string(),
  role: t.string(),
  /** Ground position (y is up in the client scene) and facing in radians. */
  x: t.float32(),
  z: t.float32(),
  facing: t.float32(),
  /** False while their connection is down and the server waits for them. */
  connected: t.boolean(),
}, 'Raider');
export type Raider = SchemaType<typeof Raider>;

export const RaidState = schema({
  /** By session id. */
  raiders: t.map(Raider),
  /** Which encounter the group is on. Step 3 fills in the real sequence. */
  encounter: t.string(),
}, 'RaidState');
export type RaidState = SchemaType<typeof RaidState>;

export { MapSchema };
