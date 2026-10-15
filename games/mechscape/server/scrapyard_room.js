// The Colyseus room everyone plays in: one per server, running the Game.
//
// Messages, client -> server:
//   'action'  an Action as JSON (Action.toJSON()). The server applies it to
//             the sender's own pilot, whatever entity id the client thinks it has.
// Server -> client:
//   'welcome' { id, debug, snapshot }  once on joining: your entity id and the world.
//   'tick'    a snapshot (see src/sim/snapshot.js) after every tick.
//   'notice'  { text }  something to show the player (a refused action).
//
// Joining takes { name }. A dropped connection has RECONNECT_SECONDS to come
// back as the same pilot before it's logged out. Joining afresh with that
// name in the meantime (reloading the page) takes the pilot over at once.

import { cleanLook } from '../src/sim/appearance.js';
import { Room } from '@colyseus/core';
import { takeSnapshot } from '../src/sim/snapshot.js';

export const RECONNECT_SECONDS = 30;
export const MAX_PLAYERS = 16;

export class ScrapyardRoom extends Room {
  maxClients = MAX_PLAYERS;
  autoDispose = false;

  /** [game]: the Game to run (passed by server.define). */
  onCreate({ game }) {
    this.game = game;
    /** Entity id -> { client, deferred } for connections waiting to reconnect. */
    this._dropped = new Map();
    this.onMessage('action', (client, data) => {
      const id = client.userData?.id;
      if (id == null) return;
      const refused = game.submit(id, data);
      if (refused) client.send('notice', { text: refused });
    });
    this._unsubscribe = game.onTick(() => {
      for (const client of this.clients) {
        const id = client.userData?.id;
        if (id != null) client.send('tick', takeSnapshot(game.world, id));
      }
    });
    let last = performance.now();
    this.setSimulationInterval(() => {
      const now = performance.now();
      game.advance((now - last) / 1000);
      last = now;
    }, 50);
  }

  onJoin(client, options = {}) {
    let player = null;
    const droppedId = this.game.findOnline(options.name);
    const dropped = this._dropped.get(droppedId);
    if (dropped) {
      // Back on a new connection (a reload) while the old one waits: take the pilot over.
      dropped.client.userData.takenOver = true;
      this._dropped.delete(droppedId);
      dropped.deferred.reject(new Error('taken over'));
      player = this.game.world.entities.get(droppedId);
      player.last_action_seq = 0;
      if (options.look) player.look = cleanLook(options.look, player.id);
    } else {
      // Throwing turns the join away, with the message shown to the player.
      player = this.game.join(options.name, options.look);
    }
    client.userData = { id: player.id };
    const snapshot = takeSnapshot(this.game.world, player.id);
    snapshot.events = [];
    client.send('welcome', { id: player.id, debug: this.game.debug, xp_rate: this.game.xpRate, snapshot });
    console.log(`${player.display_name} joined as #${player.id} (${this.clients.length} online)`);
  }

  async onDrop(client) {
    // Their pilot stays in the world (and in danger) while they reconnect.
    const id = client.userData?.id;
    const deferred = this.allowReconnection(client, RECONNECT_SECONDS);
    if (id != null) this._dropped.set(id, { client, deferred });
    try {
      await deferred;
    } catch {
      // Timed out, or taken over; onLeave follows.
    } finally {
      if (this._dropped.get(id)?.client === client) this._dropped.delete(id);
    }
  }

  onLeave(client) {
    const id = client.userData?.id;
    if (id == null || client.userData.takenOver) return;
    const name = this.game.world.entities.get(id)?.display_name;
    this.game.leave(id);
    console.log(`${name} left (${this.clients.length} online)`);
  }

  onDispose() {
    this._unsubscribe?.();
    this.game.save();
  }
}
