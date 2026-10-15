// Screen-space combat feedback, drawn over the 3D view:
//   HP bars over anyone in combat or hurt.
//   Hitsplats: red with the damage, blue 0 for a miss, for about a second.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { Screen, el } from './screen.js';

const SPLAT_SECONDS = 1.1;
const BAR_WIDTH = 46;
const _head = new THREE.Vector3();

export class CombatOverlay {
  /** [views]: entity id -> EntityView (WorldViews.entities). */
  constructor(parent, views) {
    this.layer = el('div', 'combat-layer', '', parent);
    this.views = views;
    /** entity id -> { bar, fill } */
    this._bars = new Map();
    /** Each: { node, entity, age, offset: [x, y] } */
    this._splats = [];
    ClientState.onTick(() => this._onTick());
  }

  _onTick() {
    const perTarget = new Map();
    // Hits that did nothing because only a mech can hurt the target.
    const immune = new Set();
    for (const event of ClientState.world.events) {
      if (event.type === 'no_effect') immune.add(`${event.data.attacker}>${event.data.target}`);
    }
    for (const event of ClientState.world.events) {
      if (event.type !== 'hit') continue;
      const target = event.data.target;
      const stacked = perTarget.get(target) || 0;
      perTarget.set(target, stacked + 1);
      this._addSplat(target, event.data.damage, stacked, immune.has(`${event.data.attacker}>${target}`));
    }
  }

  update(delta) {
    const world = ClientState.world;
    // Bars of players who've logged out.
    for (const [id, bar] of this._bars) {
      if (this.views.has(id)) continue;
      bar.bar.remove();
      this._bars.delete(id);
    }
    for (const [id, view] of this.views) {
      const state = world.entities.get(id);
      const bar = this._barFor(id);
      const show = !!state && view.visible && !state.isDead() && (state.inCombat(world.tick) || state.hp < state.maxHp());
      let visible = false;
      if (show) {
        view.getWorldPosition(_head);
        _head.y += view.headHeight;
        const p = Screen.project(_head);
        visible = !p.behind;
        if (visible) {
          bar.fill.style.width = `${(100 * state.hp) / state.maxHp()}%`;
          bar.bar.style.transform = `translate(${p.x - BAR_WIDTH / 2}px, ${p.y}px)`;
        }
      }
      bar.bar.style.display = visible ? '' : 'none';
    }
    for (let i = this._splats.length - 1; i >= 0; i--) {
      const splat = this._splats[i];
      splat.age += delta;
      const view = this.views.get(splat.entity);
      if (splat.age >= SPLAT_SECONDS || !view) {
        splat.node.remove();
        this._splats.splice(i, 1);
        continue;
      }
      view.getWorldPosition(_head);
      _head.y += view.headHeight * 0.55;
      const p = Screen.project(_head);
      splat.node.style.display = p.behind ? 'none' : '';
      splat.node.style.transform = `translate(${p.x + splat.offset[0]}px, ${p.y + splat.offset[1]}px) translate(-50%, -50%)`;
      splat.node.style.opacity = String(Math.min(Math.max((SPLAT_SECONDS - splat.age) / 0.3, 0), 1));
    }
  }

  _barFor(id) {
    let bar = this._bars.get(id);
    if (!bar) {
      const node = el('div', 'hp-bar', '', this.layer);
      bar = { bar: node, fill: el('div', 'fill', '', node) };
      this._bars.set(id, bar);
    }
    return bar;
  }

  _addSplat(entityId, damage, stacked, immune = false) {
    const node = immune
      ? el('div', 'hitsplat immune', 'No effect', this.layer)
      : el('div', damage > 0 ? 'hitsplat hit' : 'hitsplat miss', String(damage), this.layer);
    // Several hits on one target in one tick fan out instead of stacking.
    const offset = [[0, -18, 18, 0][stacked % 4], [0, 10, 10, 20][stacked % 4]];
    this._splats.push({ node, entity: entityId, age: 0, offset });
  }
}
