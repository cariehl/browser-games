// Tile warnings for boss mechanics (world.hazards, see sim/boss.js): a
// coloured square on each marked tile with an inner square that shrinks to
// nothing on the tick it resolves. Red to dodge, blue to soak, amber for the
// panel run (the next panel bright, the ones done dim).

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { tileToWorld, color } from './tile_math.js';

const COLORS = { dodge: [1, 0.2, 0.15], soak: [0.25, 0.55, 1], panel: [1, 0.72, 0.15] };
const tileGeometry = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
const innerGeometry = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);

export class HazardViews {
  constructor(parent) {
    this.root = new THREE.Group();
    parent.add(this.root);
    /** hazard id -> { group, inner: [mesh], tiles: [mesh], hazard } */
    this._views = new Map();
    this._materials = {};
    for (const [kind, rgb] of Object.entries(COLORS)) {
      this._materials[kind] = {
        edge: new THREE.MeshBasicMaterial({ color: color(rgb), transparent: true, opacity: 0.35, depthWrite: false }),
        fill: new THREE.MeshBasicMaterial({ color: color(rgb), transparent: true, opacity: 0.7, depthWrite: false }),
        next: new THREE.MeshBasicMaterial({ color: color([1, 0.95, 0.6]), transparent: true, opacity: 0.85, depthWrite: false }),
        done: new THREE.MeshBasicMaterial({ color: color(rgb), transparent: true, opacity: 0.12, depthWrite: false }),
      };
    }
  }

  update() {
    const world = ClientState.world;
    const hazards = world.hazards || [];
    const seen = new Set();
    for (const h of hazards) {
      seen.add(h.id);
      let view = this._views.get(h.id);
      if (!view) {
        view = this._build(h);
        this._views.set(h.id, view);
      }
      view.hazard = h;
      const mats = this._materials[h.kind] || this._materials.dodge;
      // How much warning is left, smoothly between ticks.
      const now = world.tick + ClientState.tickAlpha;
      const left = Math.min(Math.max((h.resolve - now) / Math.max(h.resolve - h.start, 1), 0), 1);
      view.inner.forEach((mesh, i) => {
        if (h.kind === 'panel') {
          const progress = h.progress || 0;
          mesh.material = i < progress ? mats.done : i === progress ? mats.next : mats.fill;
          mesh.scale.setScalar(i === progress ? 0.7 + 0.15 * Math.sin(performance.now() / 120) : 0.6);
        } else {
          mesh.scale.setScalar(Math.max(left, 0.02));
        }
      });
    }
    for (const [id, view] of this._views) {
      if (seen.has(id)) continue;
      this.root.remove(view.group);
      this._views.delete(id);
    }
  }

  _build(h) {
    const mats = this._materials[h.kind] || this._materials.dodge;
    const group = new THREE.Group();
    const inner = [];
    h.tiles.forEach((t) => {
      const edge = new THREE.Mesh(tileGeometry, mats.edge);
      tileToWorld(t, 0.03, edge.position);
      const fill = new THREE.Mesh(innerGeometry, mats.fill);
      tileToWorld(t, 0.04, fill.position);
      group.add(edge, fill);
      inner.push(fill);
    });
    this.root.add(group);
    return { group, inner, hazard: h };
  }
}
