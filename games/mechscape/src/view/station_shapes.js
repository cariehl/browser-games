// Procedural models for stations that have no model file: hatches, lifts,
// gates, the gantry console, hab furniture, puzzle machines, landmarks.
// Same parts as decor (see decor_view.js), but each station is its own
// small group, since there are only a few of each.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, cone, ball, torus, rock, place } from './decor_view.js';
import { color, darkened } from './tile_math.js';

/** A round strut from point [a] to point [b] ([x, y, z] each). */
const strut = (a, b, r) => {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, from.distanceTo(to), 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  const mid = from.add(to).multiplyScalar(0.5);
  return place(g, mid.x, mid.y, mid.z);
};
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
    accent: [cyl(0.24, 0.24, 0.05, 0.33, 0.55, 0, 0, 0, Math.PI / 2, 12), cyl(0.24, 0.24, 0.05, -0.33, 0.55, 0, 0, 0, Math.PI / 2, 12), box(0.05, 0.3, 0.05, 0.5, 0.75, 0.1)],
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
  // The crashed lander the first pilots came down in: a scorched capsule
  // leaning over, half sunk, one leg buckled, the hatch blown off and the
  // manufactory still glowing inside.
  lander: () => {
    const hull = [
      cyl(0.62, 0.85, 0.7, 0, 0.35, 0, 0, 0, 0, 8),
      cyl(0.34, 0.62, 0.6, 0, 1.0, 0, 0, 0, 0, 8),
    ];
    const dark = [
      cyl(0.87, 0.87, 0.1, 0, 0.06, 0, 0, 0, 0, 8),
      cyl(0.2, 0.34, 0.18, 0, 1.39, 0, 0, 0, 0, 8),
      cyl(0.3, 0.42, 0.25, 0, -0.1, 0, 0, 0, 0, 8),
      // Landing legs: two still braced, one buckled under.
      box(0.08, 0.08, 0.75, 0.62, 0.22, 0.42, -0.5, -0.9, 0),
      box(0.08, 0.08, 0.75, -0.62, 0.22, 0.42, -0.5, 0.9, 0),
      box(0.08, 0.08, 0.5, 0, 0.08, -0.85, 0.2, 0, 0),
    ];
    const accent = [
      box(0.44, 0.06, 0.06, 0, 0.78, 0.74),
      box(0.06, 0.5, 0.06, -0.22, 0.52, 0.76),
      box(0.06, 0.5, 0.06, 0.22, 0.52, 0.76),
      cyl(0.015, 0.015, 0.7, 0.1, 1.7, 0, 0, 0, 0.55, 5),
    ];
    const glow = [
      box(0.34, 0.46, 0.03, 0, 0.52, 0.74),
      box(0.3, 0.07, 0.04, 0, 1.02, 0.46, -0.46, 0, 0),
      ball(0.04, -0.2, 1.98, 0),
    ];
    // The whole capsule leans over and sits sunk in the ground.
    for (const g of [...hull, ...dark, ...accent, ...glow]) {
      g.rotateZ(0.3);
      g.rotateX(0.12);
      g.translate(0.15, -0.12, 0);
    }
    const debris = [
      // The hatch, blown off and lying in the dirt, and bits of the hull.
      box(0.4, 0.05, 0.5, 0.75, 0.04, 1.2, 0, 0.5, 0.1),
      box(0.22, 0.14, 0.18, -0.85, 0.07, 0.75, 0, 0.7, 0),
      box(0.3, 0.1, 0.12, 1.05, 0.05, -0.3, 0, -0.4, 0.2),
    ];
    // Big enough to read as a ship from across the Reach.
    for (const g of [...hull, ...dark, ...accent, ...glow, ...debris]) g.scale(1.45, 1.45, 1.45);
    return { base: hull, dark: [...dark, ...debris], accent, glow };
  },
  // --- Landmarks on the Quiet Reach (see sim/survey.js) ---
  /** A colossus's skull, sunk to the cheekbones: a dome, a brow, dead eye sockets with a last flicker in them. */
  colossus_skull: () => {
    const lean = 0.18;
    const base = [
      ball(0.95, 0, 0.55, -0.1, 0.78),
      box(1.7, 0.32, 0.5, 0, 0.92, 0.62, lean, 0, 0.04),
      box(1.3, 0.38, 0.5, 0, 0.1, 0.85, lean + 0.3, 0, 0),
    ];
    const dark = [
      cyl(0.27, 0.22, 0.3, -0.42, 0.62, 0.82, Math.PI / 2 + lean, 0, 0, 8),
      cyl(0.27, 0.22, 0.3, 0.42, 0.62, 0.82, Math.PI / 2 + lean, 0, 0, 8),
      // A crack across the dome, and teeth along the buried jaw.
      box(0.06, 0.06, 1.2, 0.35, 1.18, -0.1, 0.2, 0.5, 0.3),
      ...[-0.45, -0.15, 0.15, 0.45].map((x) => box(0.12, 0.3, 0.12, x, 0.02, 1.12, lean + 0.3, 0, 0)),
    ];
    const glow = [ball(0.07, -0.42, 0.62, 0.95), ball(0.04, 0.42, 0.6, 0.95)];
    for (const g of [...base, ...dark, ...glow]) g.scale(1.15, 1.15, 1.15);
    return { base, dark, glow };
  },
  /** The relay mast: a three-legged lattice tower with a dish, still blinking on top. */
  relay_mast: () => {
    const h = 3.6;
    const base = [box(0.9, 0.12, 0.9, 0, 0.06, 0)];
    const dark = [];
    // Three legs leaning in from a wide footing to a narrow top, braced in zigzags.
    const corner = (i, y) => {
      const a = (i / 3) * Math.PI * 2;
      const r = 0.4 + (0.12 - 0.4) * (y / h);
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    };
    for (let i = 0; i < 3; i++) base.push(strut(corner(i, 0.1), corner(i, h), 0.04));
    for (let y = 0.1, k = 0; y < h - 0.4; y += 0.6, k++) {
      for (let i = 0; i < 3; i++) {
        dark.push(strut(corner(i, y + 0.6), corner((i + 1) % 3, y + 0.6), 0.015));
        dark.push(k % 2 ? strut(corner(i, y), corner((i + 1) % 3, y + 0.6), 0.015) : strut(corner((i + 1) % 3, y), corner(i, y + 0.6), 0.015));
      }
    }
    // The dish, tilted up at a sky that stopped answering, and a crossbar of beacons.
    base.push(place(new THREE.SphereGeometry(0.6, 14, 5, 0, Math.PI * 2, 0, 0.62).translate(0, -0.55, 0), 0, 0, 0, 1.05, 0, 0).translate(0, h - 0.95, 0.3));
    dark.push(strut([0, h - 0.95, 0.1], [0, h - 0.7, 0.55], 0.02), box(0.7, 0.04, 0.04, 0, h - 0.25, 0));
    const glow = [ball(0.08, 0, h + 0.05, 0), ball(0.04, 0.35, h - 0.25, 0), ball(0.04, -0.35, h - 0.25, 0)];
    return { base, dark, glow };
  },
  /** A pool of coolant in a ring of stones, lit from below, glowcaps crowding the edge. */
  glow_pool: () => {
    const stones = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
      const r = 0.72 + (i % 3) * 0.05;
      stones.push(rock(0.14 + (i % 3) * 0.04, Math.sin(a) * r, 0.04, Math.cos(a) * r, 1.2, 0.6, 1, a));
    }
    const glow = [
      place(new THREE.CircleGeometry(0.66, 18), 0, 0.03, 0, -Math.PI / 2),
      ...[[0.62, 0.35], [-0.5, 0.55], [0.15, -0.75], [-0.7, -0.25]].map(([x, z], i) => ball(0.08 + (i % 2) * 0.03, x, 0.24 + (i % 2) * 0.06, z, 0.5)),
    ];
    const accent = [[0.62, 0.35], [-0.5, 0.55], [0.15, -0.75], [-0.7, -0.25]].map(([x, z], i) => cyl(0.02, 0.03, 0.22 + (i % 2) * 0.06, x, 0.11 + (i % 2) * 0.03, z, 0, 0, 0, 5));
    return { base: stones, accent, glow };
  },
  /**
   * The overlook: a flagstone ledge with a bit of railing, and a coin-op
   * viewing scope someone carried all the way up here. It still takes coins.
   * Nobody has any.
   */
  overlook: () => ({
    base: [box(1.1, 0.12, 0.9, 0, 0.06, 0), ...[-0.5, -0.17, 0.17, 0.5].map((x) => box(0.06, 0.8, 0.06, x, 0.5, 0.42))],
    accent: [box(1.1, 0.05, 0.05, 0, 0.9, 0.42), box(1.1, 0.04, 0.04, 0, 0.55, 0.42)],
    dark: [
      cyl(0.05, 0.07, 1.0, 0, 0.6, 0, 0, 0, 0, 8),
      box(0.36, 0.24, 0.26, 0, 1.2, 0.02, -0.15, 0, 0),
      cyl(0.06, 0.07, 0.18, -0.08, 1.24, 0.2, Math.PI / 2 - 0.15, 0, 0, 8),
      cyl(0.06, 0.07, 0.18, 0.08, 1.24, 0.2, Math.PI / 2 - 0.15, 0, 0, 8),
    ],
    glow: [box(0.04, 0.03, 0.02, 0.12, 1.12, -0.12)],
  }),
  pylon: () => ({
    base: [box(0.5, 0.15, 0.5, 0, 0.07, 0), cyl(0.06, 0.1, 1.8, 0, 0.9, 0, 0, 0, 0, 6)],
    accent: [torus(0.22, 0.03, 0, 1.4, 0, -Math.PI / 2)],
    glow: [ball(0.1, 0, 1.9, 0)],
  }),
  // --- Hab pieces (see sim/hab.js) ---
  crates: () => ({
    base: [box(0.5, 0.42, 0.5, -0.16, 0.21, -0.1), box(0.42, 0.36, 0.42, 0.2, 0.18, 0.18), box(0.4, 0.34, 0.4, -0.1, 0.59, -0.08, 0, 0.3, 0)],
    dark: [box(0.52, 0.04, 0.52, -0.16, 0.3, -0.1), box(0.44, 0.04, 0.44, 0.2, 0.26, 0.18)],
  }),
  lamp: () => ({
    base: [cyl(0.16, 0.2, 0.08, 0, 0.04, 0)],
    dark: [cyl(0.03, 0.03, 1.4, 0, 0.74, 0, 0, 0, 0, 6), box(0.3, 0.04, 0.04, 0.13, 1.44, 0)],
    accent: [cone(0.14, 0.18, 0.28, 1.36, 0, 0, 0, 0, 10)],
    glow: [ball(0.07, 0.28, 1.28, 0)],
  }),
  tool_wall: () => ({
    base: [box(0.9, 1.5, 0.1, 0, 0.75, -0.38)],
    dark: [box(0.06, 0.4, 0.04, -0.28, 1.1, -0.31), box(0.2, 0.06, 0.04, -0.28, 1.3, -0.31), box(0.05, 0.5, 0.04, 0, 1.0, -0.31), cyl(0.08, 0.08, 0.04, 0.25, 1.15, -0.31, Math.PI / 2, 0, 0, 10), box(0.3, 0.05, 0.04, 0.1, 0.55, -0.31)],
    accent: [box(0.12, 0.2, 0.05, 0.3, 0.7, -0.3), box(0.16, 0.08, 0.05, -0.2, 0.6, -0.3)],
  }),
  rack: () => ({
    base: [...[[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]].map(([x, z]) => box(0.05, 1.3, 0.05, x, 0.65, z)), box(0.76, 0.04, 0.46, 0, 0.45, 0), box(0.76, 0.04, 0.46, 0, 0.9, 0)],
    glow: [0, 1, 2].flatMap((i) => [cyl(0.08, 0.08, 0.3, -0.22 + i * 0.22, 0.62, 0, 0, 0, 0, 8), cyl(0.08, 0.08, 0.3, -0.22 + i * 0.22, 1.07, 0, 0, 0, 0, 8)]),
  }),
  grow_bed: () => ({
    base: [box(0.9, 0.3, 0.12, 0, 0.15, -0.39), box(0.9, 0.3, 0.12, 0, 0.15, 0.39), box(0.12, 0.3, 0.9, -0.39, 0.15, 0), box(0.12, 0.3, 0.9, 0.39, 0.15, 0)],
    dark: [box(0.68, 0.22, 0.68, 0, 0.12, 0)],
  }),
  pot: () => ({
    base: [cyl(0.2, 0.14, 0.3, 0, 0.15, 0, 0, 0, 0, 10)],
    glow: [ball(0.12, 0, 0.5, 0, 1.6), ball(0.08, 0.1, 0.42, 0.06), ball(0.07, -0.09, 0.44, -0.05)],
    dark: [cyl(0.02, 0.02, 0.2, 0, 0.36, 0, 0, 0, 0, 5)],
  }),
  bunk: () => ({
    base: [...[[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]].map(([x, z]) => box(0.06, 1.3, 0.06, x, 0.65, z)), box(0.9, 0.08, 0.6, 0, 0.3, 0), box(0.9, 0.08, 0.6, 0, 0.95, 0)],
    accent: [box(0.84, 0.1, 0.54, 0, 0.39, 0), box(0.84, 0.1, 0.54, 0, 1.04, 0)],
    dark: [box(0.22, 0.08, 0.4, -0.3, 0.48, 0), box(0.22, 0.08, 0.4, -0.3, 1.13, 0)],
  }),
  chair: () => ({
    base: [box(0.6, 0.14, 0.6, 0, 0.32, 0.04), box(0.6, 0.55, 0.12, 0, 0.62, -0.26, -0.25, 0, 0), box(0.1, 0.2, 0.5, -0.3, 0.48, 0.02), box(0.1, 0.2, 0.5, 0.3, 0.48, 0.02)],
    dark: [box(0.5, 0.25, 0.5, 0, 0.12, 0.04)],
  }),
  rug: () => ({
    base: [box(0.9, 0.02, 0.9, 0, 0.01, 0)],
    accent: [box(0.6, 0.025, 0.6, 0, 0.012, 0, 0, Math.PI / 4, 0)],
  }),
  banner: () => ({
    dark: [box(0.05, 1.8, 0.05, -0.32, 0.9, -0.3), box(0.05, 1.8, 0.05, 0.32, 0.9, -0.3), box(0.74, 0.05, 0.05, 0, 1.78, -0.3)],
    base: [box(0.6, 0.9, 0.02, 0, 1.28, -0.3)],
    accent: [box(0.25, 0.25, 0.03, 0, 1.3, -0.29, 0, 0, Math.PI / 4)],
  }),
  case: () => ({
    base: [box(0.6, 0.6, 0.6, 0, 0.3, 0), box(0.64, 0.06, 0.64, 0, 1.33, 0)],
    glow: [ball(0.14, 0, 0.9, 0, 1.4), ball(0.07, 0.12, 0.78, 0.05)],
    dark: [...[[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]].map(([x, z]) => box(0.04, 0.7, 0.04, x, 0.95, z))],
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

/** How far an elevator's tower stands from its station, and its half-width (metres). */
const TOWER_OUT = 1.2;
const TOWER_HALF = 0.62;
/** Metres between the tower's cross-beams. */
const TOWER_BAY = 1.5;

/**
 * An elevator's tower and walkway: a lattice tower just behind the station
 * (the cage you click), the way [def].shaft points, up to the height of the
 * other end of its link, with a headframe and wheel on top and a walkway
 * from there across to the far landing. [rise] is how far above the station
 * the far end is, [reach] how far along the shaft (both metres). It's built
 * along +z and turned to face the shaft.
 */
export function buildShaft(def, rise, reach) {
  const top = rise + 3;
  const base = [];
  const dark = [];
  const accent = [];
  const glow = [];
  const c = TOWER_OUT + TOWER_HALF;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) base.push(box(0.1, top + 1, 0.1, x * TOWER_HALF, (top - 1) / 2, TOWER_OUT + z * TOWER_HALF));
  const w = TOWER_HALF * 2;
  const diagonal = Math.hypot(w, TOWER_BAY);
  const lean = Math.atan2(w, TOWER_BAY);
  for (let y = 0, k = 0; y < top; y += TOWER_BAY, k++) {
    base.push(box(w, 0.07, 0.07, 0, y, TOWER_OUT - TOWER_HALF), box(w, 0.07, 0.07, 0, y, c), box(0.07, 0.07, w, -TOWER_HALF, y, TOWER_OUT), box(0.07, 0.07, w, TOWER_HALF, y, TOWER_OUT));
    if (y + TOWER_BAY > top) break;
    const s = k % 2 ? 1 : -1;
    const mid = y + TOWER_BAY / 2;
    dark.push(box(0.05, diagonal, 0.05, -TOWER_HALF, mid, TOWER_OUT, s * lean, 0, 0), box(0.05, diagonal, 0.05, TOWER_HALF, mid, TOWER_OUT, -s * lean, 0, 0),
      box(0.05, diagonal, 0.05, 0, mid, c, 0, 0, s * lean));
  }
  // The headframe: a roof, the wheel, a lamp.
  base.push(box(w + 0.4, 0.12, w + 0.4, 0, top, TOWER_OUT));
  dark.push(torus(0.42, 0.06, 0, top + 0.5, TOWER_OUT - 0.3), box(0.08, 0.6, 0.08, -0.15, top + 0.3, TOWER_OUT - 0.3), box(0.08, 0.6, 0.08, 0.15, top + 0.3, TOWER_OUT - 0.3));
  glow.push(box(0.16, 0.12, 0.16, TOWER_HALF, top + 0.12, TOWER_OUT - TOWER_HALF));
  // The cables down to the cage.
  const drop = top + 0.5 - 2.5;
  for (const x of [-0.2, 0.2]) dark.push(cyl(0.02, 0.02, Math.hypot(drop, TOWER_OUT - 0.3), x, 2.5 + drop / 2, (TOWER_OUT - 0.3) / 2, Math.atan2(TOWER_OUT - 0.3, drop), 0, 0, 4));
  // The walkway from the tower to the far landing, railed both sides.
  const from = TOWER_OUT - TOWER_HALF;
  const to = Math.max(reach - 1.3, c + 0.5);
  const length = to - from;
  base.push(box(0.95, 0.08, length, 0, rise + 0.04, from + length / 2));
  for (let z = from; z <= to + 0.01; z += 0.8) for (const x of [-0.45, 0.45]) base.push(box(0.05, 1, 0.05, x, rise + 0.5, z));
  for (const x of [-0.45, 0.45]) accent.push(box(0.05, 0.05, length, x, rise + 1, from + length / 2), box(0.04, 0.04, length, x, rise + 0.55, from + length / 2));
  const group = new THREE.Group();
  const steel = def.color;
  const materials = {
    base: new THREE.MeshStandardMaterial({ color: color(darkened(steel, 0.3)), roughness: 0.6, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: color(darkened(steel, 0.6)), roughness: 0.6, metalness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ color: color(def.accent || [0.95, 0.72, 0.15, 1]), roughness: 0.5, metalness: 0.2 }),
    glow: new THREE.MeshStandardMaterial({ color: color([1, 0.3, 0.2]), emissive: color([1, 0.3, 0.2]), emissiveIntensity: 1.8 }),
  };
  for (const [key, geometries] of Object.entries({ base, dark, accent, glow })) {
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
