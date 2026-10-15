// Decor: the props the map scatters about (scrap piles, lamps, cables,
// dead trees, puddles...). They block nothing and aren't part of the sim;
// the client draws them straight from the map file.
//
// Each kind is a little procedural model built from boxes, cylinders and
// cones, merged per material and drawn as InstancedMeshes, so hundreds of
// props cost a few draw calls. Each copy gets a turn and a size from its
// tile, so they never look copy-pasted and never change between visits.
// Glowing props (lamps, crystals, glowcaps) light their surroundings
// through a small pool of point lights kept on the ones nearest the camera.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tileToWorld, color, darkened, seeded } from './tile_math.js';

/** Point lights shared by every glowing prop: the nearest this many are lit. */
const LIGHTS = 8;

export const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
export const cyl = (r1, r2, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) => place(new THREE.CylinderGeometry(r1, r2, h, seg), x, y, z, rx, ry, rz);
export const cone = (r, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 6) => place(new THREE.ConeGeometry(r, h, seg), x, y, z, rx, ry, rz);
export const ball = (r, x = 0, y = 0, z = 0, sy = 1) => {
  const g = new THREE.SphereGeometry(r, 10, 7);
  g.scale(1, sy, 1);
  return place(g, x, y, z);
};
export const torus = (r, t, x = 0, y = 0, z = 0, rx = 0) => place(new THREE.TorusGeometry(r, t, 6, 14), x, y, z, rx);

export function place(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  geometry.rotateX(rx);
  geometry.rotateY(ry);
  geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  // Merging needs every part to have the same attributes.
  if (geometry.index) geometry = geometry.toNonIndexed();
  geometry.deleteAttribute('uv');
  return geometry;
}

/** Parts of each shape: { base, dark, accent, glow } -> geometries, built at the origin of its tile. */
const SHAPES = {
  scrap_pile: (r) => ({
    base: [0, 1, 2, 3].map(() => box(r.range(0.2, 0.45), r.range(0.08, 0.25), r.range(0.15, 0.4), r.range(-0.25, 0.25), r.range(0.04, 0.14), r.range(-0.25, 0.25), r.range(-0.4, 0.4), r.range(0, 3), r.range(-0.4, 0.4))),
    dark: [box(0.04, 0.5, 0.04, r.range(-0.15, 0.15), 0.18, r.range(-0.15, 0.15), r.range(-0.6, 0.6), 0, r.range(-0.6, 0.6))],
  }),
  cable: (r) => ({
    base: [0, 1, 2].map((i) => cyl(0.025, 0.025, 0.9, (i - 1) * 0.12, 0.03, r.range(-0.1, 0.1), 0, r.range(-0.3, 0.3), Math.PI / 2, 5)),
  }),
  lamp: () => ({
    base: [cyl(0.04, 0.05, 1.7, 0, 0.85, 0), box(0.3, 0.06, 0.3, 0, 0.03, 0), box(0.06, 0.06, 0.35, 0, 1.68, 0.12)],
    glow: [box(0.16, 0.08, 0.16, 0, 1.62, 0.28)],
  }),
  puddle: (r) => ({
    accent: [place(new THREE.CircleGeometry(r.range(0.3, 0.45), 14), 0, 0.012, 0, -Math.PI / 2)],
  }),
  sign: () => ({
    base: [box(0.05, 0.9, 0.05, 0, 0.45, 0)],
    accent: [box(0.42, 0.42, 0.03, 0, 0.85, 0.03, 0, 0, Math.PI / 4)],
  }),
  dead_tree: (r) => ({
    base: [cyl(0.05, 0.11, 1.6, 0, 0.8, 0, r.range(-0.1, 0.1), 0, r.range(-0.1, 0.1), 6),
      cyl(0.025, 0.05, 0.7, 0.18, 1.2, 0, 0, 0, -0.9, 5), cyl(0.02, 0.04, 0.6, -0.15, 1.35, 0.05, 0.2, 0, 0.8, 5),
      cyl(0.02, 0.035, 0.5, 0.02, 1.5, -0.15, -0.8, 0, 0, 5)],
  }),
  crate: (r) => ({
    base: [box(0.5, 0.42, 0.5, 0, 0.21, 0), ...(r.next() < 0.5 ? [box(0.36, 0.3, 0.36, r.range(-0.05, 0.05), 0.57, r.range(-0.05, 0.05), 0, r.range(0, 1), 0)] : [])],
    dark: [box(0.52, 0.05, 0.52, 0, 0.21, 0)],
  }),
  barrel: () => ({
    base: [cyl(0.22, 0.22, 0.6, 0, 0.3, 0, 0, 0, 0, 12)],
    accent: [cyl(0.225, 0.225, 0.06, 0, 0.15, 0, 0, 0, 0, 12), cyl(0.225, 0.225, 0.06, 0, 0.45, 0, 0, 0, 0, 12)],
  }),
  girder: (r) => ({
    base: [box(1.6, 0.12, 0.14, 0, 0.18, 0, 0, 0, r.range(0.05, 0.2)), box(1.6, 0.04, 0.3, 0, 0.11, 0, 0, 0, r.range(0.05, 0.2)), box(1.6, 0.04, 0.3, 0, 0.26, 0, 0, 0, r.range(0.05, 0.2))],
  }),
  pipe: () => ({
    base: [cyl(0.14, 0.14, 1.4, 0, 0.14, 0, 0, 0, Math.PI / 2, 10)],
    dark: [torus(0.15, 0.03, 0.6, 0.14, 0, 0).rotateY(Math.PI / 2)],
  }),
  tire: (r) => ({
    base: [torus(0.26, 0.09, 0, 0.09, 0, -Math.PI / 2 + r.range(-0.1, 0.1))],
  }),
  bones: (r) => ({
    base: [0, 1, 2, 3, 4].map(() => cyl(0.025, 0.025, r.range(0.3, 0.6), r.range(-0.3, 0.3), 0.03, r.range(-0.3, 0.3), Math.PI / 2, r.range(0, 3), 0, 5)),
    dark: [box(0.22, 0.16, 0.2, 0, 0.08, 0)],
  }),
  tuft: (r) => ({
    base: [0, 1, 2, 3, 4, 5].map(() => cone(0.05, r.range(0.25, 0.5), r.range(-0.25, 0.25), 0.15, r.range(-0.25, 0.25), r.range(-0.4, 0.4), 0, r.range(-0.4, 0.4), 4)),
  }),
  crystal: (r) => ({
    glow: [0, 1, 2].map((i) => cone(0.09, r.range(0.5, 0.9), (i - 1) * 0.14, 0.3, r.range(-0.08, 0.08), r.range(-0.3, 0.3), 0, r.range(-0.4, 0.4), 5)),
    base: [box(0.4, 0.1, 0.3, 0, 0.05, 0)],
  }),
  mushroom: (r) => ({
    base: [0, 1, 2].map((i) => cyl(0.03, 0.04, 0.35 + i * 0.12, (i - 1) * 0.15, (0.35 + i * 0.12) / 2, r.range(-0.1, 0.1), 0, 0, 0, 6)),
    glow: [0, 1, 2].map((i) => ball(0.12 + i * 0.03, (i - 1) * 0.15, 0.35 + i * 0.12, 0, 0.45)),
  }),
  banner: () => ({
    base: [cyl(0.03, 0.03, 2.2, 0, 1.1, 0, 0, 0, 0, 6)],
    accent: [box(0.5, 0.8, 0.02, 0.26, 1.7, 0)],
  }),
  console: () => ({
    base: [box(0.5, 0.8, 0.35, 0, 0.4, 0), box(0.5, 0.06, 0.4, 0, 0.82, 0.05, 0.4, 0, 0)],
    glow: [box(0.36, 0.2, 0.02, 0, 0.62, 0.18)],
  }),
  conveyor: () => ({
    base: [box(1, 0.08, 0.6, 0, 0.42, 0)],
    dark: [box(0.06, 0.4, 0.06, -0.42, 0.2, -0.24), box(0.06, 0.4, 0.06, 0.42, 0.2, -0.24), box(0.06, 0.4, 0.06, -0.42, 0.2, 0.24), box(0.06, 0.4, 0.06, 0.42, 0.2, 0.24)],
    accent: [box(1, 0.03, 0.04, 0, 0.47, -0.28), box(1, 0.03, 0.04, 0, 0.47, 0.28)],
  }),
  skull: (r) => ({
    base: [box(0.6, 0.45, 0.5, 0, 0.22, 0, r.range(-0.2, 0.2), 0, r.range(-0.3, 0.3)), box(0.5, 0.15, 0.3, 0, 0.06, 0.32)],
    glow: [box(0.12, 0.06, 0.04, -0.13, 0.3, 0.26), box(0.12, 0.06, 0.04, 0.13, 0.3, 0.26)],
  }),
  stones: (r) => ({
    base: [0, 1, 2, 3].map(() => ball(r.range(0.07, 0.16), r.range(-0.3, 0.3), 0.04, r.range(-0.3, 0.3), 0.6)),
  }),
  flower: (r) => ({
    base: [0, 1, 2].map((i) => cyl(0.012, 0.015, 0.4 + i * 0.1, (i - 1) * 0.1, 0.2 + i * 0.05, r.range(-0.1, 0.1), 0, 0, r.range(-0.2, 0.2), 4)),
    accent: [0, 1, 2].map((i) => ball(0.06, (i - 1) * 0.1, 0.42 + i * 0.1, 0, 0.7)),
  }),
  antenna: () => ({
    base: [cyl(0.03, 0.06, 2.6, 0, 1.3, 0, 0, 0, 0, 5), box(0.5, 0.03, 0.03, 0, 2.1, 0), box(0.35, 0.03, 0.03, 0, 2.35, 0, 0, Math.PI / 2, 0)],
    dark: [box(0.4, 0.2, 0.4, 0, 0.1, 0)],
    glow: [ball(0.05, 0, 2.62, 0)],
  }),
};

/**
 * Builds every decor prop in [world]. Returns { group, lights }; call
 * lights.update(focus) each frame to light the props nearest the camera.
 */
export function buildDecor(world) {
  const group = new THREE.Group();
  const byDef = new Map();
  for (const d of world.decor) {
    if (!byDef.has(d.def)) byDef.set(d.def, []);
    byDef.get(d.def).push(d.tile);
  }
  const glowSpots = [];
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [def, tiles] of byDef) {
    const make = SHAPES[def.shape] || SHAPES.scrap_pile;
    // A few variants per kind, so piles differ in shape, not just in turn.
    const variants = [0, 1, 2].map((v) => make(seeded(def.id.length * 131 + v * 17)));
    const materials = {
      base: new THREE.MeshStandardMaterial({ color: color(def.color), roughness: 0.85, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: color(darkened(def.color, 0.45)), roughness: 0.9 }),
      accent: new THREE.MeshStandardMaterial({ color: color(def.accent), roughness: 0.5, metalness: 0.1 }),
      glow: new THREE.MeshStandardMaterial({ color: color(def.accent), emissive: color(def.accent), emissiveIntensity: 1.8 }),
    };
    if (def.shape === 'puddle') {
      materials.accent.roughness = 0.1;
      materials.accent.metalness = 0.4;
      if (def.light) {
        materials.accent.emissive = color(def.accent);
        materials.accent.emissiveIntensity = 1.2;
      }
    }
    variants.forEach((parts, v) => {
      const mine = tiles.filter((t) => (t.x * 3 + t.y * 5) % 3 === v);
      if (mine.length === 0) return;
      for (const [key, geometries] of Object.entries(parts)) {
        if (!geometries.length) continue;
        const geometry = mergeGeometries(geometries);
        geometry.computeVertexNormals();
        const mesh = new THREE.InstancedMesh(geometry, materials[key], mine.length);
        mine.forEach((tile, i) => {
          const r = seeded(tile.x * 4271 + tile.y * 7349);
          tileToWorld(tile, 0, at);
          at.x += r.range(-0.18, 0.18);
          at.z += r.range(-0.18, 0.18);
          turn.setFromAxisAngle(up, r.range(0, Math.PI * 2));
          scale.setScalar(def.scale * r.range(0.85, 1.15));
          matrix.compose(at, turn, scale);
          mesh.setMatrixAt(i, matrix);
        });
        mesh.castShadow = key !== 'glow' && def.shape !== 'puddle';
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    });
    if (def.light) for (const tile of tiles) glowSpots.push({ at: tileToWorld(tile, def.shape === 'lamp' ? 1.5 : 0.6), light: def.light });
  }
  return { group, lights: new LightPool(group, glowSpots) };
}

/** A few point lights, moved each frame onto the glowing props nearest the camera. */
class LightPool {
  constructor(parent, spots) {
    this.spots = spots;
    this.lights = [];
    for (let i = 0; i < Math.min(LIGHTS, spots.length); i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 1.6);
      parent.add(light);
      this.lights.push(light);
    }
  }

  update(focus) {
    if (this.lights.length === 0) return;
    const nearest = this.spots
      .map((spot) => ({ spot, d: spot.at.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lights.length);
    this.lights.forEach((light, i) => {
      const entry = nearest[i];
      if (!entry || entry.d > 40 * 40) {
        light.intensity = 0;
        return;
      }
      const { at, light: spec } = entry.spot;
      light.position.copy(at);
      light.color.copy(color(spec.color));
      light.intensity = spec.intensity;
      light.distance = spec.distance;
    });
  }
}
