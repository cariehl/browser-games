// Loads the imported models (assets/models/*.glb) once, and hands out
// independent copies. Imported models face +Z, the same way views turn to
// face where they're going.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
/** file name -> { scene, animations } */
const loaded = new Map();

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
