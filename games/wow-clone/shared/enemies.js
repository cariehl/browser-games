// Enemy kinds. Step 2 has practice targets only; step 3 adds trash and bosses.
//
//   radius     body size: ranges measure to the edge of it
//   passive    never fights back
//   immortal   health never drops below 1
//   resetAfter seconds without taking damage before a passive enemy resets
//   speed      run speed while chasing
//   swing      seconds between melee hits, each hit for a roll in [hit]
//   aggro      raiders this close pull it
//   leash      it gives up (evades) this far from home
//   respawn    seconds after death before it's back

export const ENEMY_KINDS = {
  dummy: {
    name: 'Training Dummy', maxHealth: 250000, radius: 0.7,
    passive: true, immortal: true, resetAfter: 10,
  },
  golem: {
    name: 'Sparring Golem', maxHealth: 18000, radius: 1.3,
    speed: 6, swing: 2, hit: [350, 450], aggro: 6, leash: 30, respawn: 10,
  },
};

/** Where the practice targets stand. Facing π looks toward the entrance (+z). */
export const PRACTICE_SPAWNS = [
  { kind: 'dummy', x: -6, z: 2, facing: Math.PI },
  { kind: 'dummy', x: -2, z: 2, facing: Math.PI },
  { kind: 'golem', x: 4, z: -16, facing: Math.PI },
];
