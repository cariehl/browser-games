// The walker mech, drawn procedurally (no model file yet): hips and legs,
// the power core, the two-seat cockpit, the cannon and four armor plates.
// Each component is its own group, so the build on the gantry pad can show
// only what's been installed, and the finished mech is the same model with
// everything switched on.
//
// The model is 2 × 2 tiles, centred on its group, facing +z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, ball } from './decor_view.js';
import { color } from './tile_math.js';

const MATERIALS = () => ({
  hull: new THREE.MeshStandardMaterial({ color: color([0.82, 0.55, 0.25]), metalness: 0.45, roughness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: color([0.42, 0.44, 0.48]), metalness: 0.6, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: color([0.14, 0.15, 0.17]), roughness: 0.75 }),
  plate: new THREE.MeshStandardMaterial({ color: color([0.42, 0.55, 0.68]), metalness: 0.5, roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: color([0.25, 0.75, 0.95]), emissive: color([0.2, 0.6, 0.85]), emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }),
  core: new THREE.MeshStandardMaterial({ color: color([0.35, 1, 0.55]), emissive: color([0.3, 1, 0.5]), emissiveIntensity: 1.6 }),
  seat: new THREE.MeshStandardMaterial({ color: color([0.6, 0.35, 0.2]), roughness: 0.8 }),
});

function mesh(parts, material) {
  const m = new THREE.Mesh(mergeGeometries(parts), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function group(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) g.add(m);
  return g;
}

/** A leg hanging from its hip pivot at the origin, foot at -2.1. */
function leg(mat, side) {
  const g = group(
    mesh([box(0.36, 1.0, 0.4, 0, -0.5, 0), box(0.3, 0.9, 0.34, 0, -1.45, 0.08)], mat.metal),
    mesh([ball(0.2, 0, -1.0, 0.05), cyl(0.18, 0.18, 0.5, 0, 0, 0, 0, 0, Math.PI / 2)], mat.dark),
    mesh([box(0.6, 0.18, 0.8, 0, -2.0, 0.12)], mat.hull),
  );
  g.position.set(0.5 * side, 2.15, 0);
  return g;
}

/**
 * Builds the walker. Returns { root, parts, legs, body, gun } where parts is
 * component item id -> group (armor_plate: one group per plate).
 */
export function buildWalker() {
  const mat = MATERIALS();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const frame = group(
    mesh([box(1.3, 0.45, 0.8, 0, 2.2, 0), box(0.3, 1.0, 0.3, 0, 2.75, -0.15)], mat.metal),
    mesh([box(1.5, 0.18, 0.5, 0, 2.5, 0)], mat.hull),
  );
  const legs = [leg(mat, -1), leg(mat, 1)];
  const core = group(
    mesh([cyl(0.28, 0.28, 0.9, 0, 3.0, -0.55, Math.PI / 2, 0, 0, 12)], mat.metal),
    mesh([cyl(0.18, 0.18, 0.92, 0, 3.0, -0.55, Math.PI / 2, 0, 0, 12)], mat.core),
  );
  const shell = group(
    mesh([box(1.3, 0.8, 1.1, 0, 3.05, 0.15), box(1.1, 0.25, 0.9, 0, 3.55, 0.1)], mat.hull),
    mesh([box(0.9, 0.36, 0.06, 0, 3.15, 0.72)], mat.glass),
  );
  const interior = group(
    mesh([box(0.32, 0.2, 0.32, -0.25, 2.85, 0.35), box(0.32, 0.2, 0.32, 0.25, 2.85, 0.35), box(0.32, 0.4, 0.06, -0.25, 3.05, 0.2), box(0.32, 0.4, 0.06, 0.25, 3.05, 0.2)], mat.seat),
    mesh([box(0.6, 0.06, 0.12, 0, 3.0, 0.62)], mat.core),
  );
  const gun = group(
    mesh([box(0.3, 0.3, 0.5, 0, 0, 0), cyl(0.09, 0.09, 1.1, 0, 0.02, 0.75, Math.PI / 2, 0, 0, 8)], mat.dark),
    mesh([box(0.36, 0.08, 0.36, 0, -0.18, 0)], mat.hull),
  );
  gun.position.set(0.85, 3.3, 0.1);
  const plates = [
    [-0.78, 3.05, 0.15], [0.78, 2.5, 0.15], [0, 2.2, 0.48], [0, 3.6, -0.4],
  ].map(([x, y, z], i) => {
    const p = group(mesh([box(i < 2 ? 0.1 : 1.1, i < 2 ? 0.7 : 0.3, i < 2 ? 0.9 : 0.1, 0, 0, 0)], mat.plate));
    p.position.set(x, y, z);
    return p;
  });
  body.add(frame, core, shell, interior, gun, ...plates);
  root.add(...legs);
  // Scaffolding for the build on the pad: hidden on the finished mech.
  const scaffold = group(mesh([
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => box(0.08, 4.2, 0.08, x, 2.1, z)),
    box(2.1, 0.08, 0.08, 0, 4.2, -1), box(2.1, 0.08, 0.08, 0, 4.2, 1),
  ], mat.dark));
  scaffold.visible = false;
  root.add(scaffold);
  return {
    root, body, legs, gun, scaffold, materials: mat,
    parts: { mech_frame: [frame], mech_leg: legs, power_core: [core], cockpit_shell: [shell], cockpit_interior: [interior], weapon_mount: [gun], armor_plate: plates },
  };
}

/** Shows only the components in [installed] (item id -> count), for the build on the pad. */
export function showInstalled(walker, installed) {
  for (const [id, groups] of Object.entries(walker.parts)) {
    const n = installed ? (installed[id] || 0) : groups.length;
    groups.forEach((g, i) => { g.visible = i < n; });
  }
  walker.scaffold.visible = installed != null;
}

/**
 * Animates a walker each frame: the legs swing while it moves (from how
 * far it went this frame), the body bobs, and the gun kicks after a shot.
 */
export class WalkerAnimator {
  constructor(walker) {
    this.walker = walker;
    this._phase = 0;
    this._last = null;
    this._kick = 0;
    this._wake = 1;
  }

  fire() {
    this._kick = 1;
  }

  /** The power-up scene: it crouches, then stands up with its core flaring. */
  powerUp() {
    this._wake = 0;
  }

  update(delta, position) {
    const moved = this._last ? Math.hypot(position.x - this._last.x, position.z - this._last.z) : 0;
    this._last = { x: position.x, z: position.z };
    const w = this.walker;
    this._phase += moved * 2.2;
    const swing = moved > 0.0005 ? Math.sin(this._phase) * 0.45 : 0;
    w.legs[0].rotation.x += (swing - w.legs[0].rotation.x) * Math.min(1, delta * 12);
    w.legs[1].rotation.x += (-swing - w.legs[1].rotation.x) * Math.min(1, delta * 12);
    w.body.position.y = Math.abs(Math.sin(this._phase)) * 0.08;
    this._kick = Math.max(0, this._kick - delta * 4);
    w.gun.position.z = 0.1 - this._kick * 0.25;
    if (this._wake < 1) {
      this._wake = Math.min(1, this._wake + delta / 3);
      const t = this._wake;
      w.body.position.y -= (1 - Math.min(1, t * 1.5)) * 0.6;
      w.materials.core.emissiveIntensity = 1.6 + Math.sin(t * Math.PI) * 6;
      w.materials.glass.emissiveIntensity = 0.6 + Math.sin(t * Math.PI) * 2;
    }
  }
}
