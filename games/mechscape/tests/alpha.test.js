// Alpha features: chat, trade, loot, areas, quests, the mech, the bosses,
// the hab and the expedition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, act, runUntil, messages, World, Content } from './helpers.js';
import { Action, ChatAction, MAX_CHAT } from '../src/sim/actions.js';
import { takeSnapshot } from '../src/sim/snapshot.js';
import { ItemStack } from '../src/sim/inventory.js';
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

import { TradeRequestAction, TradeOfferAction, TradeRemoveAction, TradeAcceptAction, TradeCancelAction, MoveAction, DropAction } from '../src/sim/actions.js';
import { Trading } from '../src/sim/trade.js';

/** Two players next to each other, in a trade. */
function tradingPair() {
  const { world, player: ann } = makeWorld(1, { x: 5, y: 5 });
  const bo = world.spawn(2, { x: 6, y: 5 });
  bo.display_name = 'Bo';
  ann.display_name = 'Ann';
  const both = (a, b) => world.runTick(new Map([[ann.id, new Map(a ? [[a.slot(), a]] : [])], [bo.id, new Map(b ? [[b.slot(), b]] : [])]]));
  both(new TradeRequestAction(bo.id), null);
  assert.ok(events(world, 'trade_request').some((e) => e.entity === bo.id));
  both(null, new TradeRequestAction(ann.id));
  assert.ok(ann.trade_id >= 0 && ann.trade_id === bo.trade_id);
  return { world, ann, bo, both };
}

test('trade: both accept twice and the goods swap at once', () => {
  const { world, ann, bo, both } = tradingPair();
  ann.inventory.add(item('scrap_metal'), 10);
  bo.inventory.add(item('scrap_blade'));
  bo.inventory.add(item('canister'));
  bo.inventory.slots[1] = null;
  bo.inventory.putStack(item('vent_gas'), 30);
  both(new TradeOfferAction(0, 4), new TradeOfferAction(0));
  both(null, new TradeOfferAction(1));
  const view = Trading.view(world, ann);
  assert.deepEqual(view.mine, [['scrap_metal', 4]]);
  assert.deepEqual(view.theirs, [['scrap_blade', 1], ['vent_gas', 30]]);
  both(new TradeAcceptAction(1), null);
  // Bo changes his offer: Ann's accept is taken back.
  both(null, new TradeRemoveAction('vent_gas'));
  assert.equal(Trading.view(world, ann).accepted, false);
  both(new TradeAcceptAction(1), new TradeAcceptAction(1));
  assert.equal(Trading.view(world, ann).stage, 2);
  both(new TradeAcceptAction(2), new TradeAcceptAction(2));
  assert.equal(ann.trade_id, -1);
  assert.equal(ann.inventory.countOf(item('scrap_metal')), 6);
  assert.equal(ann.inventory.countOf(item('scrap_blade')), 1);
  assert.equal(bo.inventory.countOf(item('scrap_metal')), 4);
  assert.equal(bo.inventory.countOf(item('scrap_blade')), 0);
  assert.equal(bo.inventory.countOf(item('vent_gas')), 30);
  assert.ok(messages(world, ann.id).includes('Trade complete.'));
});

test("trade: called off when one side can't fit what they'd get, and nothing moves", () => {
  const { world, ann, bo, both } = tradingPair();
  for (let i = 0; i < 28; i++) ann.inventory.slots[i] = new ItemStack(item('scrap_blade'), 1);
  bo.inventory.add(item('scrap_metal'), 3);
  both(null, new TradeOfferAction(0));
  both(new TradeAcceptAction(1), new TradeAcceptAction(1));
  both(new TradeAcceptAction(2), new TradeAcceptAction(2));
  assert.equal(ann.trade_id, -1);
  assert.equal(ann.inventory.countOf(item('scrap_blade')), 28);
  assert.equal(bo.inventory.countOf(item('scrap_metal')), 3);
  assert.ok(messages(world, ann.id).some((m) => m.includes('enough inventory space')));
});

test('trade: walking off, dropping, declining or logging out calls it off', () => {
  let t = tradingPair();
  t.both(new MoveAction({ x: 2, y: 2 }), null);
  assert.equal(t.bo.trade_id, -1);
  t = tradingPair();
  t.ann.inventory.add(item('scrap_metal'));
  t.both(new DropAction(0), null);
  assert.equal(t.bo.trade_id, -1);
  t = tradingPair();
  t.both(null, new TradeCancelAction());
  assert.equal(t.ann.trade_id, -1);
  assert.ok(messages(t.world, t.ann.id).some((m) => m.includes('declined')));
  t = tradingPair();
  t.world.removePlayer(t.bo.id);
  assert.equal(t.ann.trade_id, -1);
  // Only the two of them see the trade.
  t = tradingPair();
  const cy = t.world.spawnPlayer('Cy');
  assert.equal(takeSnapshot(t.world, cy.id).entities.find((e) => e.id === t.ann.id).trade, undefined);
  assert.equal(takeSnapshot(t.world, t.ann.id).entities.find((e) => e.id === t.ann.id).trade.partner_name, 'Bo');
});
