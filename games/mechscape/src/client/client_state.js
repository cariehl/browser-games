// The one place views read the game from, and the browser's tick driver.
//
// Views only read. They never call a World method that changes state; what
// the player does goes through the link as Actions.
//
// Today [world] is the live single-player world, run in this page by a
// GameLoop. In the alpha it becomes the client's mirror, which applies each
// server snapshot in place onto objects with the same ids, so views keep
// their references and keep working without knowing the difference.

import { GameLoop } from '../sim/game_loop.js';
import { TICK_SECONDS } from '../sim/constants.js';

export { TICK_SECONDS };

/** Debug tick speeds, slowest to fastest. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export const ClientState = {
  /** @type {GameLoop} */
  loop: null,
  /** The player this page controls. */
  localPlayerId: -1,
  /**
   * Debug tick speed: 2 runs ticks twice as fast. Frame time is scaled by it
   * before it reaches the loop and the views, so view animations, hitsplats
   * and XP drops speed up together and stay in step. Wall-clock things
   * (simulated latency, the camera) don't.
   */
  speed: 1,
  /** A line for the message log to show once at startup (e.g. "Game loaded."). */
  notice: '',
  _tickListeners: [],

  get world() { return this.loop.world; },
  /** 0..1 progress through the current tick, for interpolating. */
  get tickAlpha() { return this.loop.alpha; },

  start(world) {
    this.loop = new GameLoop(world);
    this.loop.onTick((tick) => {
      for (const fn of this._tickListeners) fn(tick);
    });
  },

  /** Calls [fn](tick) after every tick, once the world has advanced. Returns an unsubscribe function. */
  onTick(fn) {
    this._tickListeners.push(fn);
    return () => {
      this._tickListeners = this._tickListeners.filter((f) => f !== fn);
    };
  },

  /** The player this page controls: the world's first player, or a new one. */
  localPlayer() {
    let player = this.world.entities.get(this.localPlayerId);
    if (!player) {
      const players = this.world.players();
      player = players.length ? players[0] : this.world.spawnPlayer('Player');
      this.localPlayerId = player.id;
    }
    return player;
  },

  me() {
    return this.world.entities.get(this.localPlayerId) || null;
  },

  setSpeed(value) {
    this.speed = Math.min(Math.max(value, 0.1), 16);
  },
};
