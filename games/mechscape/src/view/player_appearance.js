// Dresses a player's android model from their state: their look (head and
// chassis parts, visor, primary and secondary colours), armor tinting the
// body part it covers, cosmetics worn on top (a hat, a decal, a paint job),
// the wielded weapon in the right hand, and paint from a paintball. Reads
// state, never writes it, and only rebuilds when something changes.
//
// player.glb is one skinned mesh, so other head and chassis shapes are
// procedural shells attached to the head and chest bones, over (or instead
// of) the model's own. In those bones' space +Y is up and +Z is forward.

import * as THREE from 'three';
import { color, lightened } from './tile_math.js';

/** Body-part material -> the armor slot that tints it. */
const PART_SLOTS = { PL_Head: 'head', PL_Torso: 'torso', PL_Arms: 'arms', PL_Legs: 'legs' };
const PRIMARY = 'PL_Primary';
const VISOR = 'PL_Visor';
const HAND_BONE = 'hand_R';
const HEAD_BONE = 'head';
const CHEST_BONE = 'chest';
/** How far above the head bone each head's top is, for hats. */
const HEAD_TOP = { standard: 0.24, dome: 0.3, crest: 0.27, mono: 0.25 };
/** Paint jobs: colours (and shine) that replace your own. */
const PAINT_JOBS = {
  hazard: { primary: [0.95, 0.78, 0.1], secondary: [0.16, 0.16, 0.17] },
  chrome: { primary: [0.88, 0.9, 0.93], secondary: [0.72, 0.75, 0.78], metal: true },
  rust: { primary: [0.55, 0.29, 0.15], secondary: [0.42, 0.25, 0.17] },
};

/** '#rrggbb' -> [r, g, b] in 0..1. */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export class PlayerAppearance {
  /** [state]: anything with look, cosmetics, armor, weapon and paint (a preview passes a plain object). */
  constructor(model, state) {
    this.state = state;
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
    this._head = model.getObjectByName(HEAD_BONE) || null;
    this._chest = model.getObjectByName(CHEST_BONE) || null;
    /** Procedural pieces we've added: { held, head, chassis, hat, decal }. */
    this._parts = {};
    this._shells = { base: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.3 }), primary: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), visor: new THREE.MeshStandardMaterial({ emissiveIntensity: 1.3 }), dark: new THREE.MeshStandardMaterial({ color: color([0.14, 0.15, 0.17]), roughness: 0.7 }) };
    this._shownKey = '';
    this._paintKey = '';
    this.update();
  }

  update() {
    const state = this.state;
    const look = state.look || {};
    const cosmetics = state.cosmetics || {};
    const armor = Object.entries(state.armor || {}).map(([slot, item]) => `${slot}:${item.id}`).sort().join(',');
    const worn = Object.entries(cosmetics).map(([part, item]) => `${part}:${item.id}`).sort().join(',');
    const key = `${JSON.stringify(look)}|${state.weapon ? state.weapon.id : ''}|${armor}|${worn}`;
    const paint = state.paint ? state.paint.color.join(',') : '';
    if (key === this._shownKey && paint === this._paintKey) return;
    if (key !== this._shownKey) {
      this._shownKey = key;
      this._dress(look, cosmetics, state);
    }
    this._paintKey = paint;
    this._applyPaint(state.paint);
  }

  _dress(look, cosmetics, state) {
    const job = cosmetics.paint ? PAINT_JOBS[cosmetics.paint.cosmetic_look] : null;
    const primary = job ? job.primary : hexToRgb(look.primary || '#d98c40');
    const secondary = job ? job.secondary : hexToRgb(look.secondary || '#c7ccd1');
    const visor = hexToRgb(look.visor || '#59d9ff');
    this._colors = { primary, secondary, visor, metal: job && job.metal };
    // Tints are remembered so paint can be laid over them and taken off again.
    this._base = new Map();
    this._tint(PRIMARY, primary);
    for (const [part, slot] of Object.entries(PART_SLOTS)) {
      const piece = state.armor && state.armor[slot];
      this._tint(part, piece ? lightened(piece.color, 0.15) : secondary);
    }
    this._tint(VISOR, visor);
    const visorMaterial = this._materials.get(VISOR);
    if (visorMaterial && visorMaterial.emissive) visorMaterial.emissive.copy(color(visor)).multiplyScalar(0.6);
    for (const name of [PRIMARY, ...Object.keys(PART_SLOTS)]) {
      const m = this._materials.get(name);
      if (!m || !('metalness' in m)) continue;
      if (m.userData.metal === undefined) m.userData.metal = m.metalness;
      m.metalness = job && job.metal ? 0.85 : m.userData.metal;
    }
    const helmet = state.armor && state.armor.head;
    this._shells.base.color.copy(color(helmet ? lightened(helmet.color, 0.15) : secondary));
    this._shells.base.metalness = job && job.metal ? 0.85 : 0.3;
    this._shells.primary.color.copy(color(primary));
    this._shells.primary.metalness = job && job.metal ? 0.85 : 0.3;
    this._shells.visor.color.copy(color(visor));
    this._shells.visor.emissive.copy(color(visor)).multiplyScalar(0.8);
    for (const m of Object.values(this._shells)) this._base.set(m, m.color.clone());

    const head = look.head || 'standard';
    // A different head hides the model's own (its plating and visor).
    for (const name of ['PL_Head', VISOR]) {
      const m = this._materials.get(name);
      if (m) m.visible = head === 'standard';
    }
    this._replace('head', this._head, head === 'standard' ? null : buildHead(head, this._shells));
    this._replace('chassis', this._chest, buildChassis(look.chassis || 'standard', this._shells));
    const hat = cosmetics.hat ? buildHat(cosmetics.hat, HEAD_TOP[head] || 0.24) : null;
    this._replace('hat', this._head, hat);
    const decal = cosmetics.decal ? buildDecal(cosmetics.decal) : null;
    this._replace('decal', cosmetics.decal && cosmetics.decal.cosmetic_look === 'wings' ? this._chest : this._head, decal);
    this._replace('held', this._hand, state.weapon ? buildWeapon(state.weapon) : null);
  }

  _tint(name, rgb) {
    const material = this._materials.get(name);
    if (!material || !material.color) return;
    material.color.copy(color(rgb));
    this._base.set(material, material.color.clone());
  }

  /** Paint from a paintball: everything leans towards its colour until it wears off. */
  _applyPaint(paint) {
    const splat = paint ? color(paint.color) : null;
    for (const [material, base] of this._base) {
      material.color.copy(base);
      if (splat) material.color.lerp(splat, 0.6);
    }
  }

  _replace(slot, bone, group) {
    const old = this._parts[slot];
    if (old) {
      old.removeFromParent();
      old.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          if (node.material.userData.own) node.material.dispose();
        }
      });
    }
    this._parts[slot] = null;
    if (!group || !bone) return;
    group.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    bone.add(group);
    this._parts[slot] = group;
  }
}

/** A mesh with its own material (disposed with it). */
function part(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

function own(rgb, extra = {}) {
  const material = new THREE.MeshStandardMaterial({ color: color(rgb), roughness: 0.6, metalness: 0.2, ...extra });
  material.userData.own = true;
  return material;
}

/** Heads other than the model's own, in head-bone space (the head's middle is about 0.13 up). */
function buildHead(kind, m) {
  const g = new THREE.Group();
  if (kind === 'dome') {
    g.add(part(new THREE.SphereGeometry(0.155, 16, 12), m.base, 0, 0.14, 0));
    g.add(part(new THREE.BoxGeometry(0.24, 0.055, 0.08), m.visor, 0, 0.15, 0.115));
    g.add(part(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 14), m.primary, 0, 0.0, 0));
  } else if (kind === 'crest') {
    g.add(part(new THREE.BoxGeometry(0.24, 0.24, 0.26), m.base, 0, 0.13, 0));
    g.add(part(new THREE.BoxGeometry(0.035, 0.1, 0.3), m.primary, 0, 0.28, -0.01));
    g.add(part(new THREE.BoxGeometry(0.2, 0.045, 0.02), m.visor, 0, 0.15, 0.135));
    g.add(part(new THREE.BoxGeometry(0.26, 0.05, 0.05), m.dark, 0, 0.02, 0.1));
  } else if (kind === 'mono') {
    g.add(part(new THREE.CylinderGeometry(0.13, 0.14, 0.24, 16), m.base, 0, 0.13, 0));
    g.add(part(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 16), m.dark, 0, 0.14, 0.13, Math.PI / 2));
    g.add(part(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), m.visor, 0, 0.14, 0.16, Math.PI / 2));
    g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), m.dark, 0.08, 0.3, -0.05));
    g.add(part(new THREE.SphereGeometry(0.02, 8, 6), m.primary, 0.08, 0.36, -0.05));
  }
  return g;
}

/** Chassis shells, in chest-bone space (the torso runs from about -0.3 to +0.3 up). */
function buildChassis(kind, m) {
  if (kind === 'standard') return null;
  const g = new THREE.Group();
  if (kind === 'heavy') {
    for (const side of [-1, 1]) {
      g.add(part(new THREE.BoxGeometry(0.17, 0.1, 0.22), m.primary, side * 0.27, 0.27, 0, 0, 0, side * -0.25));
      g.add(part(new THREE.BoxGeometry(0.12, 0.05, 0.2), m.dark, side * 0.3, 0.2, 0, 0, 0, side * -0.25));
    }
    g.add(part(new THREE.BoxGeometry(0.36, 0.26, 0.05), m.base, 0, 0.1, 0.13));
    g.add(part(new THREE.BoxGeometry(0.3, 0.3, 0.1), m.dark, 0, 0.12, -0.15));
  } else if (kind === 'sleek') {
    for (const side of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.025, 0.32, 0.14), m.primary, side * 0.07, 0.2, -0.16, -0.35));
    g.add(part(new THREE.TorusGeometry(0.12, 0.025, 6, 16), m.primary, 0, 0.32, 0, Math.PI / 2));
    g.add(part(new THREE.BoxGeometry(0.16, 0.04, 0.03), m.visor, 0, 0.18, 0.125));
  }
  return g;
}

/** Hats sit on top of the head; [top] is how high that is. */
function buildHat(item, top) {
  const g = new THREE.Group();
  const c = item.color;
  switch (item.cosmetic_look) {
    case 'cone':
      g.add(part(new THREE.ConeGeometry(0.11, 0.26, 14), own(c), 0, top + 0.12, 0));
      g.add(part(new THREE.CylinderGeometry(0.075, 0.085, 0.04, 14), own([0.95, 0.95, 0.95]), 0, top + 0.08, 0));
      g.add(part(new THREE.BoxGeometry(0.24, 0.02, 0.24), own(c), 0, top, 0));
      break;
    case 'antenna':
      g.add(part(new THREE.CylinderGeometry(0.01, 0.012, 0.3, 6), own(c, { metalness: 0.7 }), 0.05, top + 0.15, 0));
      g.add(part(new THREE.SphereGeometry(0.03, 10, 8), own([1, 0.25, 0.2], { emissive: color([1, 0.2, 0.1]), emissiveIntensity: 1.5 }), 0.05, top + 0.31, 0));
      g.add(part(new THREE.BoxGeometry(0.16, 0.012, 0.012), own(c), 0.05, top + 0.22, 0));
      break;
    case 'crown':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.add(part(new THREE.BoxGeometry(0.035, 0.07, 0.02), own(c, { metalness: 0.8, roughness: 0.3 }), Math.sin(a) * 0.1, top + 0.03, Math.cos(a) * 0.1, 0, a));
      }
      g.add(part(new THREE.TorusGeometry(0.1, 0.012, 6, 18), own(c, { metalness: 0.8, roughness: 0.3 }), 0, top, 0, Math.PI / 2));
      break;
    case 'surveyor':
      g.add(part(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 20), own(c), 0, top, 0));
      g.add(part(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 16), own(c), 0, top + 0.05, 0));
      g.add(part(new THREE.CylinderGeometry(0.122, 0.122, 0.02, 16), own([0.3, 0.2, 0.12]), 0, top + 0.02, 0));
      break;
    default:
      return null;
  }
  return g;
}

function buildDecal(item) {
  const g = new THREE.Group();
  const glow = own(item.color, { emissive: color(item.color), emissiveIntensity: 0.6 });
  if (item.cosmetic_look === 'flames') {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) g.add(part(new THREE.ConeGeometry(0.025, 0.1 + i * 0.03, 4), glow, side * 0.165, 0.1 + i * 0.03, -0.02 - i * 0.04, -1.1, 0, 0));
    }
  } else if (item.cosmetic_look === 'wings') {
    for (const side of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.12, 0.03, 0.01), glow, side * 0.07, 0.2, 0.135, 0, 0, side * 0.3));
    g.add(part(new THREE.SphereGeometry(0.025, 8, 6), glow, 0, 0.2, 0.135));
  } else {
    return null;
  }
  return g;
}

/** Weapons are simple shapes per weapon type, in the item's colour. In the hand bone's space the fingers point down +Y and forward is -Z. */
function buildWeapon(weapon) {
  const g = new THREE.Group();
  const metal = own(weapon.color, { metalness: 0.6, roughness: 0.4 });
  const grip = own([0.12, 0.12, 0.13]);
  const type = weapon.weapon_type ? weapon.weapon_type.id : '';
  if (type === 'pistol') {
    g.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.26), metal, 0, 0.08, -0.08));
    g.add(part(new THREE.BoxGeometry(0.045, 0.12, 0.06), grip, 0, 0.04, 0.03));
  } else if (type === 'cannon') {
    g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 12), metal, 0, 0.09, -0.12, Math.PI / 2));
    g.add(part(new THREE.SphereGeometry(0.08, 12, 8), own([0.95, 0.4, 0.75]), 0, 0.17, 0.04));
    g.add(part(new THREE.BoxGeometry(0.045, 0.12, 0.06), grip, 0, 0.03, 0.03));
  } else {
    g.add(part(new THREE.BoxGeometry(0.03, 0.05, 0.62), metal, 0, 0.07, -0.38));
    g.add(part(new THREE.BoxGeometry(0.14, 0.04, 0.04), grip, 0, 0.07, -0.06));
    if (weapon.fun_effect === 'confetti') {
      for (let i = 0; i < 6; i++) g.add(part(new THREE.BoxGeometry(0.03, 0.03, 0.03), own([[1, 0.3, 0.4], [0.3, 0.8, 1], [1, 0.9, 0.2]][i % 3]), (i % 2 ? 0.03 : -0.03), 0.07, -0.2 - i * 0.07));
    }
  }
  return g;
}

/** Paint on an NPC's model: its materials, copied on first use, lean towards the paint's colour. */
export class PaintTint {
  constructor(model) {
    this.model = model;
    this._materials = null;
    this._key = '';
  }

  update(paint) {
    const key = paint ? paint.color.join(',') : '';
    if (key === this._key) return;
    this._key = key;
    if (!this._materials) {
      if (!paint) return;
      this._materials = [];
      this.model.traverse((node) => {
        if (!node.isMesh) return;
        const copy = (m) => {
          const c = m.clone();
          this._materials.push({ material: c, base: c.color ? c.color.clone() : null });
          return c;
        };
        node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      });
    }
    const splat = paint ? color(paint.color) : null;
    for (const { material, base } of this._materials) {
      if (!base) continue;
      material.color.copy(base);
      if (splat) material.color.lerp(splat, 0.6);
    }
  }
}
