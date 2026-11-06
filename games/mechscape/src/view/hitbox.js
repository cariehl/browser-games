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

/**
 * Which hitboxes the debug view draws: none, NPCs, everything that moves
 * (NPCs and players), everything you can use (objects and ground items),
 * or all of it, scenery included.
 */
export const HitboxFilter = {
  off: { label: 'Off', kinds: [] },
  npcs: { label: 'NPCs', kinds: [HitboxKind.NPC] },
  entities: { label: 'All entities', kinds: [HitboxKind.NPC, HitboxKind.PLAYER] },
  objects: { label: 'All objects', kinds: [HitboxKind.OBJECT, HitboxKind.ITEM] },
  all: { label: 'Everything', kinds: Object.values(HitboxKind) },
};

export class Hitbox extends THREE.Object3D {
  /** A key of HitboxFilter. */
  static debugFilter = 'off';

  static get debugVisible() {
    return Hitbox.debugFilter !== 'off';
  }

  /** [size] and [center] (THREE.Vector3) are in the parent view's local space. */
  constructor(kind, targetId, size, center) {
    super();
    this.kind = kind;
    this.targetId = targetId;
    this.box = new THREE.Box3().setFromCenterAndSize(center, size);
    /** Off while the thing can't be clicked (an NPC playing its collapse). */
    this.enabled = true;
    /** The debug wireframe, made the first time it's shown (there are thousands of boxes). */
    this._wire = null;
    all.add(this);
    if (Hitbox._drawn(kind)) this._showWire(true);
  }

  static _drawn(kind) {
    return HitboxFilter[Hitbox.debugFilter].kinds.includes(kind);
  }

  _showWire(on) {
    if (on && !this._wire) {
      const size = this.box.getSize(new THREE.Vector3());
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
      this._wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: DEBUG_COLOR, depthTest: false, transparent: true }));
      this.box.getCenter(this._wire.position);
      this._wire.renderOrder = 10;
      this.add(this._wire);
    }
    if (this._wire) this._wire.visible = on;
  }

  dispose() {
    all.delete(this);
    if (this._wire) {
      this._wire.geometry.dispose();
      this._wire.material.dispose();
    }
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

  /** Every hitbox along [ray], nearest first (one per target). */
  static pickAll(ray) {
    const hits = [];
    for (const hitbox of all) {
      const d = hitbox.rayDistance(ray);
      if (d >= 0) hits.push([d, hitbox]);
    }
    hits.sort((p, q) => p[0] - q[0]);
    const seen = new Set();
    const out = [];
    for (const [, hitbox] of hits) {
      const id = `${hitbox.kind}:${typeof hitbox.targetId === 'object' ? `${hitbox.targetId.def.id}@${hitbox.targetId.tile.x},${hitbox.targetId.tile.y}` : hitbox.targetId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(hitbox);
    }
    return out;
  }

  /** Draws the hitboxes [filter] (a key of HitboxFilter) picks. */
  static setDebugFilter(filter) {
    Hitbox.debugFilter = filter in HitboxFilter ? filter : 'off';
    for (const hitbox of all) hitbox._showWire(Hitbox._drawn(hitbox.kind));
  }

  /** F5: on to the next filter. */
  static cycleDebugFilter() {
    const keys = Object.keys(HitboxFilter);
    Hitbox.setDebugFilter(keys[(keys.indexOf(Hitbox.debugFilter) + 1) % keys.length]);
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
