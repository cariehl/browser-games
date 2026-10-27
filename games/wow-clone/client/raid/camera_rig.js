// A third-person camera orbiting a target, steered like WoW's: left-drag
// looks around, right-drag also turns the character (Controls reads
// `turning`), both buttons run forward, the wheel zooms. The cursor hides
// while dragging. A press and release without dragging is a click (for
// targeting). The middle and side buttons are reported as key codes
// ('Mouse3', 'Mouse4', 'Mouse5') so they can be bound like keys.

import * as THREE from 'three';

/** Pixels the pointer can wander before a press counts as a drag. */
const CLICK_SLOP = 5;

/** PointerEvent.buttons bits of the bindable buttons, and their codes. */
const BINDABLE = [[4, 'Mouse3'], [8, 'Mouse4'], [16, 'Mouse5']];

export class CameraRig {
  /** What the camera looks at (the player's character), in world space. */
  target = new THREE.Vector3();
  yaw = 0;
  pitch = 0.45;
  distance = 14;
  /** Mouse buttons held on the scene (PointerEvent.buttons bits). */
  buttons = 0;
  /** Called with (button, event) when the scene is left-clicked (0) or right-clicked (2). */
  onClick = null;
  /** Called with a code ('Mouse3'...) when a bindable button goes down or up. */
  onButtonDown = null;
  onButtonUp = null;

  constructor(canvas) {
    this.canvas = canvas;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Right button held: the character turns with the camera. */
  get turning() {
    return (this.buttons & 2) !== 0;
  }

  /** Left button held without the right: looking around without turning. */
  get looking() {
    return (this.buttons & 3) === 1;
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
    this.unlock();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Tracks which buttons are held, reporting bindable ones that changed. */
  setButtons(buttons) {
    for (const [bit, code] of BINDABLE) {
      if (buttons & bit && !(this.buttons & bit)) this.onButtonDown?.(code);
      if (!(buttons & bit) && this.buttons & bit) this.onButtonUp?.(code);
    }
    this.buttons = buttons;
  }

  onDown = (e) => {
    this.setButtons(e.buttons);
    if (!this.press && (e.button === 0 || e.button === 2)) {
      this.press = { x: e.clientX, y: e.clientY, button: e.button, dragged: false };
      this.canvas.setPointerCapture(e.pointerId);
    }
  };

  onUp = (e) => {
    const released = this.buttons & ~e.buttons;
    this.setButtons(e.buttons);
    if (!this.press || e.buttons & 3) return;
    // Left and right are both up: the press is over.
    if (!this.press.dragged && released & 3) this.onClick?.(this.press.button, e);
    this.press = null;
    this.unlock();
  };

  onMove = (e) => {
    // Pressing a second button while holding one arrives as a move.
    this.setButtons(e.buttons);
    if (!this.press) return;
    if (!this.press.dragged && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > CLICK_SLOP) {
      this.press.dragged = true;
      // Hide the cursor and keep it in place while dragging, as WoW does.
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
    }
    if (!this.press.dragged) return;
    this.yaw -= e.movementX * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.005, 0.05, 1.4);
  };

  unlock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** No middle-click autoscroll. */
  onMouseDown = (e) => {
    if (e.button === 1) e.preventDefault();
  };

  /** The side buttons would go back and forward in the browser's history. */
  onMouseUp = (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  };

  onWheel = (e) => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 4, 40);
  };

  onBlur = () => {
    this.setButtons(0);
    this.press = null;
    this.unlock();
  };

  onContextMenu = (e) => e.preventDefault();
}
