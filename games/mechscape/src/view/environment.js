// The light and the sky: a sun with shadows and a flat ambient, a sky dome
// that fades from its zenith down to the haze at the horizon, ranges of
// hills far off in that haze, distance fog in the haze's colour, and an
// endless floor under the fog so the land never ends in an edge. Colours
// and distances are in data/scenery.json ("sky": "day", and "dark" for
// underground areas, where there's no sky, ridges or floor).
//
// The dome, the ridges and the floor follow the camera, like a skybox: you
// can walk towards the hills all day.

import * as THREE from 'three';
import { Content } from '../sim/defs.js';
import { color, seeded } from './tile_math.js';

const DOME_RADIUS = 360;
/** Ranges of hills round the horizon: radius (m), height (m), how far into the haze (0 = all haze). */
const RIDGES = [[330, 46, 0.32], [270, 30, 0.5]];
const RIDGE_STEPS = 160;

const DEFAULT_SKY = {
  day: { horizon: [0.55, 0.62, 0.68], zenith: [0.36, 0.5, 0.66], ridges: [0.36, 0.42, 0.46], fog_near: 60, fog_far: 140, ambient: 0.6, sun: 1 },
  dark: { horizon: [0.04, 0.045, 0.06], zenith: [0.04, 0.045, 0.06], fog_near: 10, fog_far: 34, ambient: 0.16, sun: 0.12 },
};

/**
 * Lights and sky for [scene]. Call update(camera, focus, area) every frame:
 * [focus] is what the camera looks at, [area] the local player's area.
 * [backdrop] (from buildBackdrop) says which floor goes under which area.
 */
export class Environment {
  constructor(scene, backdrop) {
    const sky = { ...DEFAULT_SKY, ...((Content.scenery && Content.scenery.sky) || {}) };
    this.moods = { day: { ...DEFAULT_SKY.day, ...sky.day }, dark: { ...DEFAULT_SKY.dark, ...sky.dark } };
    this.scene = scene;
    this.backdrop = backdrop;
    this.ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(this.ambient);
    // Matches the Godot scene: a sun at rotation (-55°, 35°, 0°). Godot's light
    // energy 1 is three.js intensity π (three divides diffuse light by π; Godot doesn't).
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.travel = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(-55), THREE.MathUtils.degToRad(35), 0, 'YXZ',
    ));
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -22;
    s.right = 22;
    s.top = 22;
    s.bottom = -22;
    s.near = 1;
    s.far = 120;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    scene.fog = new THREE.Fog(0xffffff, 60, 140);

    this.dome = buildDome();
    this.ridges = new THREE.Group();
    RIDGES.forEach(([radius, height, depth], i) => this.ridges.add(buildRidge(radius, height, depth, i)));
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    );
    this.floor.receiveShadow = true;
    scene.add(this.dome, this.ridges, this.floor);
    this._mood = null;
    this._region = undefined;
  }

  update(camera, focus, area) {
    const sun = this.sun;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(this.travel, -50);
    const region = area && !area.dark && this.backdrop ? this.backdrop.regionOf(area.id) : null;
    this._setMood(area && area.dark ? 'dark' : 'day');
    if (region !== this._region) {
      this._region = region;
      this.floor.visible = !!region;
      if (region) {
        const ground = region.data.ground || {};
        this.floor.material.color.copy(color(region.floorColor || floorColorOf(ground)));
        this.floor.position.y = region.floorY;
      }
    }
    this.dome.position.copy(camera.position);
    this.ridges.position.set(camera.position.x, region ? region.floorY : 0, camera.position.z);
    this.floor.position.x = camera.position.x;
    this.floor.position.z = camera.position.z;
  }

  _setMood(name) {
    if (this._mood === name) return;
    this._mood = name;
    const mood = this.moods[name];
    const horizon = color(mood.horizon);
    this.scene.background = horizon;
    this.scene.fog.color.copy(horizon);
    this.scene.fog.near = mood.fog_near;
    this.scene.fog.far = mood.fog_far;
    this.ambient.color.copy(color(mood.ambient_color || [0.6, 0.62, 0.66]));
    this.ambient.intensity = mood.ambient * Math.PI;
    this.sun.intensity = mood.sun * Math.PI;
    const u = this.dome.material.uniforms;
    u.horizon.value.copy(horizon);
    u.zenith.value.copy(color(mood.zenith || mood.horizon));
    this.ridges.visible = !!mood.ridges;
    if (mood.ridges) {
      for (const ridge of this.ridges.children) {
        ridge.material.uniforms.horizon.value.copy(horizon);
        ridge.material.uniforms.ridge.value.copy(color(mood.ridges));
      }
    }
  }
}

function floorColorOf(ground) {
  const def = ground.color && Content.ground[ground.color];
  return def ? def.color : [0.36, 0.4, 0.33];
}

/** A sphere drawn from the inside: zenith colour overhead, fading into the horizon's haze. */
function buildDome() {
  const material = new THREE.ShaderMaterial({
    uniforms: { horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

/**
 * A ring of hills round the horizon: a strip whose top edge rises and falls,
 * the ridge colour at its peaks melting into the haze at its foot. [depth]
 * is how much ridge colour shows through the haze.
 */
function buildRidge(radius, height, depth, seed) {
  const r = seeded(9001 + seed * 77);
  // A few sine waves of random phase make the skyline.
  const waves = [1, 2, 3, 5, 8, 13].map((f) => ({ f: f + seed, phase: r.range(0, Math.PI * 2), amp: r.range(0.5, 1) / Math.sqrt(f) }));
  const pos = [];
  const shade = [];
  const index = [];
  for (let i = 0; i <= RIDGE_STEPS; i++) {
    const a = (i / RIDGE_STEPS) * Math.PI * 2;
    let h = 0;
    for (const w of waves) h += Math.sin(a * w.f + w.phase) * w.amp;
    h = height * (0.45 + 0.3 * h);
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pos.push(x, 0, z, x, Math.max(h, 4), z);
    shade.push(0, 1);
    if (i < RIDGE_STEPS) {
      const k = i * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: { horizon: { value: new THREE.Color() }, ridge: { value: new THREE.Color() }, depth: { value: depth } },
    vertexShader: `
      attribute float shade;
      varying float vShade;
      void main() {
        vShade = shade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 ridge;
      uniform float depth;
      varying float vShade;
      void main() {
        gl_FragColor = vec4(mix(horizon, ridge, depth * smoothstep(0.0, 1.0, vShade)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Nearer ranges draw over further ones; all of them under everything else.
  mesh.renderOrder = -9 + seed;
  mesh.frustumCulled = false;
  return mesh;
}
