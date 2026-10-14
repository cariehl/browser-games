// Third-person camera that follows a target smoothly every frame, so the
// view never feels like it updates at the 1.67 Hz tick rate.
//
// Controls: middle-mouse drag or arrow keys to orbit, scroll wheel to zoom.

import * as THREE from 'three';

const FOLLOW_SPEED = 10;
const ORBIT_KEY_SPEED = 2; // radians per second
const DRAG_SENSITIVITY = 0.008;
const MIN_PITCH = THREE.MathUtils.degToRad(-80);
const MAX_PITCH = THREE.MathUtils.degToRad(-20);
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 30;
const LOOK_HEIGHT = 0.8;

const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(canvas) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    /** The Object3D followed. */
    this.target = null;
    this.position = new THREE.Vector3();
    this._yaw = THREE.MathUtils.degToRad(45);
    this._pitch = THREE.MathUtils.degToRad(-50);
    this._distance = 14;
    this._dragging = false;
    this._keys = new Set();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        this._dragging = true;
        e.preventDefault();
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 1) this._dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      this._yaw -= e.movementX * DRAG_SENSITIVITY;
      this._pitch = THREE.MathUtils.clamp(this._pitch - e.movementY * DRAG_SENSITIVITY, MIN_PITCH, MAX_PITCH);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.9 : 1.1;
      this._distance = THREE.MathUtils.clamp(this._distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      // Arrow keys belong to a text field while one has focus (debug boxes).
      if (isTyping(e)) return;
      if (e.key.startsWith('Arrow')) {
        this._keys.add(e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.key));
    window.addEventListener('blur', () => this._keys.clear());
  }

  /** Jumps straight to the target (on start). */
  snap() {
    if (this.target) this.position.copy(this.target.position);
    this._apply();
  }

  /** [delta]: real frame time, not scaled by the debug tick speed, so the camera feels the same at any speed. */
  update(delta) {
    const turn = (this._keys.has('ArrowRight') ? 1 : 0) - (this._keys.has('ArrowLeft') ? 1 : 0);
    const tilt = (this._keys.has('ArrowUp') ? 1 : 0) - (this._keys.has('ArrowDown') ? 1 : 0);
    this._yaw += turn * ORBIT_KEY_SPEED * delta;
    this._pitch = THREE.MathUtils.clamp(this._pitch - tilt * ORBIT_KEY_SPEED * delta, MIN_PITCH, MAX_PITCH);
    if (this.target) this.position.lerp(this.target.position, 1 - Math.exp(-FOLLOW_SPEED * delta));
    this._apply();
  }

  _apply() {
    const offset = new THREE.Vector3(0, 0, this._distance).applyAxisAngle(RIGHT, this._pitch).applyAxisAngle(UP, this._yaw);
    const look = this.position.clone();
    look.y += LOOK_HEIGHT;
    this.camera.position.copy(look).add(offset);
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld();
  }
}

/** Whether a key event is going to a text box. */
export function isTyping(event) {
  const t = event.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
