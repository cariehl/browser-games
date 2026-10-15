// Procedural models for stations that have no model file: hatches, lifts,
// gates, the gantry console, hab furniture, puzzle machines, landmarks.
// Same parts as decor (see decor_view.js), but each station is its own
// small group, since there are only a few of each.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, cone, ball, torus } from './decor_view.js';
import { color, darkened } from './tile_math.js';

const posts = (h, w, d, r = 0.05) => [[-w, -d], [w, -d], [-w, d], [w, d]].map(([x, z]) => box(r, h, r, x, h / 2, z));

/** Parts of each shape: { base, dark, accent, glow } -> geometries, at the origin of its tile. */
const SHAPES = {
  hatch: () => ({
    base: [box(0.9, 0.12, 0.12, 0, 0.06, -0.42), box(0.9, 0.12, 0.12, 0, 0.06, 0.42), box(0.12, 0.12, 0.9, -0.42, 0.06, 0), box(0.12, 0.12, 0.9, 0.42, 0.06, 0)],
    dark: [box(0.74, 0.02, 0.74, 0, 0.02, 0), box(0.74, 0.06, 0.74, 0, 0.32, -0.5, -1.2, 0, 0)],
    accent: [box(0.06, 0.6, 0.06, 0.48, 0.3, 0.48)],
    glow: [box(0.12, 0.08, 0.12, 0.48, 0.64, 0.48)],
  }),
  ladder: () => ({
    base: [box(0.06, 2.6, 0.06, -0.22, 1.3, 0), box(0.06, 2.6, 0.06, 0.22, 1.3, 0), ...[0.3, 0.7, 1.1, 1.5, 1.9, 2.3].map((y) => box(0.44, 0.04, 0.04, 0, y, 0))],
    glow: [box(0.6, 0.04, 0.6, 0, 2.62, 0)],
  }),
  lift: () => ({
    base: [box(1, 0.1, 1, 0, 0.05, 0), ...posts(2.4, 0.45, 0.45, 0.07), box(1, 0.08, 0.08, 0, 2.4, -0.45), box(1, 0.08, 0.08, 0, 2.4, 0.45)],
    dark: [box(0.08, 3.2, 0.08, 0, 1.6, -0.48)],
    accent: [box(1, 0.04, 0.04, 0, 1.0, 0.45), box(0.04, 0.04, 1, 0.45, 1.0, 0)],
    glow: [box(0.12, 0.12, 0.12, 0, 2.5, 0)],
  }),
  gate: () => ({
    base: [box(0.22, 2.4, 0.22, -0.5, 1.2, 0), box(0.22, 2.4, 0.22, 0.5, 1.2, 0), box(1.3, 0.25, 0.25, 0, 2.4, 0)],
    dark: [box(0.8, 1.9, 0.06, 0, 0.95, 0)],
    accent: [0, 1, 2, 3].map((i) => box(0.8, 0.1, 0.07, 0, 0.3 + i * 0.45, 0, 0, 0, 0.3)),
    glow: [box(0.5, 0.08, 0.27, 0, 2.4, 0)],
  }),
  gantry: () => ({
    base: [box(0.6, 0.9, 0.45, 0, 0.45, 0), box(0.6, 0.06, 0.45, 0, 0.95, 0.06, 0.45, 0, 0), box(0.12, 2.8, 0.12, -0.25, 1.4, -0.2), box(1.6, 0.12, 0.12, 0.55, 2.75, -0.2)],
    dark: [cyl(0.03, 0.03, 0.9, 1.25, 2.3, -0.2, 0, 0, 0, 5)],
    accent: [box(0.2, 0.15, 0.2, 1.25, 1.8, -0.2)],
    glow: [box(0.44, 0.24, 0.02, 0, 0.75, 0.24)],
  }),
  fabricator: () => ({
    base: [box(0.9, 0.5, 0.7, 0, 0.25, 0), ...posts(1.4, 0.4, 0.3), box(0.9, 0.08, 0.7, 0, 1.4, 0)],
    dark: [box(0.1, 0.4, 0.1, 0.1, 1.15, 0)],
    accent: [box(0.9, 0.06, 0.06, 0, 1.2, 0)],
    glow: [box(0.5, 0.02, 0.4, 0, 0.52, 0), cone(0.04, 0.1, 0.1, 0.9, 0, Math.PI)],
  }),
  board: () => ({
    base: [box(0.08, 1.6, 0.08, -0.45, 0.8, 0), box(0.08, 1.6, 0.08, 0.45, 0.8, 0)],
    dark: [box(1, 0.8, 0.05, 0, 1.15, 0)],
    accent: [box(0.22, 0.28, 0.02, -0.25, 1.25, 0.04), box(0.22, 0.24, 0.02, 0.05, 1.05, 0.04), box(0.2, 0.3, 0.02, 0.3, 1.25, 0.04)],
    glow: [box(0.9, 0.04, 0.06, 0, 1.6, 0.04)],
  }),
  trophy_wall: () => ({
    base: [box(1, 1.7, 0.12, 0, 0.85, -0.35)],
    dark: [box(0.2, 0.14, 0.12, -0.3, 1.3, -0.25), box(0.2, 0.14, 0.12, 0.3, 1.3, -0.25), box(0.2, 0.14, 0.12, 0, 0.8, -0.25)],
    accent: [box(1, 0.06, 0.16, 0, 1.68, -0.33)],
  }),
  vault: () => ({
    base: [box(1, 1.6, 0.8, 0, 0.8, 0)],
    dark: [cyl(0.42, 0.42, 0.06, 0, 0.8, 0.41, Math.PI / 2, 0, 0, 16)],
    accent: [torus(0.42, 0.05, 0, 0.8, 0.43, 0), box(0.5, 0.06, 0.04, 0, 0.8, 0.46)],
    glow: [box(0.12, 0.12, 0.03, 0.38, 1.4, 0.41)],
  }),
  door: () => ({
    base: [box(1, 2.2, 0.5, 0, 1.1, 0)],
    accent: [0, 1, 2, 3, 4].map((i) => box(0.12, 0.6, 0.52, -0.4 + i * 0.2, 0.4, 0, 0, 0, 0.6)),
    glow: [box(0.3, 0.08, 0.52, 0, 2.0, 0)],
  }),
  rig: () => ({
    base: [box(0.9, 0.3, 0.9, 0, 0.15, 0), box(0.14, 2.2, 0.14, -0.3, 1.1, -0.3), box(1.4, 0.12, 0.12, 0.35, 2.2, -0.3)],
    dark: [cyl(0.02, 0.02, 0.9, 0.95, 1.75, -0.3, 0, 0, 0, 5)],
    accent: [box(0.3, 0.2, 0.3, 0.95, 1.25, -0.3), box(0.5, 0.25, 0.4, 0.15, 0.42, 0.2)],
    glow: [box(0.14, 0.14, 0.14, -0.3, 2.3, -0.3)],
  }),
  winch: () => ({
    base: [box(0.12, 0.7, 0.12, -0.35, 0.35, 0), box(0.12, 0.7, 0.12, 0.35, 0.35, 0), box(0.9, 0.12, 0.6, 0, 0.06, 0)],
    dark: [cyl(0.2, 0.2, 0.6, 0, 0.55, 0, 0, 0, Math.PI / 2, 12)],
    accent: [torus(0.2, 0.03, 0.45, 0.55, 0, 0).rotateY(Math.PI / 2), box(0.05, 0.3, 0.05, 0.5, 0.75, 0.1)],
  }),
  valve: () => ({
    base: [cyl(0.12, 0.12, 1.1, 0, 0.55, 0, 0, 0, 0, 10), cyl(0.12, 0.12, 0.8, 0.4, 0.2, 0, 0, 0, Math.PI / 2, 10)],
    accent: [torus(0.25, 0.035, 0, 1.0, 0.18, 0)],
    glow: [box(0.1, 0.1, 0.02, 0, 0.7, 0.13)],
  }),
  projector: () => ({
    base: [cyl(0.05, 0.08, 1.2, 0, 0.6, 0, 0, 0, 0, 8), box(0.3, 0.06, 0.3, 0, 0.03, 0)],
    dark: [box(0.26, 0.2, 0.3, 0, 1.25, 0)],
    glow: [cyl(0.07, 0.07, 0.04, 0, 1.25, 0.16, Math.PI / 2, 0, 0, 10)],
  }),
  pylon: () => ({
    base: [box(0.5, 0.15, 0.5, 0, 0.07, 0), cyl(0.06, 0.1, 1.8, 0, 0.9, 0, 0, 0, 0, 6)],
    accent: [torus(0.22, 0.03, 0, 1.4, 0, -Math.PI / 2)],
    glow: [ball(0.1, 0, 1.9, 0)],
  }),
};

/** Whether there's a procedural model called [shape]. */
export function hasShape(shape) {
  return !!shape && shape in SHAPES;
}

/** A group drawing [def] as its shape, coloured from def.color. */
export function buildShape(def) {
  const parts = SHAPES[def.shape]();
  const group = new THREE.Group();
  const accent = def.accent || [1, 0.65, 0.2, 1];
  const materials = {
    base: new THREE.MeshStandardMaterial({ color: color(def.color), roughness: 0.8, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: color(darkened(def.color, 0.4)), roughness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: color(accent), roughness: 0.5, metalness: 0.2 }),
    glow: new THREE.MeshStandardMaterial({ color: color(accent), emissive: color(accent), emissiveIntensity: 1.6 }),
  };
  for (const [key, geometries] of Object.entries(parts)) {
    if (!geometries.length) continue;
    const geometry = mergeGeometries(geometries);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.castShadow = key !== 'glow';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
