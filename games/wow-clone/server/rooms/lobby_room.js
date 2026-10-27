// Where a group gathers before a raid. The whole room is the party: up to
// PARTY_MAX players pick roles, ready up, and the leader starts. The server
// then creates a RaidRoom and hands each of them a seat in it.
//
// Lobbies are made on demand (joinOrCreate), so a sixth player, or anyone who
// arrives while a group is launching, starts the next lobby.
// Messages: see shared/messages.js.

import { Room, matchMaker } from '@colyseus/core';
import { PARTY_MAX, ROOM_RAID, cleanName } from '../../shared/constants.js';
import { startBlocker } from '../../shared/messages.js';
import { isRole } from '../../shared/roles.js';
import { LobbyPlayer, LobbyState } from '../state.js';

export class LobbyRoom extends Room {
  maxClients = PARTY_MAX;
  state = new LobbyState();

  onCreate() {
    this.onMessage('setRole', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player && isRole(data?.role) && !this.state.launching) player.role = data.role;
    });
    this.onMessage('setReady', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof data?.ready === 'boolean' && !this.state.launching) player.ready = data.ready;
    });
    this.onMessage('start', (client) => this.start(client));
  }

  onJoin(client, options = {}) {
    // Throwing turns the join away, with the message shown to the player.
    const name = cleanName(options.name);
    if (!name) throw new Error('Pick a name: up to 12 letters, numbers, spaces, - or _.');
    if (this.state.launching) throw new Error('This group is heading into a raid.');
    for (const p of this.state.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) throw new Error(`Someone here is already called ${p.name}.`);
    }
    this.state.players.set(client.sessionId, new LobbyPlayer({ name, role: isRole(options.role) ? options.role : 'dps', ready: false }));
    if (!this.state.leaderId) this.state.leaderId = client.sessionId;
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    if (this.state.leaderId === client.sessionId) {
      // Leadership passes to whoever has been here longest (maps keep insertion order).
      this.state.leaderId = this.state.players.keys().next().value ?? '';
    }
  }

  async start(client) {
    if (client.sessionId !== this.state.leaderId) return client.send('notice', { text: 'Only the group leader can start.' });
    if (this.state.launching) return;
    const blocker = startBlocker([...this.state.players.values()]);
    if (blocker) return client.send('notice', { text: blocker });

    this.state.launching = true;
    await this.lock();
    // Everyone in the room at this moment goes; the roster is fixed from here.
    const seats = this.clients
      .map((c) => ({ client: c, player: this.state.players.get(c.sessionId) }))
      .filter((s) => s.player);
    try {
      const party = seats.map((s) => ({ name: s.player.name, role: s.player.role }));
      const raid = await matchMaker.createRoom(ROOM_RAID, { party });
      for (const [i, seat] of seats.entries()) {
        const reservation = await matchMaker.reserveSeatFor(raid, party[i]);
        seat.client.send('launch', { reservation });
      }
      console.log(`Raid ${raid.roomId} launched: ${party.map((p) => `${p.name} (${p.role})`).join(', ')}`);
    } catch (error) {
      console.error('Raid launch failed:', error);
      this.state.launching = false;
      await this.unlock();
      this.broadcast('notice', { text: "Couldn't start the raid. Try again." });
    }
  }
}
