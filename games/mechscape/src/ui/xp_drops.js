// Floating "+20 Salvaging" text over the player whenever XP is gained.

import { ClientState } from '../client/client_state.js';
import { Skills } from '../sim/skills.js';
import { WorldLabel } from './screen.js';
import { commas } from './common.js';

const RISE = 0.9;
const LIFETIME = 1.4;

export class XpDrops {
  /** [target]: the local player's view. */
  constructor(target) {
    this.target = target;
    /**
     * Seconds into a commit tick that the player's swing starts (see
     * ModelAnimator.windupDelay). XP from an attack waits for it, so the drop
     * appears on the swing's first frame. 0 shows it as the tick starts.
     */
    this.swingDelay = () => (target.animator ? target.animator.windupDelay() : 0);
    /** Each: { label, age, wait, y } */
    this._drops = [];
    ClientState.onTick(() => this._onTick());
  }

  _onTick() {
    const id = ClientState.localPlayerId;
    const events = ClientState.world.events;
    const attacked = events.some((e) => e.type === 'attack' && e.data.attacker === id);
    let stacked = 0;
    for (const event of events) {
      if (event.entity !== id || event.type !== 'xp') continue;
      const text = `+${commas(event.data.amount)} ${Skills.displayName(event.data.skill)}`;
      const wait = attacked ? this.swingDelay() : 0;
      this._spawn(text, stacked, wait);
      stacked++;
    }
  }

  /** [stacked] offsets drops that land on the same tick so they don't overlap. */
  _spawn(text, stacked, wait) {
    const label = new WorldLabel('xp-drop');
    label.text = text;
    label.visible = false;
    this._drops.push({ label, age: -wait, stacked, base: null });
  }

  update(delta) {
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const drop = this._drops[i];
      drop.age += delta;
      if (drop.age < 0) continue;
      if (!drop.base) {
        drop.base = this.target.position.clone();
        drop.base.y += 2.7 + 0.6 * drop.stacked;
        drop.label.visible = true;
      }
      if (drop.age >= LIFETIME) {
        drop.label.dispose();
        this._drops.splice(i, 1);
        continue;
      }
      const t = drop.age / LIFETIME;
      drop.label.point.copy(drop.base).y += RISE * t;
      drop.label.el.style.opacity = String(1 - t * t);
      drop.label.update();
    }
  }
}
