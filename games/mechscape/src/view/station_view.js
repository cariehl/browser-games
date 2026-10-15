// A crafting station: its imported model when its def has one, otherwise a
// gray-box bench (a tabletop on four legs, a vise block and a small glowing
// screen).

import * as THREE from 'three';
import { tileToWorld, color } from './tile_math.js';
import { Models } from './models.js';
import { Hitbox, HitboxKind } from './hitbox.js';
import { hasShape, buildShape } from './station_shapes.js';

export class StationView extends THREE.Group {
  constructor(station) {
    super();
    this.station = station;
    tileToWorld(station.tile, 0, this.position);
    const def = station.def;
    if (def.model && Models.has(def.model)) {
      const model = Models.instance(def.model, def.model_scale).model;
      this.add(model);
      const box = Models.bounds(model);
      this.add(new Hitbox(HitboxKind.OBJECT, station.id, box.getSize(new THREE.Vector3()), box.getCenter(new THREE.Vector3())));
      return;
    }
    if (hasShape(def.shape)) {
      const model = buildShape(def);
      this.add(model);
      const box = new THREE.Box3().setFromObject(model);
      this.add(new Hitbox(HitboxKind.OBJECT, station.id, box.getSize(new THREE.Vector3()), box.getCenter(new THREE.Vector3())));
      return;
    }
    this.scale.setScalar(1.35);
    const wood = new THREE.MeshStandardMaterial({ color: color(def.color), roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: color([0.42, 0.44, 0.47]), metalness: 0.6, roughness: 0.4 });
    const screen = new THREE.MeshStandardMaterial({ color: color([1, 0.65, 0.2]), emissive: color([1, 0.65, 0.2]), emissiveIntensity: 1.4 });
    this._box([0.92, 0.08, 0.62], [0, 0.56, 0], wood);
    for (const x of [-0.4, 0.4]) for (const z of [-0.26, 0.26]) this._box([0.07, 0.52, 0.07], [x, 0.26, z], steel);
    this._box([0.22, 0.14, 0.16], [-0.24, 0.67, 0.08], steel);
    this._box([0.26, 0.18, 0.03], [0.22, 0.71, -0.24], screen);
    this.add(new Hitbox(HitboxKind.OBJECT, station.id, new THREE.Vector3(0.96, 0.82, 0.68), new THREE.Vector3(0, 0.41, 0)));
  }

  update() {}

  _box(size, at, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.add(mesh);
  }
}
