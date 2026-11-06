// Toggleable debug visuals for getting a feel for the tick system.
//
//   F1  Path: a blue ribbon from the model along every tile still to walk.
//   F2  True tile: a blue outline on the tile the SIMULATION says you're on.
//       It updates once per tick and leads the model by one tick, because
//       views render one tick behind and glide toward it.
//   F3  Metronome: a click on every tick.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { TILE_SIZE, tileToWorld, color } from './tile_math.js';

const BLUE = [0.25, 0.55, 1];
const RIBBON_WIDTH = 0.1;
const RIBBON_HEIGHT = 0.04;
const OUTLINE_WIDTH = 0.07;
const CLICK_HZ = 1400;
const CLICK_SECONDS = 0.04;
const MAX_POINTS = 512;

export class DebugOverlay extends THREE.Group {
  constructor() {
    super();
    this.showPath = false;
    this.showTrueTile = false;
    this.metronome = false;
    this._audio = null;

    this._positions = new Float32Array(MAX_POINTS * 6 * 3 * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage));
    this._ribbon = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: color(BLUE), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }));
    this._ribbon.frustumCulled = false;
    this.add(this._ribbon);

    this._outline = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: color(BLUE) });
    const edge = TILE_SIZE / 2 - OUTLINE_WIDTH / 2;
    for (const [at, size] of [
      [[0, 0, -edge], [TILE_SIZE, 0.02, OUTLINE_WIDTH]],
      [[0, 0, edge], [TILE_SIZE, 0.02, OUTLINE_WIDTH]],
      [[-edge, 0, 0], [OUTLINE_WIDTH, 0.02, TILE_SIZE]],
      [[edge, 0, 0], [OUTLINE_WIDTH, 0.02, TILE_SIZE]],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      bar.position.set(...at);
      this._outline.add(bar);
    }
    this._outline.visible = false;
    this.add(this._outline);

    ClientState.onTick(() => {
      if (this.metronome) this._click();
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'F1') this.showPath = !this.showPath;
      else if (e.key === 'F2') this.showTrueTile = !this.showTrueTile;
      else if (e.key === 'F3') this.metronome = !this.metronome;
      else return;
      e.preventDefault();
    });
  }

  update() {
    const me = ClientState.me();
    this._outline.visible = this.showTrueTile && !!me;
    if (this._outline.visible) tileToWorld(me.tile, 0.03, this._outline.position);
    const count = this.showPath && me ? this._drawRibbon(this._remainingRoute(me)) : 0;
    this._ribbon.geometry.setDrawRange(0, count);
    this._ribbon.geometry.attributes.position.needsUpdate = true;
  }

  /** The model's interpolated position, then the rest of this tick's steps, then every tile left in the sim path. */
  _remainingRoute(me) {
    const route = [];
    const pts = me.steps_this_tick;
    if (pts.length >= 2) {
      const progress = ClientState.tickAlpha * (pts.length - 1);
      const i = Math.min(Math.floor(progress), pts.length - 2);
      const from = tileToWorld(pts[i], RIBBON_HEIGHT);
      const to = tileToWorld(pts[i + 1], RIBBON_HEIGHT);
      route.push(from.lerp(to, progress - i));
      for (let j = i + 1; j < pts.length; j++) route.push(tileToWorld(pts[j], RIBBON_HEIGHT));
    } else {
      route.push(tileToWorld(me.tile, RIBBON_HEIGHT));
    }
    for (const tile of me.path) route.push(tileToWorld(tile, RIBBON_HEIGHT));
    return route.slice(0, MAX_POINTS);
  }

  /** A flat ribbon on the ground (lines are only 1px wide). Returns the vertex count. */
  _drawRibbon(route) {
    if (route.length < 2) return 0;
    const half = RIBBON_WIDTH / 2;
    let n = 0;
    const p = this._positions;
    const push = (v) => {
      p[n * 3] = v.x;
      p[n * 3 + 1] = v.y;
      p[n * 3 + 2] = v.z;
      n++;
    };
    const quad = (a, b, c, d) => [a, b, c, a, c, d].forEach(push);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      if (a.distanceToSquared(b) < 1e-8) continue;
      const side = b.clone().sub(a).normalize().cross(up).multiplyScalar(half);
      quad(a.clone().add(side), a.clone().sub(side), b.clone().sub(side), b.clone().add(side));
    }
    // Square joints so corners don't show gaps.
    for (let i = 1; i < route.length; i++) {
      const q = route[i];
      quad(
        new THREE.Vector3(q.x - half, q.y, q.z - half), new THREE.Vector3(q.x + half, q.y, q.z - half),
        new THREE.Vector3(q.x + half, q.y, q.z + half), new THREE.Vector3(q.x - half, q.y, q.z + half),
      );
    }
    return n;
  }

  /** A short decaying sine blip, generated so the project needs no audio files. */
  _click() {
    try {
      if (!this._audio) this._audio = new AudioContext();
      const ctx = this._audio;
      const samples = Math.floor(ctx.sampleRate * CLICK_SECONDS);
      const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < samples; i++) {
        const t = i / ctx.sampleRate;
        data[i] = Math.sin(2 * Math.PI * CLICK_HZ * t) * Math.exp(-t * 90) * 0.8 * 0.5;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch {
      // No audio available; the metronome stays silent.
    }
  }
}
