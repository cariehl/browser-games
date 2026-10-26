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
import { SceneryHitbox } from './hitbox.js';

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
/** A lumpy low-poly rock: an icosahedron squashed by [sx, sy, sz]. */
export const rock = (radius, x = 0, y = 0, z = 0, sx = 1, sy = 0.7, sz = 1, ry = 0) => {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  g.scale(sx, sy, sz);
  return place(g, x, y, z, 0, ry, 0);
};
/** A tapering column with its faces knocked about: a rock spire [height] tall. */
const jagged = (bottom, top, height, r) => {
  const g = new THREE.CylinderGeometry(top, bottom, height, 6, 4);
  const p = g.attributes.position;
  const nudge = new Map();
  for (let i = 0; i < p.count; i++) {
    // The same corner always moves the same way, so the seam stays closed.
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!nudge.has(k)) nudge.set(k, [r.range(0.75, 1.2), r.range(-0.12, 0.12)]);
    const [s, dy] = nudge.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) + dy * height * 0.25, p.getZ(i) * s);
  }
  return place(g, 0, height / 2 - 0.2, 0, 0, r.range(0, 3), 0);
};
/** Half a ring standing upright across x: one rib of a titan's chest. */
const arch = (radius, tube, z, lean) => place(new THREE.TorusGeometry(radius, tube, 5, 9, Math.PI), 0, -0.15, z, 0, 0, lean);

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
  // Big scenery, mostly for the land beyond the maps' edges (data/scenery.json).
  boulder: (r) => ({
    base: [rock(0.55, 0, 0.22, 0, r.range(0.9, 1.2), r.range(0.6, 0.85), r.range(0.8, 1.05), r.range(0, 3)),
      ...(r.next() < 0.6 ? [rock(0.3, r.range(0.35, 0.5), 0.1, r.range(-0.3, 0.3), 1, 0.7, 1, r.range(0, 3))] : [])],
  }),
  /** A tall, broken pillar of rock. */
  rock_spire: (r) => ({
    base: [jagged(0.85, 0.22, r.range(2.6, 3.6), r), rock(0.4, r.range(0.55, 0.75), 0.15, r.range(-0.4, 0.4), 1, 0.7, 1, r.range(0, 3))],
  }),
  scrub_tree: (r) => ({
    accent: [cyl(0.07, 0.13, 1.1, 0, 0.55, 0, r.range(-0.08, 0.08), 0, r.range(-0.08, 0.08), 6)],
    base: [rock(0.55, 0, 1.35, 0, 1, 0.75, 1, r.range(0, 3)), rock(0.4, r.range(0.25, 0.4), 1.15, r.range(-0.2, 0.2), 1, 0.8, 1), rock(0.38, r.range(-0.4, -0.25), 1.2, r.range(-0.2, 0.2), 1, 0.8, 1)],
  }),
  pine: (r) => ({
    accent: [cyl(0.06, 0.1, 0.8, 0, 0.4, 0, 0, 0, 0, 6)],
    base: [cone(0.62, 0.95, 0, 0.95, 0, 0, r.range(0, 1), 0, 7), cone(0.48, 0.85, 0, 1.45, 0, 0, r.range(0, 1), 0, 7), cone(0.32, 0.75, 0, 1.95, 0, 0, r.range(0, 1), 0, 7)],
  }),
  /** A titan's head, half sunk in the ground: about two tiles across, its eyes not quite out. */
  titan_skull: (r) => {
    const t = r.range(-0.18, 0.18);
    const z = r.range(-0.15, 0.15);
    return {
      base: [cyl(1.05, 1.05, 1.8, 0, 0.55, 0, Math.PI / 2 + t, 0, z, 8), box(0.5, 0.3, 1.9, 0, 1.6, -0.05, t, 0, z), box(2.1, 0.3, 0.45, 0, 1.08, 0.86, t, 0, z),
        box(1.5, 0.5, 0.8, 0, -0.1, 1.05, t + 0.35, 0, z), cyl(0.36, 0.36, 0.3, 1.08, 0.6, 0, 0, 0, Math.PI / 2 + z, 8),
        cyl(0.36, 0.36, 0.3, -1.08, 0.6, 0, 0, 0, Math.PI / 2 + z, 8)],
      dark: [box(1.75, 0.45, 0.16, 0, 0.72, 0.9, t, 0, z), ...[-0.45, -0.15, 0.15, 0.45].map((x) => box(0.1, 0.4, 0.1, x, 0.05, 1.42, t + 0.35, 0, z)),
        cyl(0.04, 0.06, 1.2, 0.6, 1.6, -0.5, r.range(-0.5, 0.5), 0, r.range(-0.6, 0.2), 5)],
      glow: [box(0.34, 0.16, 0.06, -0.45, 0.72, 0.98, t, 0, z), box(0.34, 0.16, 0.06, 0.45, 0.72, 0.98, t, 0, z)],
    };
  },
  /** A titan's chest: ribs arching out of the ground along a buried spine. */
  titan_ribs: (r) => ({
    base: [0, 1, 2, 3, 4].map((i) => arch(1.25 + Math.sin((i / 4) * Math.PI) * 0.45 + r.range(-0.1, 0.1), 0.11, -1.8 + i * 0.9, r.range(-0.12, 0.12))),
    dark: [box(0.4, 0.35, 4.4, 0, 0, 0, 0, 0, r.range(-0.1, 0.1)), ...[0, 1, 2, 3, 4].map((i) => box(0.5, 0.25, 0.3, 0, 0.12, -1.8 + i * 0.9))],
  }),
  /** A titan's fallen arm, its claw reaching up. */
  titan_arm: (r) => ({
    base: [box(0.7, 0.6, 2.6, -0.5, 0.25, -1.6, 0, 0.25, 0), box(0.6, 0.55, 2.2, 0.35, 0.55, 0.65, -0.3, -0.3, 0),
      box(0.9, 0.35, 0.8, 0.75, 1.0, 1.75, -0.6, -0.3, 0),
      ...[-0.3, 0, 0.3].map((x) => box(0.14, 0.95, 0.16, 0.75 + x, 1.55, 2.05 + r.range(-0.1, 0.1), r.range(0.2, 0.5), 0, x * 0.8))],
    dark: [cyl(0.42, 0.42, 0.75, -0.1, 0.35, -0.2, 0, 0, Math.PI / 2, 10), cyl(0.07, 0.07, 2, 0.1, 0.85, 0.5, -0.3, -0.3, 0, 6)],
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
  const up = new THREE.Vector3(0, 1, 0);
  const props = world.decor.map(({ def, tile }) => {
    // Each copy gets a nudge, a turn and a size from its tile.
    const r = seeded(tile.x * 4271 + tile.y * 7349);
    const at = tileToWorld(tile, 0);
    at.x += r.range(-0.18, 0.18);
    at.z += r.range(-0.18, 0.18);
    return { def, tile, at, turn: new THREE.Quaternion().setFromAxisAngle(up, r.range(0, Math.PI * 2)), scale: def.scale * r.range(0.85, 1.15) };
  });
  return buildProps(props);
}

/**
 * Draws [props], each { def, tile, at, turn, scale, big, hitbox }: [at] a Vector3
 * on the ground, [turn] a Quaternion, [tile] the tile it's filed under (for
 * its variant and clickable box). [big] props get a clickable box as large
 * as they are; map props keep theirs inside their tile. [hitbox] false: not
 * clickable at all. Returns { group, lights }.
 */
export function buildProps(props) {
  const group = new THREE.Group();
  const byDef = new Map();
  for (const p of props) {
    if (!byDef.has(p.def)) byDef.set(p.def, []);
    byDef.get(p.def).push(p);
  }
  const glowSpots = [];
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  for (const [def, mine] of byDef) {
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
      const these = mine.filter((p) => (((p.tile.x * 3 + p.tile.y * 5) % 3) + 3) % 3 === v);
      if (these.length === 0) return;
      const bounds = new THREE.Box3();
      for (const [key, geometries] of Object.entries(parts)) {
        if (!geometries.length) continue;
        const geometry = mergeGeometries(geometries);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        bounds.union(geometry.boundingBox);
        const mesh = new THREE.InstancedMesh(geometry, materials[key], these.length);
        these.forEach((p, i) => {
          scale.setScalar(p.scale);
          matrix.compose(p.at, p.turn, scale);
          mesh.setMatrixAt(i, matrix);
        });
        mesh.castShadow = key !== 'glow' && def.shape !== 'puddle';
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      if (def.inspect) for (const p of these) if (p.hitbox !== false) group.add(sceneryHitbox(def, p.tile, bounds, p.scale, false, p.big ? p.at : null));
    });
    if (def.light) for (const p of mine) glowSpots.push({ at: p.at.clone().setY(p.at.y + (def.shape === 'lamp' ? 1.5 : 0.6)), light: def.light });
  }
  return { group, lights: new LightPool(group, glowSpots) };
}

/**
 * A clickable box over a prop on [tile], from its model's [bounds]: square
 * (props are turned at random), at most a tile across, never too small to hit.
 * With [at] (a big prop, off the map) it's centred there and as large as the prop.
 */
export function sceneryHitbox(def, tile, bounds, scale = 1, terrain = false, at = null) {
  const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * scale;
  const across = at ? Math.max(size * 0.8, 0.45) : THREE.MathUtils.clamp(size, 0.45, 1);
  const height = Math.max(bounds.max.y * scale, 0.3);
  const center = at ? at.clone().setY(at.y + height / 2) : tileToWorld(tile, height / 2);
  return new SceneryHitbox({ def, tile, terrain }, new THREE.Vector3(across, height, across), center);
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
