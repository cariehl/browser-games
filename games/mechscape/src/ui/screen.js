// Screen-space helpers for DOM overlays drawn over the 3D view: projecting
// world points to pixels, and making the small elements overlays use.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();

export const Screen = {
  /** The camera views render with, set by main.js. */
  camera: null,
  /** The element overlays are added to (covers the canvas). */
  layer: null,
  width: 1,
  height: 1,

  /** [world] (a Vector3) in CSS pixels: { x, y, behind }. */
  project(world) {
    _v.copy(world).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = _v.z >= 0;
    _v.copy(world).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.width, y: (-_v.y * 0.5 + 0.5) * this.height, behind };
  },

  /** A ray from the camera through a screen position (CSS pixels). */
  ray(x, y) {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    return caster.ray;
  },

  /** Where a ray meets the ground (the ground mesh, set by main.js), or null. */
  groundMesh: null,
  groundPoint(ray) {
    if (!this.groundMesh) return null;
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const hit = caster.intersectObject(this.groundMesh, false)[0];
    return hit ? hit.point : null;
  },

  distanceTo(world) {
    return this.camera.getWorldPosition(_cam).distanceTo(world);
  },
};

/** document.createElement with a class, text and parent. */
export function el(tag, className = '', text = '', parent = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

/** A label pinned to a point in the world, kept in place by update(). */
export class WorldLabel {
  constructor(className, parent = Screen.layer) {
    this.el = el('div', 'world-label ' + className, '', parent);
    this.point = new THREE.Vector3();
    this.visible = true;
  }

  update() {
    const p = Screen.project(this.point);
    const show = this.visible && !p.behind;
    this.el.style.display = show ? '' : 'none';
    if (show) this.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  }

  set text(value) {
    if (this.el.textContent !== value) this.el.textContent = value;
  }

  dispose() {
    this.el.remove();
  }
}
