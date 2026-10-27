// Placeholder raid geography: the entrance where the party spawns, a hall,
// and a raised platform for the first boss. Step 3 replaces it with the real
// layout (two boss rooms with trash between).

import * as THREE from 'three';

export function buildArena() {
  const arena = new THREE.Group();

  const stone = new THREE.MeshStandardMaterial({ color: 0x5b5a63, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3942, roughness: 1 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), stone);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  arena.add(floor);

  // Pillars down both sides of the hall.
  const pillar = new THREE.CylinderGeometry(0.8, 1, 8, 12);
  for (let z = -24; z <= 18; z += 7) {
    for (const x of [-12, 12]) {
      const p = new THREE.Mesh(pillar, dark);
      p.position.set(x, 4, z);
      p.castShadow = p.receiveShadow = true;
      arena.add(p);
    }
  }

  // The boss platform at the far end.
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.6, 48), dark);
  platform.position.set(0, 0.3, -18);
  platform.receiveShadow = true;
  arena.add(platform);
  const rune = new THREE.Mesh(
    new THREE.RingGeometry(6.5, 7, 64),
    new THREE.MeshBasicMaterial({ color: 0xd1543f, transparent: true, opacity: 0.5 }),
  );
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(0, 0.62, -18);
  arena.add(rune);

  // Walls, so the hall reads as indoors.
  const wallGeo = new THREE.BoxGeometry(1, 10, 60);
  for (const x of [-20, 20]) {
    const wall = new THREE.Mesh(wallGeo, dark);
    wall.position.set(x, 5, 0);
    wall.receiveShadow = true;
    arena.add(wall);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 1), dark);
  back.position.set(0, 5, -30);
  arena.add(back);

  return arena;
}
