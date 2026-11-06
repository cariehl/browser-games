// The fixed-rate tick driver.
//
// Time produces ticks; the simulation consumes them. Whoever owns the loop
// feeds it elapsed time with advance(); rendering reads [alpha] to
// interpolate between the last two tick states. It never touches the DOM or
// a timer itself, so a headless server can drive it from setInterval and a
// browser from requestAnimationFrame.
//
// submit() is the network boundary. Today it's a function call in the same
// page; in multiplayer, clients send actions over a socket and a headless
// server runs this same loop.

import { World } from './world.js';
import { TICK_SECONDS } from './constants.js';

/** After a hitch, run at most this many catch-up ticks in one frame, then drop the backlog. */
const MAX_CATCHUP = 5;

export class GameLoop {
  constructor(world = new World()) {
    this.world = world;
    /** 0..1 progress through the current tick. */
    this.alpha = 0;
    /** Set false to freeze the simulation. */
    this.running = true;
    /** Called after every tick with the new tick number. */
    this.listeners = [];
    this._accumulator = 0;
    /** entity id -> Map(slot -> Action). Latest action per slot wins. */
    this._pending = new Map();
  }

  onTick(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  /** Swap in a different world (a loaded save, or a new game). Queued input is dropped. */
  replaceWorld(world) {
    this.world = world;
    this._pending = new Map();
    this._accumulator = 0;
    this.alpha = 0;
  }

  submit(entityId, action) {
    if (!this._pending.has(entityId)) this._pending.set(entityId, new Map());
    this._pending.get(entityId).set(action.slot(), action);
  }

  /** [seconds] of (possibly sped-up) game time have passed. */
  advance(seconds) {
    if (!this.running) return;
    this._accumulator += seconds;
    let ran = 0;
    while (this._accumulator >= TICK_SECONDS && ran < MAX_CATCHUP) {
      this._accumulator -= TICK_SECONDS;
      this.runTick();
      ran++;
    }
    if (this._accumulator >= TICK_SECONDS) this._accumulator = 0;
    this.alpha = Math.min(Math.max(this._accumulator / TICK_SECONDS, 0), 1);
  }

  runTick() {
    const actions = this._pending;
    this._pending = new Map();
    this.world.runTick(actions);
    for (const fn of this.listeners) fn(this.world.tick);
  }
}
