// The lobby and raid launch, over a real Colyseus server with real clients.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { ROOM_LOBBY } from '../shared/constants.js';
import { startBlocker } from '../shared/messages.js';
import { startServer } from '../server/index.js';
import { spawnPoint } from '../server/rooms/raid_room.js';

let server;
let endpoint = '';
const open = [];

before(async () => {
  server = await startServer({ port: 0 });
  endpoint = `http://localhost:${server.port}`;
});
after(async () => {
  await Promise.all(open.map((r) => r.leave().catch(() => {})));
  await server.close();
});

async function joinLobby(name, role = 'dps') {
  const room = await new Client(endpoint).joinOrCreate(ROOM_LOBBY, { name, role });
  open.push(room);
  await until(() => room.state.players?.size > 0);
  return room;
}

function next(room, type) {
  return new Promise((resolve) => room.onMessage(type, resolve));
}

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('the start rules', () => {
  assert.match(startBlocker([{ ready: true }]), /at least 2/);
  assert.match(startBlocker([{ ready: true }, { ready: false }]), /ready/);
  assert.equal(startBlocker([{ ready: true }, { ready: true }]), null);
  assert.match(startBlocker(Array(6).fill({ ready: true })), /At most 5/);
});

test('spawn points are spread out and distinct', () => {
  const spots = [0, 1, 2, 3, 4].map((i) => spawnPoint(i, 5));
  assert.equal(new Set(spots.map((s) => s.x)).size, 5);
});

test('bad names are turned away', async () => {
  await assert.rejects(new Client(endpoint).joinOrCreate(ROOM_LOBBY, { name: '' }));
  await assert.rejects(new Client(endpoint).joinOrCreate(ROOM_LOBBY, { name: 'x'.repeat(13) }));
});

test('a group of two readies up, launches and lands in one raid', async () => {
  const ann = await joinLobby('Ann', 'tank');
  const bo = await new Client(endpoint).joinById(ann.roomId, { name: 'Bo', role: 'healer' });
  open.push(bo);
  await until(() => ann.state.players.size === 2);
  assert.equal(ann.state.leaderId, ann.sessionId);

  // Same name in the same lobby is refused, whatever the case.
  await assert.rejects(new Client(endpoint).joinById(ann.roomId, { name: 'ann' }));

  // Not everyone ready: the leader is told why.
  ann.send('start', {});
  assert.match((await next(ann, 'notice')).text, /ready/);
  // Only the leader can start.
  bo.send('start', {});
  assert.match((await next(bo, 'notice')).text, /leader/);

  ann.send('setReady', { ready: true });
  bo.send('setRole', { role: 'dps' });
  bo.send('setReady', { ready: true });
  await until(() => [...ann.state.players.values()].every((p) => p.ready));
  assert.equal(ann.state.players.get(bo.sessionId).role, 'dps');

  const launches = Promise.all([next(ann, 'launch'), next(bo, 'launch')]);
  ann.send('start', {});
  const [a, b] = await launches;
  const annRaid = await new Client(endpoint).consumeSeatReservation(a.reservation);
  const boRaid = await new Client(endpoint).consumeSeatReservation(b.reservation);
  open.push(annRaid, boRaid);
  assert.equal(annRaid.roomId, boRaid.roomId);
  await until(() => annRaid.state.raiders?.size === 2);
  const roles = [...annRaid.state.raiders.values()].map((r) => `${r.name}:${r.role}`).sort();
  assert.deepEqual(roles, ['Ann:tank', 'Bo:dps']);

  // A stranger can't walk into the raid by its id.
  await assert.rejects(new Client(endpoint).joinById(annRaid.roomId, { name: 'Cy', role: 'dps' }));
  await assert.rejects(new Client(endpoint).joinById(annRaid.roomId, { name: 'Ann', role: 'dps' }));
});

test('a sixth player starts a second lobby', async () => {
  const first = await joinLobby('P1');
  for (const name of ['P2', 'P3', 'P4', 'P5']) {
    const room = await new Client(endpoint).joinById(first.roomId, { name });
    open.push(room);
  }
  await until(() => first.state.players.size === 5);
  const sixth = await joinLobby('P6');
  assert.notEqual(sixth.roomId, first.roomId);
});

test('leadership passes on when the leader leaves', async () => {
  const lead = await new Client(endpoint).create(ROOM_LOBBY, { name: 'Lead' });
  open.push(lead);
  const other = await new Client(endpoint).joinById(lead.roomId, { name: 'Other' });
  open.push(other);
  await until(() => other.state.players?.size === 2);
  await lead.leave();
  await until(() => other.state.leaderId === other.sessionId);
});

test('the page and its files are served, private folders are not', async () => {
  const page = await fetch(`${endpoint}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /client\/main\.js/);
  for (const path of ['/client/main.js', '/shared/roles.js', '/vendor/three/build/three.module.js', '/vendor/colyseus/colyseus.js']) {
    assert.equal((await fetch(endpoint + path)).status, 200, path);
  }
  for (const path of ['/server/index.js', '/package.json/../server/state.js', '/node_modules/three/package.json', '/tests/lobby.test.js']) {
    assert.equal((await fetch(endpoint + path)).status, 404, path);
  }
});
