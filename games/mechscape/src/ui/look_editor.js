// Picking how your pilot looks: head, chassis and three colours, with a
// turntable preview. Used on the connect screen (before you join) and in the
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

/**
 * The picker. [look] is the starting look; read editor.look for the current
 * one. Call dispose() when it's taken off the page (it stops its renderer).
 */
export class LookEditor {
  constructor(parent, look) {
    this.look = cleanLook(look);
    this.el = el('div', 'look-editor', '', parent);
    this._canvas = el('canvas', 'look-preview', '', this.el);
    this._canvas.width = 180;
    this._canvas.height = 220;
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
    this._appearance = new PlayerAppearance(model, this._state);
    const box = Models.bounds(model);
    const height = box.max.y - box.min.y;
    const camera = new THREE.PerspectiveCamera(30, this._canvas.width / this._canvas.height, 0.1, 50);
    camera.position.set(0, box.min.y + height * 0.55, height * 2.6);
    camera.lookAt(0, box.min.y + height * 0.5, 0);
    const frame = () => {
      if (!this._renderer) return;
      turntable.rotation.y += 0.012;
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
