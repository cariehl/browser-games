// Stands in for the network between client and server. Every action the
// client sends is held for (base ± fuzz) milliseconds before the GameLoop
// receives it.
//
// Delivery stays in order, like a reliable channel (TCP, a WebSocket): a
// packet held up by fuzz delays the ones behind it rather than being
// overtaken.
//
// Only input is delayed. The client still reads world state directly, so
// this simulates the client -> server half of a round trip. Actions cross
// it as JSON, the same as they would over a socket.

import { ClientState } from './client_state.js';
import { Action } from '../sim/actions.js';

export class SimulatedLink {
  constructor() {
    this.baseMs = 0;
    this.fuzzMs = 0;
    /** Numbers every action sent (Action.seq), so the client can tell which predictions the server has applied. */
    this._seq = 0;
    /** Each: { at, entityId, data } */
    this._queue = [];
    this._lastDeliverAt = 0;
  }

  send(entityId, action) {
    this._seq++;
    action.seq = this._seq;
    const data = action.toJSON();
    const now = performance.now();
    if (this.baseMs <= 0 && this.fuzzMs <= 0 && this._queue.length === 0) {
      this._deliver(entityId, data);
      return;
    }
    const fuzz = this.fuzzMs > 0 ? Math.floor(Math.random() * (2 * this.fuzzMs + 1)) - this.fuzzMs : 0;
    const at = Math.max(now + Math.max(this.baseMs + fuzz, 0), this._lastDeliverAt);
    this._lastDeliverAt = at;
    this._queue.push({ at, entityId, data });
  }

  inFlight() {
    return this._queue.length;
  }

  /** Called every frame. */
  update() {
    const now = performance.now();
    while (this._queue.length && this._queue[0].at <= now) {
      const packet = this._queue.shift();
      this._deliver(packet.entityId, packet.data);
    }
  }

  _deliver(entityId, data) {
    const action = Action.fromJSON(data);
    if (action) ClientState.loop.submit(entityId, action);
  }
}
