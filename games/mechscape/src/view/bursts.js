// Little particle bursts: confetti from a confetti blade, a splat of paint
// from a paintball. Each burst is a handful of small boxes thrown up and
// falling back, fading out; one InstancedMesh per burst.

import * as THREE from 'three';
import { color } from './tile_math.js';

const SECONDS = 1.3;
const GRAVITY = 7;
const CONFETTI = [[1, 0.3, 0.4], [0.3, 0.8, 1], [1, 0.9, 0.2], [0.5, 1, 0.4], [0.8, 0.4, 1]];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class Bursts {
  constructor(parent) {
    this.parent = parent;
    this.list = [];
  }

  /** [kind]: 'confetti' or 'paint' (with [rgb]). */
  spawn(at, kind, rgb = null) {
    const count = kind === 'confetti' ? 40 : 22;
    const geometry = kind === 'confetti' ? new THREE.BoxGeometry(0.06, 0.01, 0.04) : new THREE.SphereGeometry(0.05, 6, 4);
    const material = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.6 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const bits = [];
    for (let i = 0; i < count; i++) {
      const c = kind === 'confetti' ? CONFETTI[i % CONFETTI.length] : rgb || [1, 0.3, 0.6];
      mesh.setColorAt(i, color(c));
      const a = Math.random() * Math.PI * 2;
      const speed = kind === 'confetti' ? 1 + Math.random() * 2 : 0.8 + Math.random() * 1.6;
      bits.push({
        p: at.clone(),
        v: new THREE.Vector3(Math.cos(a) * speed, 1.5 + Math.random() * 2.5, Math.sin(a) * speed),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      });
    }
    this.parent.add(mesh);
    this.list.push({ mesh, bits, age: 0, floor: at.y - 1.2 });
  }

  update(delta) {
    for (const burst of this.list) {
      burst.age += delta;
      burst.bits.forEach((bit, i) => {
        bit.v.y -= GRAVITY * delta;
        bit.p.addScaledVector(bit.v, delta);
        if (bit.p.y < burst.floor) {
          bit.p.y = burst.floor;
          bit.v.set(0, 0, 0);
        }
        _e.set(bit.r.x * burst.age, bit.r.y * burst.age, bit.r.z * burst.age);
        _q.setFromEuler(_e);
        _s.setScalar(1);
        _m.compose(bit.p, _q, _s);
        burst.mesh.setMatrixAt(i, _m);
      });
      burst.mesh.instanceMatrix.needsUpdate = true;
      burst.mesh.material.opacity = Math.max(0, 1 - Math.max(0, burst.age - SECONDS * 0.5) / (SECONDS * 0.5));
    }
    for (const burst of this.list.filter((b) => b.age >= SECONDS)) {
      burst.mesh.removeFromParent();
      burst.mesh.geometry.dispose();
      burst.mesh.material.dispose();
    }
    this.list = this.list.filter((b) => b.age < SECONDS);
  }
}
