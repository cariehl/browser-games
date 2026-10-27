// A third-person camera orbiting a target, steered like WoW's: left-drag
// looks around, right-drag also turns the character (Controls reads
// `turning`), both buttons run forward, the wheel zooms. A press and release
// without dragging is a click (for targeting).

import * as THREE from 'three';

/** Pixels the pointer can wander before a press counts as a drag. */
const CLICK_SLOP = 5;

export class CameraRig {
  /** What the camera looks at (the player's character), in world space. */
  target = new THREE.Vector3();
  yaw = 0;
  pitch = 0.45;
  distance = 14;
  /** Mouse buttons held on the scene: 1 left, 2 right (PointerEvent.buttons). */
  buttons = 0;
  /** Called with the pointer event when the scene is clicked. */
  onClick = null;

  constructor(canvas) {
    this.canvas = canvas;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('blur', this.onBlur);
  }

  /** Right button held: the character turns with the camera. */
  get turning() {
    return (this.buttons & 2) !== 0;
  }

  /** Left button held without the right: looking around without turning. */
  get looking() {
    return this.buttons === 1;
  }

  /** Both buttons: run forward. */
  get running() {
    return (this.buttons & 3) === 3;
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
    window.removeEventListener('blur', this.onBlur);
  }

  onDown = (e) => {
    this.buttons = e.buttons;
    this.press = { x: e.clientX, y: e.clientY, dragged: false };
    this.canvas.setPointerCapture(e.pointerId);
  };

  onUp = (e) => {
    this.buttons = e.buttons;
    if (this.press && !this.press.dragged && e.buttons === 0) this.onClick?.(e);
    if (e.buttons === 0) this.press = null;
  };

  onMove = (e) => {
    if (!this.press) return;
    // Pressing a second button while holding one arrives as a move.
    this.buttons = e.buttons;
    if (!this.press.dragged && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > CLICK_SLOP) {
      this.press.dragged = true;
    }
    if (!this.press.dragged) return;
    this.yaw -= e.movementX * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.005, 0.05, 1.4);
  };

  onWheel = (e) => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 4, 40);
  };

  onBlur = () => {
    this.buttons = 0;
    this.press = null;
  };

  onContextMenu = (e) => e.preventDefault();
}
