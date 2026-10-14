// Conversions between sim tiles and 3D world space. Tile (x, y) maps to the
// world XZ plane; one tile is TILE_SIZE metres.

import * as THREE from 'three';

export const TILE_SIZE = 1;

export function tileToWorld(tile, height = 0, out = new THREE.Vector3()) {
  return out.set((tile.x + 0.5) * TILE_SIZE, height, (tile.y + 0.5) * TILE_SIZE);
}

export function worldToTile(pos) {
  return { x: Math.floor(pos.x / TILE_SIZE), y: Math.floor(pos.z / TILE_SIZE) };
}

/** An sRGB [r, g, b(, a)] colour from the data files as a THREE.Color. */
export function color(rgb) {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

/** Godot's Color.lightened: towards white by [amount]. */
export function lightened(rgb, amount) {
  return rgb.slice(0, 3).map((c) => c + (1 - c) * amount);
}

/** Godot's Color.darkened: towards black by [amount]. */
export function darkened(rgb, amount) {
  return rgb.slice(0, 3).map((c) => c * (1 - amount));
}

/** "#rrggbb" for an sRGB [r, g, b] in 0..1, for the DOM. */
export function cssColor(rgb, alpha = 1) {
  const [r, g, b] = rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Turns [from] toward [to] (radians) the short way round, by [weight]. */
export function lerpAngle(from, to, weight) {
  let diff = (to - from) % (Math.PI * 2);
  diff = ((2 * diff) % (Math.PI * 2)) - diff;
  return from + diff * weight;
}

/** A small seeded random generator (mulberry32), for looks that never change between visits. */
export function seeded(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo, hi) => lo + next() * (hi - lo) };
}
