// Fade to black and back when you move between areas. A hatch or lift
// takes a tick to step through (the server sends a "transition" event
// first), so the screen fades out, you arrive, and it fades back in. Other
// jumps to another area (boarding the mech, a boss door, being reprinted)
// cut to black and fade in.

import { ClientState } from '../client/client_state.js';
import { el } from './screen.js';

/** Seconds to fade out and in. A tick is 0.6s, so the fade out is done just as you arrive. */
const OUT_SECONDS = 0.45;
const IN_SECONDS = 0.5;
/** Fade back anyway if nothing arrives this long after a fade out (the step was interrupted). */
const GIVE_UP_MS = 2000;

export class ScreenFade {
  constructor(parent) {
    this.el = el('div', 'screen-fade', '', parent);
    this._area = null;
    this._giveUp = null;
    ClientState.onTick(() => this._onTick());
  }

  _onTick() {
    const world = ClientState.world;
    const me = ClientState.me();
    const mine = (type) => world.events.some((e) => e.type === type && e.entity === ClientState.localPlayerId);
    if (mine('transition')) this.out();
    const area = me ? world.areaIdAt(me.tile) : null;
    const moved = mine('teleport') && (this._out || (this._area != null && area !== this._area));
    if (moved) this.in();
    this._area = area;
  }

  /** Fades to black. */
  out() {
    this._out = true;
    this._set(1, OUT_SECONDS);
    clearTimeout(this._giveUp);
    this._giveUp = setTimeout(() => this.in(), GIVE_UP_MS);
  }

  /** From black (straight to black first if it isn't already), fades back in. */
  in() {
    clearTimeout(this._giveUp);
    const wasOut = this._out;
    this._out = false;
    if (!wasOut) this._set(1, 0);
    // Let the camera snap to where you are before showing it.
    requestAnimationFrame(() => requestAnimationFrame(() => this._set(0, IN_SECONDS)));
  }

  _set(opacity, seconds) {
    this.el.style.transition = seconds > 0 ? `opacity ${seconds}s ease-in-out` : 'none';
    this.el.style.opacity = String(opacity);
  }
}
