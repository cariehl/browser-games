// Draws the land beyond the areas' edges (see backdrop_terrain.js for how
// it's worked out, and data/scenery.json for what's in it): each region's
// ground as one smooth mesh, its props through the decor builder, and its
// fences. None of it is walkable; the big props can be examined.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Content } from '../sim/defs.js';
import { LEVEL_HEIGHT, color, seeded } from './tile_math.js';
import { buildRegions } from './backdrop_terrain.js';
import { buildProps } from './decor_view.js';

const UP = new THREE.Vector3(0, 1, 0);
/** Props further than this from an area's edge (tiles) can't be clicked. */
const EXAMINE_RANGE = 30;

/**
 * Builds every region of data/scenery.json around [world]'s areas. Returns
 * { group, regions, lights }: regions are BackdropRegions (regionOf(areaId)
 * finds one), lights the glowing props' light pool.
 */
export function buildBackdrop(world) {
  const group = new THREE.Group();
  const regions = buildRegions(world, Content.scenery, LEVEL_HEIGHT);
  const props = [];
  for (const region of regions) {
    group.add(buildLand(region));
    for (const p of region.props()) {
      const def = Content.decor[p.decor];
      if (!def) {
        console.warn(`scenery region ${region.id}: no decor "${p.decor}".`);
        continue;
      }
      props.push({
        def, tile: { x: Math.floor(p.x), y: Math.floor(p.y) }, at: new THREE.Vector3(p.x, p.height, p.y),
        turn: new THREE.Quaternion().setFromAxisAngle(UP, p.turn), scale: def.scale * p.scale, big: true,
        // Only what you can make out through the fog is clickable.
        hitbox: region.distance(p.x, p.y) <= EXAMINE_RANGE,
      });
    }
    for (const fence of region.fences()) group.add(buildFence(fence));
  }
  const built = buildProps(props);
  group.add(built.group);
  return {
    group, regions, lights: built.lights,
    regionOf: (areaId) => regions.find((r) => r.areas.some((a) => a.area.id === areaId)) || null,
  };
}

/** A region's ground: a grid over its tile corners, leaving out the tiles the areas draw. */
function buildLand(region) {
  const W = region.w + 1;
  const pos = new Float32Array(W * (region.h + 1) * 3);
  const col = new Float32Array(W * (region.h + 1) * 3);
  const c = new THREE.Color();
  for (let cy = region.y0; cy <= region.y0 + region.h; cy++) {
    for (let cx = region.x0; cx <= region.x0 + region.w; cx++) {
      const i = region.corner(cx, cy);
      const [ox, oy] = region.offsetAt(cx, cy);
      pos[i * 3] = cx + ox;
      pos[i * 3 + 1] = region.heights[i];
      pos[i * 3 + 2] = cy + oy;
      const rgb = region.colorAt(cx, cy);
      c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  }
  const index = [];
  for (let y = region.y0; y < region.y0 + region.h; y++) {
    for (let x = region.x0; x < region.x0 + region.w; x++) {
      if (region.inArea(x, y)) continue;
      const a = region.corner(x, y);
      const b = region.corner(x, y + 1);
      const cc = region.corner(x + 1, y + 1);
      const d = region.corner(x + 1, y);
      index.push(a, b, cc, a, cc, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/**
 * A fence round an area: posts, a panel of sheet metal between each pair
 * (each its own colour from the style's palette, some leaning), and a
 * strand of wire along the top.
 */
function buildFence({ style, posts, panels }) {
  const group = new THREE.Group();
  const height = style.height || 2.6;
  const palette = style.panels || [[0.45, 0.4, 0.34]];
  const postGeometry = new THREE.BoxGeometry(0.14, height + 0.9, 0.14);
  postGeometry.translate(0, (height + 0.9) / 2 - 0.5, 0);
  const postMesh = new THREE.InstancedMesh(postGeometry, new THREE.MeshStandardMaterial({ color: color(style.post || [0.25, 0.24, 0.23]), roughness: 0.7, metalness: 0.4 }), posts.length);
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  posts.forEach((p, i) => {
    matrix.compose(at.set(p.x, p.height, p.y), turn.identity(), one);
    postMesh.setMatrixAt(i, matrix);
  });
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  group.add(postMesh);
  // Corrugated sheets: a few ridges on a thin panel, one unit long; stretched to each gap.
  const ridges = [];
  for (let k = 0; k < 6; k++) ridges.push(new THREE.BoxGeometry(1 / 6 * 0.55, height, 0.07).translate(-0.5 + (k + 0.5) / 6, 0, 0.012));
  const sheet = mergeGeometries([new THREE.BoxGeometry(1, height, 0.04), ...ridges]);
  sheet.translate(0, height / 2 - 0.35, 0);
  const sheets = new THREE.InstancedMesh(sheet, new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.35 }), panels.length);
  const wire = new THREE.CylinderGeometry(0.015, 0.015, 1, 4).rotateZ(Math.PI / 2);
  const wires = new THREE.InstancedMesh(wire, new THREE.MeshStandardMaterial({ color: color([0.15, 0.15, 0.15]), roughness: 0.6, metalness: 0.5 }), panels.length * 2);
  const scale = new THREE.Vector3();
  const tilt = new THREE.Quaternion();
  panels.forEach(({ a, b }, i) => {
    const p = posts[a];
    const q = posts[b];
    const r = seeded(Math.round(p.x * 13 + p.y * 7919));
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const angle = Math.atan2(-(q.y - p.y), q.x - p.x);
    const low = Math.min(p.height, q.height);
    turn.setFromAxisAngle(UP, angle);
    // A sheet now and then leans a little out of line.
    tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), r.next() < 0.2 ? r.range(-0.12, 0.12) : 0);
    at.set((p.x + q.x) / 2, low, (p.y + q.y) / 2);
    scale.set(length - 0.06, 1 + Math.abs(p.height - q.height) / height + r.range(-0.06, 0.04), 1);
    matrix.compose(at, turn.clone().multiply(tilt), scale);
    sheets.setMatrixAt(i, matrix);
    const shade = palette[Math.floor(r.next() * palette.length)];
    sheets.setColorAt(i, color(shade.map((v) => v * r.range(0.9, 1.08))));
    for (const [k, y] of [[0, height + 0.1], [1, height + 0.3]]) {
      at.set((p.x + q.x) / 2, (p.height + q.height) / 2 + y, (p.y + q.y) / 2);
      matrix.compose(at, turn, scale.set(length, 1, 1));
      wires.setMatrixAt(i * 2 + k, matrix);
    }
  });
  sheets.castShadow = true;
  sheets.receiveShadow = true;
  group.add(sheets, wires);
  return group;
}

