// The combat simulation (server/world.js), driven directly, plus one pass
// over the network to check the raid room wires messages to it.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { ABILITIES, CLASSES } from '../shared/classes.js';
import { ROOM_RAID } from '../shared/constants.js';
import { GCD, RUN_SPEED, facingToward, isFacing, stepMovement } from '../shared/combat.js';
import { confine, PILLARS } from '../shared/arena.js';
import { cleanMove } from '../shared/messages.js';
import { startServer } from '../server/index.js';
import { RaidState } from '../server/state.js';
import { RaidWorld } from '../server/world.js';

const TICK = 1 / 20;

/** A world with no enemies; rolls land in the middle and never crit. */
function makeWorld() {
  const events = [];
  const state = new RaidState();
  state.time = 0;
  const world = new RaidWorld(state, { emit: (type, data, to) => events.push({ type, data, to }), random: () => 0.5 });
  return { world, state, events, errors: () => events.filter((e) => e.type === 'error').map((e) => e.data.text) };
}

function run(world, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += TICK) world.update(TICK);
}

/** Raider [id] stands at [x, z] facing [target] (if given). */
function place(world, id, x, z, target) {
  const unit = world.unit(id);
  unit.x = x;
  unit.z = z;
  if (target) unit.facing = facingToward(unit, world.unit(target));
}

test('every class has five abilities that exist', () => {
  for (const cls of Object.values(CLASSES)) {
    assert.equal(cls.abilities.length, 5);
    for (const id of cls.abilities) assert.ok(ABILITIES[id], id);
  }
});

test('move messages are checked', () => {
  assert.deepEqual(cleanMove({ forward: 1, strafe: -1, facing: 0.5 }), { forward: 1, strafe: -1, facing: 0.5 });
  assert.equal(cleanMove({ forward: 2, strafe: 0, facing: 0 }), null);
  assert.equal(cleanMove({ forward: 1, strafe: 0, facing: NaN }), null);
  assert.equal(cleanMove({ forward: '1', strafe: 0, facing: 0 }), null);
  assert.equal(cleanMove(null), null);
  assert.ok(Math.abs(cleanMove({ forward: 0, strafe: 0, facing: 7 * Math.PI }).facing) <= Math.PI);
});

test('movement runs along facing, stays in the hall and out of pillars', () => {
  const p = stepMovement({ x: 0, z: 0 }, 0, { forward: 1, strafe: 0 }, 1);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.z + RUN_SPEED) < 1e-9);
  const right = stepMovement({ x: 0, z: 0 }, 0, { forward: 0, strafe: 1 }, 1);
  assert.ok(right.x > 6.9);
  const wall = stepMovement({ x: 19, z: 0 }, -Math.PI / 2, { forward: 1, strafe: 0 }, 1);
  assert.ok(wall.x <= 19.5);
  const pillar = PILLARS[0];
  const out = confine(pillar.x + 0.1, pillar.z, 0.5);
  assert.ok(Math.hypot(out.x - pillar.x, out.z - pillar.z) >= 1.5 - 1e-9);
});

test('the server moves raiders from their input, and moving cancels a cast', () => {
  const { world, state } = makeWorld();
  world.addRaider('h', { name: 'Hea', role: 'healer' }, { x: 0, z: 10, facing: 0 });
  world.setInput('h', { forward: 1, strafe: 0, facing: 0 });
  run(world, 1);
  assert.ok(Math.abs(state.raiders.get('h').z - (10 - RUN_SPEED)) < 0.01);

  world.setInput('h', { forward: 0, strafe: 0, facing: 0 });
  assert.equal(world.cast('h', 'flashHeal'), null);
  assert.equal(state.raiders.get('h').castAbility, 'flashHeal');
  world.setInput('h', { forward: 1, strafe: 0, facing: 0 });
  assert.equal(state.raiders.get('h').castAbility, '');
});

test('abilities check target, range, facing, the GCD and cooldowns', () => {
  const { world, state, errors } = makeWorld();
  world.addRaider('t', { name: 'Tan', role: 'tank' }, { x: 0, z: 10, facing: 0 });
  const dummy = world.addEnemy('dummy', { x: 0, z: 0 });

  assert.match(world.cast('t', 'strike'), /no target/);
  world.setTarget('t', dummy);
  assert.match(world.cast('t', 'strike'), /range/);
  assert.match(world.cast('t', 'firebolt'), /Unknown/); // Not a Guardian ability.

  place(world, 't', 0, 2);
  world.unit('t').facing = Math.PI; // Back to the dummy.
  assert.match(world.cast('t', 'strike'), /face/);
  place(world, 't', 0, 2, dummy);
  assert.ok(isFacing(world.unit('t'), world.unit(dummy)));

  const before = state.enemies.get(dummy).health;
  assert.equal(world.cast('t', 'shieldSlam'), null);
  assert.equal(before - state.enemies.get(dummy).health, 240);
  assert.match(world.cast('t', 'strike'), /Not ready/); // GCD.
  // Taunt is off the GCD.
  assert.equal(world.cast('t', 'taunt'), null);

  run(world, GCD);
  assert.match(world.cast('t', 'shieldSlam'), /cooldown/);
  assert.equal(world.cast('t', 'strike'), null);
  run(world, 6);
  assert.equal(world.cast('t', 'shieldSlam'), null);
  assert.ok(errors().length >= 5);
});

test('a cast lands when it finishes, and a friendly spell with no friendly target heals yourself', () => {
  const { world, state, events } = makeWorld();
  world.addRaider('h', { name: 'Hea', role: 'healer' }, { x: 0, z: 10, facing: 0 });
  const healer = state.raiders.get('h');
  healer.health = 1000;
  world.cast('h', 'flashHeal');
  run(world, 1);
  assert.equal(healer.health, 1000);
  run(world, 0.6);
  assert.equal(healer.health, 1475);
  const heal = events.find((e) => e.type === 'hit');
  assert.deepEqual(heal.data, { source: 'h', target: 'h', ability: 'flashHeal', amount: 475, heal: true, crit: false, tick: false });
});

test('auras tick and expire; Shield Wall halves damage', () => {
  const { world, state } = makeWorld();
  world.addRaider('h', { name: 'Hea', role: 'healer' }, { x: 0, z: 10, facing: 0 });
  world.addRaider('t', { name: 'Tan', role: 'tank' }, { x: 2, z: 10, facing: 0 });
  const tank = state.raiders.get('t');
  tank.health = 1000;
  world.setTarget('h', 't');
  world.cast('h', 'renew');
  assert.equal(tank.auras.size, 1);
  run(world, 12.05);
  assert.equal(tank.health, 1000 + 4 * 120);
  assert.equal(tank.auras.size, 0);

  world.cast('t', 'shieldWall');
  world.damage('x', 't', 400, 'melee');
  assert.equal(tank.health, 1480 - 200);
});

test('threat: the golem attacks whoever has the most, taunt takes it, healing draws it', () => {
  const { world, state } = makeWorld();
  world.addRaider('t', { name: 'Tan', role: 'tank' }, { x: 0, z: 10, facing: 0 });
  world.addRaider('d', { name: 'Dee', role: 'dps' }, { x: 3, z: 10, facing: 0 });
  world.addRaider('h', { name: 'Hea', role: 'healer' }, { x: -3, z: 10, facing: 0 });
  const golem = world.addEnemy('golem', { x: 0, z: -10, facing: Math.PI });
  const g = state.enemies.get(golem);
  for (const id of ['t', 'd', 'h']) world.setTarget(id, golem);

  place(world, 'd', 0, 10, golem);
  assert.equal(world.cast('d', 'fireBlast'), null);
  run(world, 0.1);
  assert.equal(g.targetId, 'd');
  assert.ok(g.threat.get('d') > 0);

  // The tank taunts and holds it with Strike (tank threat is tripled).
  place(world, 't', 0, 8, golem);
  assert.equal(world.cast('t', 'taunt'), null);
  run(world, 0.1);
  assert.equal(g.targetId, 't');

  // The golem walks to the tank and hits them.
  run(world, 4);
  assert.ok(state.raiders.get('t').health < CLASSES.tank.maxHealth);

  // Healing the tank puts the healer on the threat list.
  world.setTarget('h', 't');
  place(world, 'h', -3, 8);
  world.cast('h', 'holyWord');
  assert.ok(g.threat.get('h') > 0);
});

test('a raider can die and release; the golem resets when everyone is gone', () => {
  const { world, state } = makeWorld();
  world.addRaider('d', { name: 'Dee', role: 'dps' }, { x: 0, z: 10, facing: 0 });
  const golem = world.addEnemy('golem', { x: 0, z: 5, facing: Math.PI });
  const g = state.enemies.get(golem);
  const dee = state.raiders.get('d');
  run(world, 0.1); // Close enough to pull it.
  assert.equal(g.targetId, 'd');
  g.health = 100;
  dee.health = 1;
  run(world, 3);
  assert.equal(dee.health, 0);
  assert.equal(g.threat.size, 0);
  run(world, 0.1);
  assert.equal(g.health, g.maxHealth); // Evaded and healed.

  assert.match(world.cast('d', 'ignite'), /dead/);
  world.release('d', { x: 0, z: 12, facing: 0 });
  assert.equal(dee.health, dee.maxHealth);
  assert.equal(dee.warp, 1);
});

test('the training dummy never dies, and resets when left alone', () => {
  const { world, state } = makeWorld();
  world.addRaider('d', { name: 'Dee', role: 'dps' }, { x: 0, z: 10, facing: 0 });
  const dummy = world.addEnemy('dummy', { x: 0, z: 0 });
  const d = state.enemies.get(dummy);
  world.damage('d', dummy, 1e9, 'firebolt');
  assert.equal(d.health, 1);
  assert.equal(d.targetId, '');
  run(world, 0.1);
  assert.equal(d.targetId, 'd');
  run(world, 11);
  assert.equal(d.health, d.maxHealth);
  assert.equal(d.threat.size, 0);
});

let server;
before(async () => {
  server = await startServer({ port: 0 });
});
after(() => server.close());

test('the raid room takes moves, targets and casts over the network', async () => {
  const endpoint = `http://localhost:${server.port}`;
  const raid = await matchMaker.createRoom(ROOM_RAID, { party: [{ name: 'Sol', role: 'dps' }] });
  const reservation = await matchMaker.reserveSeatFor(raid, { name: 'Sol', role: 'dps' });
  const room = await new Client(endpoint).consumeSeatReservation(reservation);
  try {
    await until(() => room.state.raiders?.size === 1 && room.state.enemies?.size === 3);
    const me = room.state.raiders.get(room.sessionId);
    assert.equal(me.health, CLASSES.dps.maxHealth);

    // Malformed messages are ignored.
    room.send('move', { forward: 5, strafe: 0, facing: 0 });
    room.send('target', { id: { nope: 1 } });
    room.send('cast', { ability: 'strike' });
    const error = new Promise((resolve) => room.onMessage('error', resolve));
    room.send('cast', { ability: 'firebolt' });
    assert.match((await error).text, /no target/);

    const [dummyId] = [...room.state.enemies.entries()].find(([, e]) => e.kind === 'dummy');
    room.send('target', { id: dummyId });
    await until(() => me.targetId === dummyId);
    const hit = new Promise((resolve) => room.onMessage('hit', resolve));
    // From the entrance the dummies are about 10 yards ahead and a little to the left.
    room.send('move', { forward: 0, strafe: 0, facing: facingToward(me, room.state.enemies.get(dummyId)) });
    room.send('cast', { ability: 'fireBlast' });
    const { source, target, amount } = await hit;
    assert.equal(source, room.sessionId);
    assert.equal(target, dummyId);
    assert.ok(amount > 0);

    const z = me.z;
    room.send('move', { forward: 1, strafe: 0, facing: 0 });
    await until(() => me.z < z - 1);
  } finally {
    await room.leave();
  }
});

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
