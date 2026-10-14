// Gray-box rendering of the World's tile map: a checkered floor and a block
// on every terrain tile, coloured and sized by its TerrainDef. Placeholder
// until real terrain and art exist.

import * as THREE from 'three';
import { TILE_SIZE, tileToWorld, color } from './tile_math.js';
import { fromKey } from '../sim/grid.js';

const COLOR_A = [0.36, 0.40, 0.33];
const COLOR_B = [0.32, 0.36, 0.29];
/** Pixels per tile in the floor texture. */
const TEXELS = 32;

export function buildGrid(world) {
  const group = new THREE.Group();
  group.add(buildFloor(world));
  for (const mesh of buildObstacles(world)) group.add(mesh);
  return group;
}

/** A 2×2-tile checker with darker grid lines, repeated over the map. */
function floorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXELS * 2;
  const g = canvas.getContext('2d');
  const css = (rgb) => `rgb(${rgb.map((c) => Math.round(c * 255)).join(',')})`;
  const line = COLOR_B.map((c) => c * 0.8);
  // Lines mixed in at 60%, as the Godot floor shader does.
  const lineMix = (base) => base.map((c, i) => c + (line[i] - c) * 0.6);
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const base = (cx + cy) % 2 === 0 ? COLOR_A : COLOR_B;
      const x0 = cx * TEXELS;
      const y0 = cy * TEXELS;
      g.fillStyle = css(lineMix(base));
      g.fillRect(x0, y0, TEXELS, TEXELS);
      const edge = Math.max(1, Math.round(TEXELS * 0.02));
      g.fillStyle = css(base);
      g.fillRect(x0 + edge, y0 + edge, TEXELS - 2 * edge, TEXELS - 2 * edge);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.anisotropy = 8;
  return texture;
}

function buildFloor(world) {
  const w = world.size.x * TILE_SIZE;
  const h = world.size.y * TILE_SIZE;
  const texture = floorTexture();
  texture.repeat.set(world.size.x / 2, world.size.y / 2);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(w / 2, 0, h / 2);
  mesh.receiveShadow = true;
  return mesh;
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
  for (const [def, tiles] of byDef) {
    // Things you can see over are drawn a little thinner, like a fence.
    const width = def.blocks_sight ? TILE_SIZE : TILE_SIZE * 0.82;
    const geometry = new THREE.BoxGeometry(width, def.height, width);
    const material = new THREE.MeshStandardMaterial({ color: color(def.color), roughness: 1, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
    tiles.forEach((tile, i) => {
      matrix.makeTranslation(tileToWorld(tile, def.height / 2, at));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}
