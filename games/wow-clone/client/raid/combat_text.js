// Floating combat text: numbers that rise from a unit and fade, for damage
// and healing the player does or takes.

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { el } from '../dom.js';

const LIFE = 1.3;
const RISE = 1.8;

export class CombatText {
  floats = [];

  constructor(scene) {
    this.scene = scene;
  }

  /** Shows [text] above [view] with CSS class [kind] ('damage', 'heal', 'hurt'). */
  spawn(view, text, kind, crit) {
    const node = el('div', `float ${kind}${crit ? ' crit' : ''}`, text);
    const obj = new CSS2DObject(node);
    const p = view.root.position;
    // Numbers that arrive together stack upward instead of overlapping.
    const recent = this.floats.filter((f) => f.view === view && f.age < 0.4).length;
    const y = view.height * 0.75 + recent * 0.6;
    obj.position.set(p.x + (Math.random() - 0.5) * 0.8, y, p.z + (Math.random() - 0.5) * 0.8);
    this.scene.add(obj);
    this.floats.push({ obj, node, view, age: 0, y });
  }

  update(dt) {
    for (const f of this.floats) {
      f.age += dt;
      const t = f.age / LIFE;
      f.obj.position.y = f.y + RISE * (1 - (1 - t) * (1 - t));
      f.node.style.opacity = String(t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4));
    }
    for (const f of this.floats.filter((f) => f.age >= LIFE)) this.remove(f);
    this.floats = this.floats.filter((f) => f.age < LIFE);
  }

  remove(f) {
    f.node.remove();
    f.obj.removeFromParent();
  }

  dispose() {
    for (const f of this.floats) this.remove(f);
    this.floats = [];
  }
}
