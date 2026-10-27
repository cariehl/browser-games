// A third-person camera orbiting a target: drag with either mouse button to
// look around, wheel to zoom. Step 2 makes right-drag also turn the character.

import * as THREE from 'three';

export class CameraRig {
  /** What the camera looks at (the player's character), in world space. */
  target = new THREE.Vector3();
  yaw = 0;
  pitch = 0.45;
  distance = 14;
  dragging = false;

  constructor(canvas) {
    this.canvas = canvas;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update() {
    const flat = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * flat,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * flat,
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
  }

  onDown = (e) => {
    this.dragging = true;
    this.canvas.setPointerCapture(e.pointerId);
  };

  onUp = () => {
    this.dragging = false;
  };

  onMove = (e) => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.005, 0.05, 1.4);
  };

  onWheel = (e) => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 4, 40);
  };

  onContextMenu = (e) => e.preventDefault();
}
