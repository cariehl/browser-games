// The raid's floor plan: where units can stand. The server keeps movement
// inside it; client/raid/arena.js draws the same walls and pillars.

/** The walkable floor: walls at x = ±20 and z = -30, the entrance edge at z = 30. */
export const ARENA = { minX: -19.5, maxX: 19.5, minZ: -29.5, maxZ: 29.5 };

export const PILLAR_RADIUS = 1;

/** Pillars down both sides of the hall: [{ x, z }]. */
export const PILLARS = [];
for (let z = -24; z <= 18; z += 7) {
  for (const x of [-12, 12]) PILLARS.push({ x, z });
}

/** [x, z] moved inside the arena and out of any pillar, for a unit of [radius]. */
export function confine(x, z, radius) {
  x = Math.min(ARENA.maxX - radius, Math.max(ARENA.minX + radius, x));
  z = Math.min(ARENA.maxZ - radius, Math.max(ARENA.minZ + radius, z));
  for (const p of PILLARS) {
    const dx = x - p.x;
    const dz = z - p.z;
    const min = PILLAR_RADIUS + radius;
    const d = Math.hypot(dx, dz);
    if (d < min) {
      // Push straight out from the pillar's center (or sideways if dead on it).
      const k = d > 1e-6 ? min / d : 0;
      x = d > 1e-6 ? p.x + dx * k : p.x + min;
      z = d > 1e-6 ? p.z + dz * k : z;
    }
  }
  return { x, z };
}
