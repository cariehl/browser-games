// Hab pieces (sim/hab.js): each drawn as its procedural shape in the colour
// its owner picked, turned in quarter steps. A grow bed shows what's in it:
// bare soil, a sprout once planted, a taller plant while it grows, and a
// glowing crop when it's ready to harvest.
//
// The same model, tinted green or red, is the ghost build mode drags round.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { tileToWorld, color } from './tile_math.js';
import { hasShape, buildShape } from './station_shapes.js';
import { Hitbox, HitboxKind } from './hitbox.js';
import { Content } from '../sim/defs.js';

/** '#rrggbb' as [r, g, b] in 0..1. */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/** A group drawing [item] (a piece) in [hex]: the shape alone, no hitbox. */
export function buildPieceModel(item, hex) {
  const piece = item.piece;
  if (!hasShape(piece.shape)) {
    const fallback = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: color(hexToRgb(hex)) }));
    fallback.position.y = 0.25;
    return fallback;
  }
  return buildShape({ shape: piece.shape, color: hexToRgb(hex), accent: piece.accent || [1, 0.75, 0.35, 1] });
}

/** Which growth stage a bed is at: 0 empty, 1 planted, 2 growing, 3 ready. */
export function bedStage(bed, tick) {
  if (!bed || !bed.seed) return 0;
  if (!bed.fed) return 1;
  return tick >= bed.ready ? 3 : 2;
}

const PLANT_COLORS = { glowroot: [0.4, 1, 0.55], ventbloom: [0.4, 0.75, 1], rustcap: [0.85, 0.45, 0.2] };

function plant(seedId, stage) {
  const group = new THREE.Group();
  const seed = Content.item(seedId);
  const rgb = PLANT_COLORS[seed && seed.grows] || [0.5, 0.9, 0.4];
  const stem = new THREE.MeshStandardMaterial({ color: color([0.25, 0.5, 0.25]), roughness: 0.9 });
  const head = new THREE.MeshStandardMaterial({ color: color(rgb), emissive: color(rgb), emissiveIntensity: stage === 3 ? 1.2 : 0.15 });
  const height = [0, 0.12, 0.3, 0.45][stage];
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.15], [-0.15, 0.2], [0.2, 0.2]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, height, 5), stem);
    s.position.set(x, 0.24 + height / 2, z);
    group.add(s);
    if (stage >= 2) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(stage === 3 ? 0.09 : 0.05, 8, 6), head);
      bulb.position.set(x, 0.24 + height, z);
      group.add(bulb);
    }
  }
  return group;
}

export class PieceView extends THREE.Group {
  constructor(piece) {
    super();
    this.piece = piece;
    this._key = '';
    this._model = null;
    this._plant = null;
    this.add(new Hitbox(HitboxKind.OBJECT, piece.id, new THREE.Vector3(0.9, 1, 0.9), new THREE.Vector3(0, 0.5, 0)));
    this.update();
  }

  update() {
    const piece = this.piece;
    tileToWorld(piece.tile, 0, this.position);
    this.rotation.y = -piece.rotation * Math.PI / 2;
    if (this._key !== piece.color) {
      this._key = piece.color;
      if (this._model) this.remove(this._model);
      this._model = buildPieceModel(piece.item, piece.color);
      this.add(this._model);
    }
    if (piece.bed) {
      const stage = bedStage(piece.bed, ClientState.world.tick);
      const plantKey = `${piece.bed.seed}|${stage}`;
      if (plantKey !== this._plantKey) {
        this._plantKey = plantKey;
        if (this._plant) this.remove(this._plant);
        this._plant = stage ? plant(piece.bed.seed, stage) : null;
        if (this._plant) this.add(this._plant);
      }
    }
  }

  dispose() {
    this.traverse((node) => {
      if (node instanceof Hitbox) node.dispose();
    });
  }
}

/** A see-through copy of a piece that follows the mouse in build mode. */
export class PieceGhost extends THREE.Group {
  constructor() {
    super();
    this._key = '';
    this._ok = null;
    this.visible = false;
    this._okMat = new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.45, depthWrite: false });
    this._badMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.45, depthWrite: false });
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), this._okMat);
    tile.position.y = 0.02;
    this._tile = tile;
    this.add(tile);
  }

  /** Shows [item] in [hex] at [tile], turned [rotation] quarter steps, green when [ok]. */
  show(item, hex, tile, rotation, ok) {
    const key = `${item.id}|${hex}`;
    if (key !== this._key) {
      this._key = key;
      if (this._model) this.remove(this._model);
      this._model = buildPieceModel(item, hex);
      this._model.traverse((node) => {
        if (node.isMesh) {
          node.material = node.material.clone();
          node.material.transparent = true;
          node.material.opacity = 0.6;
          node.material.depthWrite = false;
          node.castShadow = false;
        }
      });
      this.add(this._model);
      this._ok = null;
    }
    if (ok !== this._ok) {
      this._ok = ok;
      this._tile.material = ok ? this._okMat : this._badMat;
    }
    tileToWorld(tile, 0, this.position);
    this.rotation.y = -rotation * Math.PI / 2;
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }
}
