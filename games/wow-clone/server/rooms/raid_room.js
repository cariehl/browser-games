// One raid instance: a fixed party, made by the lobby. Seats are reserved
// for the party by name, so nobody else can join it.
//
// The simulation runs at TICK_HZ. It does nothing yet; step 2 adds movement
// and combat to update(), step 3 the encounters.

import { Room } from '@colyseus/core';
import { RECONNECT_SECONDS, TICK_HZ } from '../../shared/constants.js';
import { RaidState, Raider } from '../state.js';

/** Where the party appears: a line at the raid entrance. Facing 0 looks down -z, into the raid. */
export function spawnPoint(index, count) {
  const spread = 1.6;
  const x = (index - (count - 1) / 2) * spread;
  return { x, z: 12, facing: 0 };
}

export class RaidRoom extends Room {
  state = new RaidState();
  /** Who has a seat in this raid, from the lobby: name -> { index, role }. */
  party = new Map();

  /** [party]: [{ name, role }] from the lobby. */
  onCreate({ party }) {
    this.maxClients = party.length;
    party.forEach((p, i) => this.party.set(p.name, { index: i, role: p.role }));
    this.state.encounter = 'entrance';
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / TICK_HZ);
    // Never listed for matchmaking: the only way in is a seat from the lobby.
    this.setPrivate(true);
  }

  onJoin(client, options = {}) {
    const name = options.name ?? '';
    const seat = this.party.get(name);
    if (!seat) throw new Error('You are not in this raid group.');
    for (const r of this.state.raiders.values()) if (r.name === name) throw new Error('Already in the raid.');
    const spot = spawnPoint(seat.index, this.party.size);
    this.state.raiders.set(client.sessionId, new Raider({ name, role: seat.role, ...spot, connected: true }));
  }

  async onDrop(client) {
    // Their character stays in the raid while they reconnect.
    const raider = this.state.raiders.get(client.sessionId);
    if (raider) raider.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client) {
    const raider = this.state.raiders.get(client.sessionId);
    if (raider) raider.connected = true;
  }

  onLeave(client) {
    this.state.raiders.delete(client.sessionId);
  }

  /** One simulation step of [dt] seconds. */
  update(_dt) {}
}
