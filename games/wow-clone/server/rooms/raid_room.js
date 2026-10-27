// One raid instance: a fixed party, made by the lobby. Seats are reserved
// for the party by name, so nobody else can join it.
//
// The simulation (server/world.js) runs at TICK_HZ. This room checks the
// players' messages and hands them to it. Step 2 has practice targets in the
// hall; step 3 replaces them with the encounters.
// Messages: see shared/messages.js.

import { Room } from '@colyseus/core';
import { RECONNECT_SECONDS, TICK_HZ } from '../../shared/constants.js';
import { PRACTICE_SPAWNS } from '../../shared/enemies.js';
import { cleanId, cleanMove } from '../../shared/messages.js';
import { RaidState } from '../state.js';
import { RaidWorld } from '../world.js';

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
    this.state.time = 0;
    this.world = new RaidWorld(this.state, { emit: (type, data, to) => this.tell(type, data, to) });
    for (const spawn of PRACTICE_SPAWNS) this.world.addEnemy(spawn.kind, spawn);

    this.onMessage('talents', (client, data) => this.world.chooseTalents(client.sessionId, data?.picks));
    this.onMessage('move', (client, data) => {
      const input = cleanMove(data);
      if (input) this.world.setInput(client.sessionId, input);
    });
    this.onMessage('target', (client, data) => {
      const id = cleanId(data?.id);
      if (id !== null) this.world.setTarget(client.sessionId, id);
    });
    this.onMessage('cast', (client, data) => {
      const ability = cleanId(data?.ability);
      if (ability) this.world.cast(client.sessionId, ability);
    });
    this.onMessage('attack', (client, data) => {
      if (typeof data?.on === 'boolean') this.world.setAttack(client.sessionId, data.on);
    });
    this.onMessage('stopCast', (client) => this.world.stopCast(client.sessionId));
    this.onMessage('release', (client) => {
      const raider = this.state.raiders.get(client.sessionId);
      if (raider) this.world.release(client.sessionId, this.spawnFor(raider.name));
    });

    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / TICK_HZ);
    // Never listed for matchmaking: the only way in is a seat from the lobby.
    this.setPrivate(true);
  }

  /** Sends to one raider by session id, or everyone if [to] is undefined. */
  tell(type, data, to) {
    if (to === undefined) return this.broadcast(type, data);
    this.clients.getById(to)?.send(type, data);
  }

  spawnFor(name) {
    return spawnPoint(this.party.get(name).index, this.party.size);
  }

  onJoin(client, options = {}) {
    const name = options.name ?? '';
    const seat = this.party.get(name);
    if (!seat) throw new Error('You are not in this raid group.');
    for (const r of this.state.raiders.values()) if (r.name === name) throw new Error('Already in the raid.');
    this.world.addRaider(client.sessionId, { name, role: seat.role }, this.spawnFor(name));
  }

  async onDrop(client) {
    // Their character stays in the raid while they reconnect, standing still.
    const raider = this.state.raiders.get(client.sessionId);
    if (raider) {
      raider.connected = false;
      this.world.setInput(client.sessionId, { forward: 0, strafe: 0, facing: raider.facing });
    }
    await this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client) {
    const raider = this.state.raiders.get(client.sessionId);
    if (raider) raider.connected = true;
  }

  onLeave(client) {
    this.world.removeRaider(client.sessionId);
  }

  /** One simulation step of [dt] seconds. */
  update(dt) {
    this.world.update(dt);
  }
}
