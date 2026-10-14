// Dresses a player's android model from their state: the per-player colour
// on the PL_Primary material, each armor slot's piece tinting its body part
// (PL_Head, PL_Torso, PL_Arms, PL_Legs), and the wielded weapon in the right
// hand. Reads state, never writes it. Checks for changes every frame, which
// is cheap: it only rebuilds when the gear actually changes.
//
// Weapons are simple shapes per weapon type, in the item's colour, until
// items get their own held models.

import * as THREE from 'three';
import { color, lightened } from './tile_math.js';

/** Body-part material -> the armor slot that tints it. */
const PART_SLOTS = { PL_Head: 'head', PL_Torso: 'torso', PL_Arms: 'arms', PL_Legs: 'legs' };
const PRIMARY = 'PL_Primary';
const HAND_BONE = 'hand_R';
/** Bare plating, when no armor is worn in that slot. */
const BARE = [0.78, 0.8, 0.82];

export class PlayerAppearance {
  constructor(model, state) {
    this.state = state;
    /** The player's own colour (WorldViews sets it from their id). */
    this.primary = [0.85, 0.55, 0.25];
    /** Material name -> the (per-player) material using it. */
    this._materials = new Map();
    model.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      const own = list.map((material) => {
        if (!material || !material.name) return material;
        if (!this._materials.has(material.name)) this._materials.set(material.name, material.clone());
        return this._materials.get(material.name);
      });
      node.material = Array.isArray(node.material) ? own : own[0];
    });
    this._hand = model.getObjectByName(HAND_BONE) || null;
    this._held = null;
    this._shownKey = '';
    this.update();
  }

  update() {
    const state = this.state;
    const armor = Object.entries(state.armor).map(([slot, item]) => `${slot}:${item.id}`).sort().join(',');
    const key = `${this.primary}|${state.weapon ? state.weapon.id : ''}|${armor}`;
    if (key === this._shownKey) return;
    this._shownKey = key;
    this._tint(PRIMARY, this.primary);
    for (const [part, slot] of Object.entries(PART_SLOTS)) {
      const worn = state.armor[slot];
      this._tint(part, worn ? lightened(worn.color, 0.15) : BARE);
    }
    this._showWeapon(state.weapon);
  }

  _tint(name, rgb) {
    const material = this._materials.get(name);
    if (material && material.color) material.color.copy(color(rgb));
  }

  _showWeapon(weapon) {
    if (this._held) {
      this._held.removeFromParent();
      this._held.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          node.material.dispose();
        }
      });
      this._held = null;
    }
    if (!weapon || !this._hand) return;
    this._held = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: color(weapon.color), metalness: 0.6, roughness: 0.4 });
    const grip = new THREE.MeshStandardMaterial({ color: color([0.12, 0.12, 0.13]) });
    // In the hand bone's space the fingers point down its +Y, and forward
    // (out of the fist) is -Z.
    if (weapon.weapon_type && weapon.weapon_type.id === 'pistol') {
      this._box([0.05, 0.05, 0.26], [0, 0.08, -0.08], metal);
      this._box([0.045, 0.12, 0.06], [0, 0.04, 0.03], grip.clone());
    } else {
      this._box([0.03, 0.05, 0.62], [0, 0.07, -0.38], metal);
      this._box([0.14, 0.04, 0.04], [0, 0.07, -0.06], grip.clone());
    }
    grip.dispose();
    this._hand.add(this._held);
  }

  _box(size, at, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.castShadow = true;
    this._held.add(mesh);
  }
}
