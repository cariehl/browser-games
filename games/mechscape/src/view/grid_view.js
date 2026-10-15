// The ground and the terrain on it, drawn from the World's map:
//   The ground is one mesh over every area, each tile a quad at its height
//   in its ground type's colour (with a little per-tile variation and faint
//   grid lines), ramps sloping between levels, and rock faces down every
//   cliff and around the edge of each area.
//   Terrain (walls, rocks, fences) is a block per tile, one InstancedMesh per
//   kind, standing on the ground.

import * as THREE from 'three';
import { TILE_SIZE, LEVEL_HEIGHT, tileToWorld, color, seeded } from './tile_math.js';
import { fromKey } from '../sim/grid.js';

const DEFAULT_GROUND = [0.36, 0.40, 0.33];
const CLIFF = [0.33, 0.3, 0.27];
/** How far below an area's edge its rock face reaches. */
const EDGE_DROP = 1.4;
/** Pixels per tile in the grid-line texture. */
const TEXELS = 32;

/**
 * Builds the ground and terrain. Returns { group, ground, terrain } (ground is
 * the mesh to pick tiles on; terrain the group to rebuild when puzzles open).
 */
export function buildGrid(world) {
  const group = new THREE.Group();
  const { mesh, glow } = buildGround(world);
  group.add(mesh);
  if (glow) group.add(glow);
  const terrain = new THREE.Group();
  group.add(terrain);
  rebuildTerrain(terrain, world);
  return { group, ground: mesh, terrain };
}

/** Redraws [group] from the world's terrain (after a puzzle opens some). */
export function rebuildTerrain(group, world) {
  for (const m of [...group.children]) {
    group.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    m.dispose();
  }
  for (const m of buildObstacles(world)) group.add(m);
}

/** A white tile with darker edges: multiplied over the ground's colours, it draws the tile grid. */
function lineTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXELS;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgb(205,205,205)';
  g.fillRect(0, 0, TEXELS, TEXELS);
  g.fillStyle = '#fff';
  const edge = 1;
  g.fillRect(edge, edge, TEXELS - 2 * edge, TEXELS - 2 * edge);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  return texture;
}

/** Heights (metres) of a tile's four corners: NW, NE, SE, SW. Ramps slope towards the levels beside them. */
function cornerHeights(world, x, y) {
  const h = world.heightAt({ x, y });
  if (h === Math.floor(h)) return [h, h, h, h].map((v) => v * LEVEL_HEIGHT);
  const out = [];
  // Each corner: the three other tiles that share it.
  for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    let hi = 0;
    let lo = 0;
    for (const [dx, dy] of [[cx, 0], [0, cy], [cx, cy]]) {
      const t = { x: x + dx, y: y + dy };
      if (world.areaIdAt(t) < 0) continue;
      const n = world.heightAt(t);
      if (n === h + 0.5) hi += dx !== 0 && dy !== 0 ? 1 : 2;
      else if (n === h - 0.5) lo += dx !== 0 && dy !== 0 ? 1 : 2;
    }
    out.push((hi > lo ? h + 0.5 : lo > hi ? h - 0.5 : h) * LEVEL_HEIGHT);
  }
  return out;
}

function buildGround(world) {
  const pos = [];
  const col = [];
  const uv = [];
  const glowPos = [];
  const glowCol = [];
  const corners = new Map();
  const cornersOf = (x, y) => {
    const k = y * world.size.x + x;
    if (!corners.has(k)) corners.set(k, cornerHeights(world, x, y));
    return corners.get(k);
  };
  const quad = (P, C, U, a, b, c, d, rgb, uvs) => {
    // Two triangles: a b c, a c d (counter-clockwise seen from above/outside).
    for (const v of [a, b, c, a, c, d]) P.push(...v);
    for (let i = 0; i < 6; i++) C.push(...rgb);
    if (U) for (const i of [0, 1, 2, 0, 2, 3]) U.push(...uvs[i]);
  };
  const cliff = color(CLIFF);
  for (let y = 0; y < world.size.y; y++) {
    for (let x = 0; x < world.size.x; x++) {
      const tile = { x, y };
      if (world.areaIdAt(tile) < 0) continue;
      const def = world.groundAt(tile);
      const base = def ? def.color : DEFAULT_GROUND;
      const rng = seeded(x * 7919 + y * 104729);
      const v = def ? def.variation : 0.05;
      const shade = 1 + rng.range(-v, v);
      const rgb = color(base.map((c) => c * shade));
      const [nw, ne, se, sw] = cornersOf(x, y);
      const x0 = x * TILE_SIZE;
      const x1 = (x + 1) * TILE_SIZE;
      const z0 = y * TILE_SIZE;
      const z1 = (y + 1) * TILE_SIZE;
      // No grid lines: map every corner to the texture's plain middle.
      const uvs = !def || def.lines ? [[0, 1], [0, 0], [1, 0], [1, 1]] : [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]];
      quad(pos, col, uv, [x0, nw, z0], [x0, sw, z1], [x1, se, z1], [x1, ne, z0], [rgb.r, rgb.g, rgb.b], [uvs[0], uvs[3], uvs[2], uvs[1]]);
      if (def && def.glow > 0) {
        const g = color(base.map((c) => Math.min(c * 1.4, 1)));
        quad(glowPos, glowCol, null, [x0, nw + 0.005, z0], [x0, sw + 0.005, z1], [x1, se + 0.005, z1], [x1, ne + 0.005, z0], [g.r * def.glow, g.g * def.glow, g.b * def.glow]);
      }
      // Rock faces: down from this tile's edge to its neighbour's, or below the area's edge.
      const edges = [
        // [neighbour dx, dy, this tile's two corners (as points), neighbour's matching corner heights]
        [0, -1, [x1, ne, z0], [x0, nw, z0], (n) => [n[3], n[2]].reverse()],
        [1, 0, [x1, se, z1], [x1, ne, z0], (n) => [n[0], n[3]].reverse()],
        [0, 1, [x0, sw, z1], [x1, se, z1], (n) => [n[1], n[0]].reverse()],
        [-1, 0, [x0, nw, z0], [x0, sw, z1], (n) => [n[2], n[1]].reverse()],
      ];
      for (const [dx, dy, a, b, match] of edges) {
        const n = { x: x + dx, y: y + dy };
        let below;
        if (world.areaIdAt(n) < 0) below = [a[1] - EDGE_DROP, b[1] - EDGE_DROP];
        else below = match(cornersOf(n.x, n.y));
        // Neighbour corners in the order of a then b.
        const [ba, bb] = below;
        if (a[1] - ba < 0.01 && b[1] - bb < 0.01) continue;
        const s = 0.8 + 0.2 * rng.next();
        quad(pos, col, uv, a, [a[0], Math.min(ba, a[1]), a[2]], [b[0], Math.min(bb, b[1]), b[2]], b, [cliff.r * s, cliff.g * s, cliff.b * s],
          [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, map: lineTexture(), roughness: 1, metalness: 0, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  let glow = null;
  if (glowPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));
    glow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  }
  return { mesh, glow };
}

/** One InstancedMesh per kind of terrain, so thousands of wall tiles are a handful of draw calls. */
function buildObstacles(world) {
  const byDef = new Map();
  for (const [key, def] of world.terrainTiles()) {
    if (!byDef.has(def)) byDef.set(def, []);
    byDef.get(def).push(fromKey(key));
  }
  const meshes = [];
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  for (const [def, tiles] of byDef) {
    // Things you can see over are drawn a little thinner, like a fence.
    // Flat terrain (chasms, a broken bridge) is a dark patch on the ground.
    const flat = def.height < 0.1;
    const width = def.blocks_sight || flat ? TILE_SIZE : TILE_SIZE * 0.82;
    // Taller boxes, sunk a little, so blocks on a slope don't float.
    const geometry = new THREE.BoxGeometry(width, flat ? 0.08 : def.height + 0.5, width);
    const material = new THREE.MeshStandardMaterial({ color: color(def.color), roughness: 1, metalness: 0 });
    if (def.shimmer) {
      // A projected wall: almost convincing.
      material.transparent = true;
      material.opacity = 0.82;
      material.emissive = color([0.15, 0.3, 0.4]);
    }
    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
    const rock = def.id === 'rock';
    tiles.forEach((tile, i) => {
      const rng = seeded(tile.x * 31 + tile.y * 977);
      tileToWorld(tile, flat ? 0.0 : def.height / 2 - 0.25, at);
      // Rocks vary a little in size and turn, so a ridge isn't a row of crates.
      const k = rock ? rng.range(0.85, 1.15) : 1;
      scale.set(rock ? rng.range(0.9, 1.08) : 1, k, rock ? rng.range(0.9, 1.08) : 1);
      turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rock ? rng.range(-0.25, 0.25) : 0);
      at.y += (k - 1) * def.height / 2;
      matrix.compose(at, turn, scale);
      mesh.setMatrixAt(i, matrix);
      const shade = 1 + rng.range(-0.06, 0.06);
      mesh.setColorAt(i, color(def.color.map((c) => c * shade)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}
