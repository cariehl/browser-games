// Variations on the two enemy models (scrap_walker.glb, relic_sentry.glb),
// so a loader doesn't look like a crawler that ate well. An NPC def names a
// variant ("variant": "loader"); the variant repaints the hull and the glow,
// and bolts a few procedural parts onto the model's bones (a loader's horn
// and forks, the warden's pauldrons, the press's paint tank), so they walk,
// swing and fall with it.
//
// Part positions are in the bone's space at model scale 1. Both models face
// +Z, and their torso and head bones carry no rotation, so +Y is up and +Z
// is forward there too.

import * as THREE from 'three';
import { color } from './tile_math.js';

/** Hull materials per model, and the glow ones. */
const HULLS = new Set(['MS_Hull_Rust', 'MS_Relic_Hull', 'MS_Relic_Bronze']);
const GLOWS = new Set(['MS_Glow_Red', 'MS_Glow_Teal']);

const cone = (r, h) => new THREE.ConeGeometry(r, h, 8);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, seg = 10) => new THREE.CylinderGeometry(r1, r2, h, seg);
const ball = (r) => new THREE.SphereGeometry(r, 12, 8);

/**
 * Each variant: hull and glow colours (null keeps the model's), and parts:
 * [bone, geometry, material ('hull' | 'dark' | 'accent' | 'glow'), position, rotation].
 */
const VARIANTS = {
  // A cargo loader: hazard-yellow, a horn up front (Juno wants one) and lifting forks.
  loader: {
    hull: [0.74, 0.56, 0.16], glow: null, accent: [0.86, 0.82, 0.7],
    parts: [
      ['torso', cone(0.13, 0.7), 'accent', [0, 1.05, 0.8], [1.15, 0, 0]],
      ['torso', box(0.09, 0.09, 1.1), 'dark', [-0.32, -0.55, 0.95], [0, 0, 0]],
      ['torso', box(0.09, 0.09, 1.1), 'dark', [0.32, -0.55, 0.95], [0, 0, 0]],
      ['torso', box(0.9, 0.5, 0.08), 'dark', [0, -0.3, 0.42], [0, 0, 0]],
    ],
  },
  // A breaching mech: dull gunmetal, a battering plate across its front.
  breacher: {
    hull: [0.36, 0.36, 0.36], glow: [1, 0.45, 0.1], accent: [0.62, 0.52, 0.28],
    parts: [
      ['torso', box(1.3, 0.6, 0.16), 'dark', [0, -0.05, 1.05], [-0.15, 0, 0]],
      ...[-0.42, 0, 0.42].map((x) => ['torso', cyl(0.07, 0.07, 0.1, 8), 'accent', [x, -0.05, 1.15], [Math.PI / 2 - 0.15, 0, 0]]),
    ],
  },
  // A scrap crawler: grubby and low, feelers waving, a sickly green eye.
  crawler: {
    hull: [0.38, 0.33, 0.26], glow: [0.55, 1, 0.3], accent: null,
    parts: [
      ['torso', cyl(0.025, 0.035, 1.1, 5), 'dark', [-0.3, 1.5, 0.2], [0.5, 0, -0.35]],
      ['torso', cyl(0.025, 0.035, 1.1, 5), 'dark', [0.3, 1.5, 0.2], [0.5, 0, 0.35]],
      ['torso', ball(0.08), 'glow', [-0.5, 2.0, 0.45], [0, 0, 0]],
      ['torso', ball(0.08), 'glow', [0.5, 2.0, 0.45], [0, 0, 0]],
    ],
  },
  // The Undercroft's warden: blued steel, shoulder plates, a crest, a cold blue eye.
  warden: {
    hull: [0.24, 0.29, 0.42], glow: [0.35, 0.65, 1], accent: [0.75, 0.68, 0.4],
    parts: [
      ['torso', box(0.6, 0.18, 0.8), 'hull', [-0.85, 0.82, 0], [0, 0, 0.35]],
      ['torso', box(0.6, 0.18, 0.8), 'hull', [0.85, 0.82, 0], [0, 0, -0.35]],
      ['torso', box(0.14, 0.32, 1.0), 'accent', [0, 1.02, -0.1], [0, 0, 0]],
    ],
  },
  // The Splatterpress: pink everything, a sloshing paint tank on its back.
  press: {
    hull: [0.86, 0.32, 0.62], glow: [1, 0.45, 0.85], accent: [0.95, 0.6, 0.85],
    parts: [
      ['torso', ball(0.45), 'accent', [0, 0.75, -0.95], [0, 0, 0]],
      ['torso', cyl(0.06, 0.06, 0.95, 8), 'dark', [0, 0.75, -0.95], [0, 0, Math.PI / 2]],
      ['torso', ball(0.1), 'accent', [0.35, 0.2, 0.7], [0, 0, 0]],
      ['torso', ball(0.07), 'accent', [-0.3, 0.5, 0.75], [0, 0, 0]],
    ],
  },
  // The colossus: old rust gone almost black, a ridge of spikes down its back.
  colossus: {
    hull: [0.34, 0.2, 0.14], glow: [1, 0.15, 0.05], accent: null,
    parts: [0, 1, 2, 3].map((i) => ['torso', cone(0.14, 0.6 - i * 0.08), 'dark', [0, 1.6 - i * 0.35, -0.7 - i * 0.12], [-0.6 - i * 0.15, 0, 0]]),
  },
  // A foundry drone: sooty iron, a chimney on its head, furnace-orange eyes.
  foundry: {
    hull: [0.22, 0.2, 0.19], glow: [1, 0.55, 0.12], accent: [0.6, 0.45, 0.3],
    parts: [
      ['head', cyl(0.08, 0.1, 0.45, 8), 'dark', [0.12, 0.45, -0.12], [0, 0, 0]],
      ['head', cyl(0.11, 0.11, 0.06, 8), 'accent', [0.12, 0.69, -0.12], [0, 0, 0]],
    ],
  },
  // Pell's survey drone: a little dish on its head, always listening.
  surveyor: {
    hull: [0.3, 0.42, 0.4], glow: null, accent: [0.85, 0.85, 0.8],
    parts: [
      ['head', cyl(0.02, 0.02, 0.35, 5), 'dark', [0, 0.45, -0.05], [0, 0, 0]],
      ['head', new THREE.SphereGeometry(0.18, 12, 6, 0, Math.PI * 2, 0, 1.0), 'accent', [0, 0.62, -0.05], [-0.4, 0, 0]],
    ],
  },
  // The scuttle drone: grey, with one big searchlight.
  scuttle: {
    hull: [0.4, 0.43, 0.46], glow: [0.7, 0.85, 1], accent: null,
    parts: [['head', ball(0.14), 'glow', [0, 0.1, 0.32], [0, 0, 0]]],
  },
};

/** Per def: material name -> its repainted copy, so every crawler shares one set. */
const cache = new Map();

function repainted(defId, material, variant) {
  let byName = cache.get(defId);
  if (!byName) cache.set(defId, (byName = new Map()));
  if (byName.has(material.name)) return byName.get(material.name);
  let out = material;
  if (HULLS.has(material.name) && variant.hull) {
    out = material.clone();
    out.color.copy(color(variant.hull));
  } else if (GLOWS.has(material.name) && variant.glow) {
    out = material.clone();
    out.color.copy(color(variant.glow));
    if (out.emissive) out.emissive.copy(color(variant.glow));
  }
  byName.set(material.name, out);
  return out;
}

/** Repaints [model] and bolts on [def].variant's parts. Does nothing without one. */
export function applyVariant(model, def) {
  const variant = VARIANTS[def.variant];
  if (!variant) return;
  const bones = {};
  model.traverse((node) => {
    if (node.isBone) bones[node.name] = node;
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material) ? node.material.map((m) => repainted(def.id, m, variant)) : repainted(def.id, node.material, variant);
  });
  const hull = variant.hull || [0.5, 0.45, 0.4];
  const glow = variant.glow || [1, 0.3, 0.2];
  const materials = {
    hull: new THREE.MeshStandardMaterial({ color: color(hull), roughness: 0.7, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: color([0.08, 0.08, 0.09]), roughness: 0.6, metalness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ color: color(variant.accent || hull), roughness: 0.5, metalness: 0.2 }),
    glow: new THREE.MeshStandardMaterial({ color: color(glow), emissive: color(glow), emissiveIntensity: 1.6 }),
  };
  for (const [boneName, geometry, key, at, rot] of variant.parts) {
    const bone = bones[boneName];
    if (!bone) continue;
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.position.set(...at);
    mesh.rotation.set(...rot);
    mesh.castShadow = key !== 'glow';
    mesh.receiveShadow = true;
    bone.add(mesh);
  }
}
