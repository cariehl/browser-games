// The OSRS-style X that appears where you click: yellow for a walkable tile,
// red for a blocked one (or something to interact with). Fades out over one
// tick.

import * as THREE from 'three';
import { tileToWorld, color } from './tile_math.js';

const LIFETIME = 0.6;
const WALK_COLOR = color([1, 0.85, 0.1]);
const BLOCKED_COLOR = color([0.95, 0.2, 0.15]);

export class ClickMarker extends THREE.Group {
  constructor() {
    super();
    this._material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false });
    for (const angle of [45, -45]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.12), this._material);
      bar.rotation.y = THREE.MathUtils.degToRad(angle);
      bar.renderOrder = 5;
      this.add(bar);
    }
    this._age = LIFETIME;
    this.visible = false;
  }

  showAt(tile, walkable) {
    tileToWorld(tile, 0.03, this.position);
    this._material.color.copy(walkable ? WALK_COLOR : BLOCKED_COLOR);
    this._age = 0;
    this.visible = true;
  }

  update(delta) {
    if (!this.visible) return;
    this._age += delta;
    if (this._age >= LIFETIME) {
      this.visible = false;
      return;
    }
    const t = this._age / LIFETIME;
    this._material.opacity = 1 - t;
    this.scale.setScalar(1 + (0.6 - 1) * t);
  }
}
