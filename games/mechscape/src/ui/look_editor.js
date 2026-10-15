// Picking how your pilot looks: head, chassis and three colours, with a
// turntable preview. The turntable spins slowly by itself until the player
// turns it: by dragging the preview, or holding the arrows under it. Used on the connect screen (before you join) and in the
// manufactory's Reconfigure window (which sends a SetLookAction).
//
// The last look picked is remembered in this browser and sent when joining.

import * as THREE from 'three';
import { HEADS, CHASSIS, cleanLook } from '../sim/appearance.js';
import { Models } from '../view/models.js';
import { PlayerAppearance } from '../view/player_appearance.js';
import { PLAYER_MODEL } from '../view/world_views.js';
import { el } from './screen.js';

const LOOK_KEY = 'mechscape_look';

/** The look this browser last picked, or null. */
export function savedLook() {
  try {
    const raw = window.localStorage.getItem(LOOK_KEY);
    return raw ? cleanLook(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function rememberLook(look) {
  try {
    window.localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // Then it's picked again next time.
  }
}

const LABELS = { head: 'Head', chassis: 'Chassis', primary: 'Plating', secondary: 'Trim', visor: 'Visor' };
/** Turntable speeds, radians per second: by itself, and while an arrow is held. */
const AUTO_SPIN = 0.29;
const ARROW_SPIN = 2.6;
/** Radians per pixel dragged. */
const DRAG_SPIN = 0.012;

/**
 * The picker. [look] is the starting look; read editor.look for the current
 * one. Call dispose() when it's taken off the page (it stops its renderer).
 */
export class LookEditor {
  constructor(parent, look) {
    this.look = cleanLook(look);
    this.el = el('div', 'look-editor', '', parent);
    const stage = el('div', 'look-stage', '', this.el);
    this._canvas = el('canvas', 'look-preview', '', stage);
    this._canvas.width = 180;
    this._canvas.height = 220;
    this._canvas.title = 'Drag to turn';
    /** Spins by itself until the player turns it once. */
    this._autoSpin = true;
    /** -1 or 1 while an arrow is held, else 0. */
    this._arrow = 0;
    this._turnControls(stage);
    const fields = el('div', 'look-fields', '', this.el);
    this._choice(fields, 'head', HEADS);
    this._choice(fields, 'chassis', CHASSIS);
    for (const key of ['primary', 'secondary', 'visor']) {
      const label = el('label', '', LABELS[key], fields);
      const input = el('input', '', '', label);
      input.type = 'color';
      input.value = this.look[key];
      input.addEventListener('input', () => this._set(key, input.value));
    }
    this._startPreview();
  }

  /** A row of buttons stepping through [options]. */
  _choice(parent, key, options) {
    const row = el('div', 'look-choice', '', parent);
    el('span', 'grow', LABELS[key], row);
    const prev = el('button', '', '‹', row);
    const value = el('span', 'look-value', '', row);
    const next = el('button', '', '›', row);
    const show = () => { value.textContent = this.look[key]; };
    const step = (d) => {
      const i = (options.indexOf(this.look[key]) + d + options.length) % options.length;
      this._set(key, options[i]);
      show();
    };
    prev.type = next.type = 'button';
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    show();
  }

  /** Drag the preview, or hold the arrows under it, to turn the pilot round. */
  _turnControls(stage) {
    let dragX = null;
    this._canvas.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      this._canvas.setPointerCapture(e.pointerId);
      this._canvas.classList.add('dragging');
    });
    this._canvas.addEventListener('pointermove', (e) => {
      if (dragX === null || !this._turntable) return;
      this._turntable.rotation.y += (e.clientX - dragX) * DRAG_SPIN;
      if (e.clientX !== dragX) this._autoSpin = false;
      dragX = e.clientX;
    });
    const endDrag = () => {
      dragX = null;
      this._canvas.classList.remove('dragging');
    };
    this._canvas.addEventListener('pointerup', endDrag);
    this._canvas.addEventListener('pointercancel', endDrag);
    const arrows = el('div', 'look-turn', '', stage);
    for (const [text, dir, title] of [['\u25C0', -1, 'Turn left'], ['\u25B6', 1, 'Turn right']]) {
      const button = el('button', '', text, arrows);
      button.type = 'button';
      button.title = title;
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._arrow = dir;
        this._autoSpin = false;
        button.setPointerCapture(e.pointerId);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(ev, () => { if (this._arrow === dir) this._arrow = 0; });
    }
  }

  _set(key, value) {
    this.look = cleanLook({ ...this.look, [key]: value });
    this._state.look = this.look;
  }

  _startPreview() {
    this._state = { look: this.look, cosmetics: {}, armor: {}, weapon: null, paint: null };
    try {
      this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, antialias: true, alpha: true });
    } catch {
      this._canvas.remove();
      return;
    }
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const { model } = Models.instance(PLAYER_MODEL, 1);
    const turntable = new THREE.Group();
    turntable.add(model);
    scene.add(turntable);
    this._turntable = turntable;
    this._appearance = new PlayerAppearance(model, this._state);
    const box = Models.bounds(model);
    const height = box.max.y - box.min.y;
    const camera = new THREE.PerspectiveCamera(30, this._canvas.width / this._canvas.height, 0.1, 50);
    camera.position.set(0, box.min.y + height * 0.55, height * 2.6);
    camera.lookAt(0, box.min.y + height * 0.5, 0);
    let last = performance.now();
    const frame = () => {
      if (!this._renderer) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (this._arrow) turntable.rotation.y += this._arrow * ARROW_SPIN * dt;
      else if (this._autoSpin) turntable.rotation.y += AUTO_SPIN * dt;
      this._appearance.update();
      this._renderer.render(scene, camera);
      this._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    if (this._renderer) this._renderer.dispose();
    this._renderer = null;
    this.el.remove();
  }
}
