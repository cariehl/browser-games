// A clickable box on something drawn in the world: an NPC, a gather node, a
// station, an item on the ground. It's a child of the thing's view, so it
// moves with the drawn model (NPCs render a tick behind their tiles) instead
// of sitting on the tile the sim has them on.
//
// Picking casts the mouse ray against every hitbox's box and takes the
// nearest hit. It's plain math on the box, so it works the same at any frame
// or tick rate. F5 (or the debug window) draws them as wireframes.

import * as THREE from 'three';

export const HitboxKind = { NPC: 'npc', PLAYER: 'player', OBJECT: 'object', ITEM: 'item', SCENERY: 'scenery' };

const all = new Set();
const DEBUG_COLOR = 0xffd933;
const _inverse = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();

export class Hitbox extends THREE.Object3D {
  static debugVisible = false;

  /** [size] and [center] (THREE.Vector3) are in the parent view's local space. */
  constructor(kind, targetId, size, center) {
    super();
    this.kind = kind;
    this.targetId = targetId;
    this.box = new THREE.Box3().setFromCenterAndSize(center, size);
    /** Off while the thing can't be clicked (an NPC playing its collapse). */
    this.enabled = true;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    this._wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: DEBUG_COLOR, depthTest: false, transparent: true }));
    this._wire.position.copy(center);
    this._wire.renderOrder = 10;
    this._wire.visible = Hitbox.debugVisible;
    this.add(this._wire);
    all.add(this);
  }

  dispose() {
    all.delete(this);
    this._wire.geometry.dispose();
    this._wire.material.dispose();
    if (this.parent) this.parent.remove(this);
  }

  _shown() {
    if (!this.enabled) return false;
    for (let node = this; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  /** Distance along [ray] (world space) to this box, or -1 if it misses. */
  rayDistance(ray) {
    if (!this._shown()) return -1;
    _inverse.copy(this.matrixWorld).invert();
    _ray.copy(ray).applyMatrix4(_inverse);
    if (!_ray.intersectBox(this.box, _hit)) return -1;
    return _hit.applyMatrix4(this.matrixWorld).distanceTo(ray.origin);
  }

  /** The nearest hitbox along [ray], or null. */
  static pick(ray) {
    let best = null;
    let bestDistance = Infinity;
    for (const hitbox of all) {
      const d = hitbox.rayDistance(ray);
      if (d >= 0 && d < bestDistance) {
        bestDistance = d;
        best = hitbox;
      }
    }
    return best;
  }

  static setDebugVisible(on) {
    Hitbox.debugVisible = on;
    for (const hitbox of all) hitbox._wire.visible = on;
  }
}

/**
 * A clickable box on scenery (decor props, rocks): [target] is
 * { def, tile, terrain }. Scenery never moves, so it sits at the origin of
 * a group at the world's origin and its box is already in world space:
 * picking skips the matrix work, which matters with hundreds of them.
 */
export class SceneryHitbox extends Hitbox {
  constructor(target, size, center) {
    super(HitboxKind.SCENERY, target, size, center);
  }

  rayDistance(ray) {
    if (!this._shown()) return -1;
    if (!ray.intersectBox(this.box, _hit)) return -1;
    return _hit.distanceTo(ray.origin);
  }
}
