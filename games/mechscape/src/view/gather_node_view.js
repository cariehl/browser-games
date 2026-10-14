// A gathering node: its imported model when its def has one, otherwise one
// of two gray-box looks, picked by the def:
//   wreck: a heap of tilted boxes with a small glowing core (Salvaging).
//   vent:  a squat rock ring with a glowing mouth and rising gas puffs
//          (Siphoning).
// While depleted it shows its def's depleted model, or slumps and darkens.
// Vents puff gas either way.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { TILE_SIZE, tileToWorld, color, lightened, darkened, seeded } from './tile_math.js';
import { Models } from './models.js';
import { Hitbox, HitboxKind } from './hitbox.js';
import { EntityView } from './entity_view.js';

const PUFF_COUNT = 3;
const PUFF_SECONDS = 2.4;
/** A model's hitbox is at most this wide (metres), centred on its tile. */
const MAX_HITBOX_WIDTH = 1.2 * TILE_SIZE;
/** How dark a model with no depleted variant gets (Godot drew a 55% black overlay). */
const DEPLETED_SHADE = 0.45;

export class GatherNodeView extends THREE.Group {
  constructor(node) {
    super();
    this.node = node;
    tileToWorld(node.tile, 0, this.position);
    this._pieces = new THREE.Group();
    this.add(this._pieces);
    this._puffs = [];
    this._shownDepleted = false;
    this._clock = 0;
    this._model = null;
    this._depletedModel = null;
    /** A husk stays hidden while the NPC that left it plays its collapse. */
    this._waitingFor = null;
    this._material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 });
    this._glow = new THREE.MeshStandardMaterial();
    this._baseColor = node.def.color;
    const def = node.def;
    const s = def.size;
    if (def.model && Models.has(def.model)) {
      this._buildModel();
      if (def.look === 'vent') this._buildPuffs();
      return;
    }
    if (def.look === 'vent') {
      this._buildVent();
      this.add(new Hitbox(HitboxKind.OBJECT, node.id, new THREE.Vector3(0.8, 0.55, 0.8).multiplyScalar(s), new THREE.Vector3(0, 0.27 * s, 0)));
    } else {
      this._buildWreck();
      this.add(new Hitbox(HitboxKind.OBJECT, node.id, new THREE.Vector3(0.85, 0.6, 0.85).multiplyScalar(s), new THREE.Vector3(0, 0.3 * s, 0)));
    }
    this._material.color.copy(color(this._baseColor));
  }

  dispose() {
    this.traverse((node) => {
      if (node instanceof Hitbox) node.dispose();
    });
  }

  _buildWreck() {
    this._setGlow([0.3, 0.9, 1.0]);
    // Seeded by node id, so each wreck looks different but never changes.
    const rng = seeded(this.node.id);
    const s = this.node.def.size;
    for (let i = 0; i < 5; i++) {
      const size = [rng.range(0.25, 0.65) * s, rng.range(0.12, 0.4) * s, rng.range(0.25, 0.65) * s];
      const piece = this._addMesh(new THREE.BoxGeometry(...size), this._material);
      piece.position.set(rng.range(-0.2, 0.2) * s, size[1] / 2 + (i >= 3 ? 0.18 * s : 0), rng.range(-0.2, 0.2) * s);
      piece.rotation.set(rng.range(-0.35, 0.35), rng.range(0, Math.PI * 2), rng.range(-0.35, 0.35), 'YXZ');
    }
    const core = this._addMesh(new THREE.BoxGeometry(0.12 * s, 0.12 * s, 0.12 * s), this._glow);
    core.position.y = 0.42 * s;
  }

  _buildVent() {
    const s = this.node.def.size;
    this._baseColor = [0.32, 0.3, 0.28];
    this._material.metalness = 0;
    this._setGlow(this.node.def.color);
    const ring = this._addMesh(new THREE.CylinderGeometry(0.34 * s, 0.48 * s, 0.22 * s, 24), this._material);
    ring.position.y = 0.11 * s;
    const mouth = this._addMesh(new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 0.02, 24), this._glow);
    mouth.position.y = 0.22 * s + 0.01;
    this._buildPuffs();
  }

  /**
   * The def's model (and depleted variant), turned by a fixed angle per node
   * so a field of wrecks doesn't look copy-pasted, with a hitbox sized to it.
   */
  _buildModel() {
    const def = this.node.def;
    const yaw = seeded(this.node.id).range(0, Math.PI * 2);
    this._model = Models.instance(def.model, def.model_scale).model;
    this._model.rotation.y = yaw;
    this.add(this._model);
    if (def.depleted_model && Models.has(def.depleted_model)) {
      this._depletedModel = Models.instance(def.depleted_model, def.model_scale).model;
      this._depletedModel.rotation.y = yaw;
      this._depletedModel.visible = false;
      this.add(this._depletedModel);
    }
    // A husk takes over from its NPC's collapse: same facing, shown once it lands.
    const dying = EntityView.collapsing.get(`${this.node.tile.x},${this.node.tile.y}`);
    if (def.temporary && dying && dying.isCollapsing()) {
      this._waitingFor = dying;
      this._model.rotation.y = dying.rotation.y;
      if (this._depletedModel) this._depletedModel.rotation.y = dying.rotation.y;
      this.visible = false;
    }
    // Debris can spill past the tile; clicks should still land on this node's tile.
    const box = Models.bounds(this._model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    size.x = Math.min(size.x, MAX_HITBOX_WIDTH);
    size.z = Math.min(size.z, MAX_HITBOX_WIDTH);
    this.add(new Hitbox(HitboxKind.OBJECT, this.node.id, size, new THREE.Vector3(0, center.y, 0)));
  }

  _showModelDepleted(depleted) {
    if (this._depletedModel) {
      this._model.visible = !depleted;
      this._depletedModel.visible = depleted;
      return;
    }
    const s = this.node.def.model_scale;
    this._model.scale.set(s, (depleted ? 0.35 : 1) * s, s);
    this._model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (!mesh.userData.ownMaterial) {
        mesh.material = mesh.material.clone();
        mesh.userData.ownMaterial = true;
        mesh.userData.baseColor = mesh.material.color.clone();
        mesh.userData.baseEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : null;
      }
      const k = depleted ? DEPLETED_SHADE : 1;
      mesh.material.color.copy(mesh.userData.baseColor).multiplyScalar(k);
      if (mesh.userData.baseEmissive) mesh.material.emissive.copy(mesh.userData.baseEmissive).multiplyScalar(k);
    });
  }

  _buildPuffs() {
    const s = this.node.def.size;
    const geometry = new THREE.SphereGeometry(0.13 * s, 12, 8);
    const puffColor = color(lightened(this.node.def.color, 0.4));
    for (let i = 0; i < PUFF_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({ color: puffColor, transparent: true, opacity: 0.35, depthWrite: false });
      const puff = new THREE.Mesh(geometry, material);
      this.add(puff);
      this._puffs.push(puff);
    }
  }

  update(delta) {
    this._clock += delta;
    if (this._waitingFor) {
      if (this._waitingFor.isCollapsing()) return;
      this._waitingFor = null;
      this.visible = true;
    }
    this._animatePuffs();
    const depleted = this.node.isDepleted(ClientState.world.tick);
    if (depleted === this._shownDepleted) return;
    this._shownDepleted = depleted;
    for (const puff of this._puffs) puff.visible = !depleted;
    if (this._model) {
      this._showModelDepleted(depleted);
      return;
    }
    this._pieces.scale.set(1, depleted ? 0.35 : 1, 1);
    this._material.color.copy(color(depleted ? darkened(this._baseColor, 0.55) : this._baseColor));
    this._glow.emissiveIntensity = depleted ? 0 : 1.5;
  }

  /** Puffs rise from the mouth, swell and fade, staggered so one is always going. */
  _animatePuffs() {
    if (this._puffs.length === 0) return;
    const s = this.node.def.size;
    const now = this._clock + this.node.id * 0.37;
    this._puffs.forEach((puff, i) => {
      const t = (((now / PUFF_SECONDS + i / this._puffs.length) % 1) + 1) % 1;
      puff.position.set(Math.sin(t * 5 + i) * 0.06, (0.3 + t * 1.1) * s, Math.cos(t * 4 + i) * 0.06);
      puff.scale.setScalar(0.6 + (1.6 - 0.6) * t);
      puff.material.opacity = 0.35 * (1 - t);
    });
  }

  _setGlow(rgb) {
    this._glow.color.copy(color(rgb));
    this._glow.emissive.copy(color(rgb));
    this._glow.emissiveIntensity = 1.5;
  }

  _addMesh(geometry, material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this._pieces.add(mesh);
    return mesh;
  }
}
