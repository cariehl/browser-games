// Alpha features: chat, trade, loot, areas, quests, the mech, the bosses,
// the hab and the expedition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, act, runUntil, messages, World, Content } from './helpers.js';
import { Action, ChatAction, MAX_CHAT } from '../src/sim/actions.js';
import { takeSnapshot } from '../src/sim/snapshot.js';
import { Game } from '../server/game.js';

const item = (id) => Content.item(id);
const events = (world, type) => world.events.filter((e) => e.type === type);

test('chat: a line reaches everyone, cleaned up, and fast talkers are slowed down', () => {
  const { world, player } = makeWorld();
  const other = world.spawnPlayer('Bo');
  act(world, player, new ChatAction('hello   there'));
  const said = events(world, 'chat');
  assert.equal(said.length, 1);
  assert.deepEqual(said[0].data, { entity: player.id, name: 'Tester', text: 'hello there' });
  // Public: other players' snapshots carry it.
  assert.ok(takeSnapshot(world, other.id).events.some((e) => e.type === 'chat'));
  // Bad lines never become actions.
  assert.equal(Action.fromJSON({ type: 'chat', seq: 1, text: '   ' }), null);
  assert.equal(Action.fromJSON({ type: 'chat', seq: 1, text: 'x'.repeat(MAX_CHAT + 1) }), null);
  assert.equal(Action.fromJSON({ type: 'chat', seq: 1, text: 5 }), null);
  assert.equal(Action.fromJSON({ type: 'chat', seq: 1, text: 'a\u0000b\nc' }).text, 'a b c');
  // Six lines in one tick: the sixth is refused.
  const bySlot = new Map();
  for (let i = 0; i < 6; i++) {
    const line = new ChatAction(`line ${i}`);
    bySlot.set(line.slot(), line);
  }
  for (let i = 0; i < 10; i++) world.runTick();
  world.runTick(new Map([[player.id, bySlot]]));
  assert.equal(events(world, 'chat').length, 5);
  assert.ok(messages(world, player.id).some((m) => m.includes('too fast')));
});

test('chat: joining and leaving are announced to everyone', () => {
  const game = new Game({ map: World.defaultMap });
  const ann = game.join('Ann');
  game.loop.runTick();
  assert.ok(events(game.world, 'broadcast').some((e) => e.data.text === 'Ann has joined.'));
  assert.ok(takeSnapshot(game.world, ann.id).events.some((e) => e.type === 'broadcast'));
  game.join('Bo');
  game.leave(ann.id);
  game.loop.runTick();
  assert.deepEqual(events(game.world, 'broadcast').map((e) => e.data.text), ['Bo has joined.', 'Ann has left.']);
});
