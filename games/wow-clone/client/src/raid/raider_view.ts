// How a raider looks: a capsule in their role's color, a facing nub, and a
// nameplate. Positions come from the server; the view eases toward them.

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ROLE_INFO, type Role } from '../../../shared/roles';
import type { Raider } from '../../../shared/state';

const body = new THREE.CapsuleGeometry(0.45, 1.1, 4, 12);
const nub = new THREE.BoxGeometry(0.25, 0.25, 0.4);

export class RaiderView {
  readonly root = new THREE.Group();
  private label: HTMLDivElement;
  private material: THREE.MeshStandardMaterial;

  constructor(readonly raider: Raider, isMe: boolean) {
    const color = ROLE_INFO[raider.role as Role]?.color ?? 0x999999;
    this.material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const mesh = new THREE.Mesh(body, this.material);
    mesh.position.y = 1;
    mesh.castShadow = true;
    const front = new THREE.Mesh(nub, this.material);
    front.position.set(0, 1.4, -0.5);
    this.root.add(mesh, front);

    this.label = document.createElement('div');
    this.label.className = isMe ? 'nameplate me' : 'nameplate';
    this.label.textContent = raider.name;
    const plate = new CSS2DObject(this.label);
    plate.position.y = 2.4;
    this.root.add(plate);

    this.root.position.set(raider.x, 0, raider.z);
    this.root.rotation.y = raider.facing;
  }

  /** Eases toward the latest server position; [dt] in seconds. */
  update(dt: number) {
    const k = 1 - Math.exp(-dt * 15);
    this.root.position.x += (this.raider.x - this.root.position.x) * k;
    this.root.position.z += (this.raider.z - this.root.position.z) * k;
    let turn = this.raider.facing - this.root.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.root.rotation.y += turn * k;
    this.label.classList.toggle('away', !this.raider.connected);
  }

  dispose() {
    this.material.dispose();
    this.label.remove();
    this.root.removeFromParent();
  }
}
