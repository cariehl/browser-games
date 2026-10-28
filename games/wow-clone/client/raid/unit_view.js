// How a unit looks: raiders are capsules in their role's color with a facing
// nub; enemies are built by kind. Each has a nameplate with a health bar and
// a ring that shows when it's selected. Positions come from the server and
// the view eases toward them (the player's own comes from prediction).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { radiusOf } from '../../shared/combat.js';
import { ROLE_INFO } from '../../shared/roles.js';
import { el } from '../dom.js';

const capsule = new THREE.CapsuleGeometry(0.45, 1.1, 4, 12);
const nub = new THREE.BoxGeometry(0.25, 0.25, 0.4);
const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const deadColor = new THREE.Color(0x55525c);

/** The meshes for an enemy [kind]: { parts, height }. */
function enemyBody(kind, material) {
  const group = new THREE.Group();
  const add = (geo, x, y, z, mat = material) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  if (kind === 'golem') {
    add(new THREE.BoxGeometry(2, 2.2, 1.4), 0, 2.1, 0);
    add(new THREE.BoxGeometry(1, 0.9, 0.9), 0, 3.6, -0.1);
    add(new THREE.BoxGeometry(0.6, 2, 0.6), -1.35, 1.9, 0);
    add(new THREE.BoxGeometry(0.6, 2, 0.6), 1.35, 1.9, 0);
    add(new THREE.BoxGeometry(0.7, 1.1, 0.7), -0.5, 0.55, 0);
    add(new THREE.BoxGeometry(0.7, 1.1, 0.7), 0.5, 0.55, 0);
    const eye = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    add(new THREE.BoxGeometry(0.18, 0.12, 0.05), -0.22, 3.7, -0.56, eye);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.05), 0.22, 3.7, -0.56, eye);
    return { group, height: 4.6 };
  }
  // The training dummy: a post, a crossbar and a sack head.
  add(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 8), 0, 0.6, 0);
  add(new THREE.CylinderGeometry(0.45, 0.4, 1.1, 10), 0, 1.6, 0);
  add(new THREE.BoxGeometry(1.6, 0.15, 0.15), 0, 1.85, 0);
  add(new THREE.SphereGeometry(0.32, 12, 10), 0, 2.4, 0);
  return { group, height: 3.1 };
}

export class UnitView {
  root = new THREE.Group();

  /** [unit]: its synced Raider or Enemy state. [isMe]: the player's own character. */
  constructor(id, unit, { enemy, isMe }) {
    this.id = id;
    this.unit = unit;
    this.enemy = enemy;
    const color = enemy ? (unit.kind === 'golem' ? 0x7d7a85 : 0xc9a46a) : (ROLE_INFO[unit.role]?.color ?? 0x999999);
    this.color = new THREE.Color(color);
    this.material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

    this.body = new THREE.Group();
    let height = 2.4;
    if (enemy) {
      const built = enemyBody(unit.kind, this.material);
      this.body.add(built.group);
      height = built.height;
    } else {
      const mesh = new THREE.Mesh(capsule, this.material);
      mesh.position.y = 1;
      mesh.castShadow = true;
      const front = new THREE.Mesh(nub, this.material);
      front.position.set(0, 1.4, -0.5);
      this.body.add(mesh, front);
    }
    this.root.add(this.body);

    // An invisible cylinder to click on, the size of the body.
    const radius = radiusOf(unit);
    this.hitbox = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.2, radius + 0.2, height, 10),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = height / 2;
    this.hitbox.userData.unitId = id;
    this.root.add(this.hitbox);

    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.85, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.scale.setScalar(radius + 0.35);
    this.ring.visible = false;
    this.root.add(this.ring);

    this.label = el('div', `nameplate${isMe ? ' me' : ''}${enemy ? ' enemy' : ''}`);
    this.nameEl = el('div', 'plate-name', unit.name);
    this.bar = el('div', 'plate-bar');
    this.fill = el('div', 'fill');
    this.bar.append(this.fill);
    this.label.append(this.nameEl, this.bar);
    this.plate = new CSS2DObject(this.label);
    this.plate.position.y = height + 0.3;
    this.root.add(this.plate);
    this.height = height;

    this.root.position.set(unit.x, 0, unit.z);
    this.root.rotation.y = unit.facing;
  }

  /** Shows or hides the selection ring; red for enemies, green for friends. */
  setSelected(selected) {
    this.ring.visible = selected;
    this.ringMaterial.color.set(this.enemy ? 0xe0503c : 0x5cd17a);
  }

  /**
   * Eases toward [pose] ({ x, z, facing }: the server's, or the prediction),
   * [height] off the ground (jumping); [dt] in seconds.
   */
  update(dt, pose = this.unit, height = 0) {
    this.root.position.y = height;
    this.ring.position.y = 0.05 - height; // The selection ring stays on the floor.
    const k = 1 - Math.exp(-dt * 15);
    this.root.position.x += (pose.x - this.root.position.x) * k;
    this.root.position.z += (pose.z - this.root.position.z) * k;
    let turn = pose.facing - this.root.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.root.rotation.y += turn * k;

    const dead = this.unit.health <= 0;
    // The dead topple over and grey out.
    const lie = dead ? Math.PI / 2 : 0;
    this.body.rotation.x += (lie - this.body.rotation.x) * (1 - Math.exp(-dt * 8));
    this.material.color.copy(dead ? deadColor : this.color);

    const frac = this.unit.maxHealth ? Math.max(0, this.unit.health / this.unit.maxHealth) : 0;
    this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.label.classList.toggle('dead', dead);
    this.label.classList.toggle('away', !this.enemy && !this.unit.connected);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry && o.geometry !== capsule && o.geometry !== nub && o.geometry !== ringGeo) o.geometry.dispose();
    });
    this.material.dispose();
    this.ringMaterial.dispose();
    this.label.remove();
    this.root.removeFromParent();
  }
}
