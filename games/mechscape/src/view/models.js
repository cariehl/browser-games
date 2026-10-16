// Loads the imported models (assets/models/*.glb) once, and hands out
// independent copies. Imported models face +Z, the same way views turn to
// face where they're going; a Walk or Run clip whose feet step the other
// way is turned round as it loads (see stepsBackwards).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
/** file name -> { scene, animations } */
const loaded = new Map();

/** Clips that walk the model forward (+Z). */
const LOCOMOTION = new Set(['Walk', 'Run']);

/**
 * Whether [clip]'s feet step towards -Z: a planted foot (near its lowest)
 * sliding forward instead of back, so the model would moonwalk. player.glb's
 * Walk and Run were authored that way. Leaves the model's pose as it was.
 */
function stepsBackwards(scene, clip) {
  const feet = [];
  scene.traverse((node) => { if (node.isBone && /foot/i.test(node.name)) feet.push(node); });
  if (!feet.length) return false;
  const bones = [];
  scene.traverse((node) => { if (node.isBone) bones.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]); });
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clip).play();
  const samples = 48;
  const at = new THREE.Vector3();
  const tracks = feet.map(() => []);
  for (let i = 0; i < samples; i++) {
    mixer.setTime(clip.duration * i / samples);
    scene.updateMatrixWorld(true);
    feet.forEach((foot, f) => tracks[f].push(scene.worldToLocal(foot.getWorldPosition(at)).clone()));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  for (const [node, position, quaternion, scale] of bones) {
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.scale.copy(scale);
  }
  scene.updateMatrixWorld(true);
  let slide = 0;
  for (const points of tracks) {
    const ys = points.map((p) => p.y);
    const low = Math.min(...ys) + 0.3 * (Math.max(...ys) - Math.min(...ys));
    points.forEach((p, i) => { if (p.y <= low) slide += points[(i + 1) % samples].z - p.z; });
  }
  return slide > 0;
}

/** Plays [clip] backwards from now on (every track's keys mirrored in time). */
function reverseClip(clip) {
  for (const track of clip.tracks) {
    const n = track.times.length;
    const size = track.getValueSize();
    const times = new Float32Array(n);
    const values = new track.values.constructor(track.values.length);
    for (let i = 0; i < n; i++) {
      times[i] = clip.duration - track.times[n - 1 - i];
      values.set(track.values.subarray((n - 1 - i) * size, (n - i) * size), i * size);
    }
    track.times = times;
    track.values = values;
  }
}

export const Models = {
  /** Loads every file in [names] (e.g. "player.glb") before the game starts. */
  async preload(names, base = 'assets/models/') {
    await Promise.all([...new Set(names)].filter((n) => n && !loaded.has(n)).map(async (name) => {
      const gltf = await loader.loadAsync(base + name);
      gltf.scene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      for (const clip of gltf.animations) {
        if (LOCOMOTION.has(clip.name) && stepsBackwards(gltf.scene, clip)) reverseClip(clip);
      }
      loaded.set(name, { scene: gltf.scene, animations: gltf.animations });
    }));
  },

  has(name) {
    return loaded.has(name);
  },

  /** A copy of the model, scaled, with its animation clips (shared, read-only). */
  instance(name, scale = 1) {
    const source = loaded.get(name);
    const model = SkeletonUtils.clone(source.scene);
    model.scale.setScalar(scale);
    return { model, animations: source.animations };
  },

  /**
   * The box around every mesh in the model in its rest pose, in the space of
   * the node the model is added to. Sizes hitboxes and HP-bar heights.
   */
  bounds(model) {
    const parent = model.parent;
    if (parent) parent.remove(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse((node) => {
      if (!node.isMesh) return;
      if (node.isSkinnedMesh) {
        node.skeleton.update();
        node.computeBoundingBox();
        box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
      } else {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
      }
    });
    if (parent) parent.add(model);
    return box;
  },
};
