// Trading between two players: barter, with no currency.
//
// One player asks (TradeRequestAction); when the other asks back, a trade
// opens for both. Each side offers items from their inventory, by slot.
// Both accept once, then see the final offer and accept again, and the swap
// happens all at once on the server, on one tick: it either all happens or
// none of it does (if one side can't fit what they'd get, it's called off).
//
// While a trade is open your inventory is frozen: doing anything else
// (walking, fighting, moving or dropping items) calls it off, as do dying,
// logging out and drifting apart. Changing an offer takes back both accepts.
// Trades aren't saved; a restart calls them off.

import { Inventory, ItemStack } from './inventory.js';
import { chebyshev } from './grid.js';
import { Content } from './defs.js';

export const TradeStage = { OFFER: 1, CONFIRM: 2 };

export class Trade {
  constructor(id, a, b) {
    this.id = id;
    /** The two player ids. */
    this.players = [a, b];
    /** player id -> [{ slot, count }] */
    this.offers = { [a]: [], [b]: [] };
    /** player id -> accepted this stage */
    this.accepted = { [a]: false, [b]: false };
    this.stage = TradeStage.OFFER;
  }

  partnerOf(id) {
    return this.players[0] === id ? this.players[1] : this.players[0];
  }

  resetAccepts() {
    for (const id of this.players) this.accepted[id] = false;
  }

  /** How many of slot [slot] [id] has offered. */
  offeredFrom(id, slot) {
    const line = this.offers[id].find((o) => o.slot === slot);
    return line ? line.count : 0;
  }
}

export const Trading = {
  /** Opens a trade between two players. */
  open(world, a, b) {
    const trade = new Trade(world._nextTradeId++, a.id, b.id);
    world.trades.set(trade.id, trade);
    for (const p of [a, b]) {
      p.trade_id = trade.id;
      p.trade_request = null;
      p.clearTask();
      p.path = [];
    }
    world.emitEvent(a.id, 'open_trade', { trade: trade.id });
    world.emitEvent(b.id, 'open_trade', { trade: trade.id });
    return trade;
  },

  of(world, entity) {
    return entity.trade_id >= 0 ? world.trades.get(entity.trade_id) || null : null;
  },

  /** Calls a trade off. [byId]: who did (they're told nothing; the other side is). */
  cancel(world, trade, reason = '') {
    if (!world.trades.has(trade.id)) return;
    world.trades.delete(trade.id);
    for (const id of trade.players) {
      const p = world.entities.get(id);
      if (p && p.trade_id === trade.id) p.trade_id = -1;
      world.emitEvent(id, 'close_trade', { trade: trade.id });
      if (reason) world.message(id, reason);
    }
  },

  /**
   * [entity] offers [count] of the item in inventory slot [slot] (-1 = all).
   * A stackable item comes from that slot; one that doesn't stack takes one
   * slot each, starting with [slot], like OSRS's Offer-X.
   */
  offer(world, entity, slot, count) {
    const trade = Trading.of(world, entity);
    if (!trade || trade.stage !== TradeStage.OFFER) return;
    if (slot < 0 || slot >= Inventory.SIZE) return;
    const slots = entity.inventory.slots;
    const stack = slots[slot];
    if (!stack || count === 0) return;
    const lines = trade.offers[entity.id];
    const add = (index, n) => {
      const line = lines.find((o) => o.slot === index);
      if (line) line.count += n;
      else lines.push({ slot: index, count: n });
    };
    if (stack.item.stackable && !stack.item.container) {
      const left = stack.count - trade.offeredFrom(entity.id, slot);
      const n = count < 0 ? left : Math.min(count, left);
      if (n <= 0) return;
      add(slot, n);
    } else {
      let want = count < 0 ? Inventory.SIZE : count;
      const order = [slot];
      for (let i = 0; i < Inventory.SIZE; i++) if (i !== slot) order.push(i);
      for (const i of order) {
        if (want <= 0) break;
        const s = slots[i];
        if (!s || s.item !== stack.item || trade.offeredFrom(entity.id, i) > 0) continue;
        add(i, s.count);
        want--;
      }
    }
    trade.resetAccepts();
  },

  /** [entity] takes back [count] of [itemId] from their offer (-1 = all of it). */
  withdraw(world, entity, itemId, count) {
    const trade = Trading.of(world, entity);
    if (!trade || trade.stage !== TradeStage.OFFER || count === 0) return;
    const lines = trade.offers[entity.id];
    let left = count < 0 ? Infinity : count;
    for (let i = lines.length - 1; i >= 0 && left > 0; i--) {
      const stack = entity.inventory.slots[lines[i].slot];
      if (!stack || stack.item.id !== itemId) continue;
      const whole = !stack.item.stackable || !!stack.item.container;
      const take = whole ? lines[i].count : Math.min(lines[i].count, left);
      lines[i].count -= take;
      left -= whole ? 1 : take;
      if (lines[i].count <= 0) lines.splice(i, 1);
    }
    trade.resetAccepts();
  },

  /** [entity] accepts the stage they see. Both accepting the first moves to the second; both the second swaps. */
  accept(world, entity, stage) {
    const trade = Trading.of(world, entity);
    if (!trade || trade.stage !== stage) return;
    trade.accepted[entity.id] = true;
    const partner = trade.partnerOf(entity.id);
    if (!trade.accepted[partner]) {
      world.message(partner, `${entity.display_name} has accepted.`);
      return;
    }
    if (trade.stage === TradeStage.OFFER) {
      trade.stage = TradeStage.CONFIRM;
      trade.resetAccepts();
      return;
    }
    Trading._complete(world, trade);
  },

  /** What one side is giving, as stacks. */
  goods(world, trade, id) {
    const p = world.entities.get(id);
    const out = [];
    for (const line of trade.offers[id]) {
      const stack = p && p.inventory.slots[line.slot];
      if (stack) out.push(new ItemStack(stack.item, Math.min(line.count, stack.count)));
    }
    return out;
  },

  /** The swap: all or nothing. */
  _complete(world, trade) {
    const [a, b] = trade.players.map((id) => world.entities.get(id));
    if (!a || !b) {
      Trading.cancel(world, trade, 'The trade was called off.');
      return;
    }
    const giving = { [a.id]: Trading.goods(world, trade, a.id), [b.id]: Trading.goods(world, trade, b.id) };
    const result = {};
    for (const [me, them] of [[a, b], [b, a]]) {
      // Worked out on a copy, so a failure leaves both inventories as they were.
      const inventory = new Inventory();
      inventory.slots = me.inventory.slots.map((s) => (s ? new ItemStack(s.item, s.count) : null));
      for (const line of trade.offers[me.id]) {
        const stack = inventory.slots[line.slot];
        if (!stack) continue;
        stack.count -= Math.min(line.count, stack.count);
        if (stack.count <= 0) inventory.slots[line.slot] = null;
      }
      for (const stack of giving[them.id]) {
        const fits = stack.item.stackable || stack.item.container
          ? inventory.putStack(stack.item, stack.count)
          : inventory.add(stack.item, stack.count);
        if (!fits) {
          world.message(me.id, "You don't have enough inventory space for that trade.");
          world.message(them.id, `${me.display_name} doesn't have enough inventory space for that trade.`);
          Trading.cancel(world, trade);
          return;
        }
      }
      result[me.id] = inventory.slots;
    }
    a.inventory.slots = result[a.id];
    b.inventory.slots = result[b.id];
    world.emitEvent(a.id, 'traded', { with: b.id });
    world.emitEvent(b.id, 'traded', { with: a.id });
    Trading.cancel(world, trade, 'Trade complete.');
  },

  /** Once a tick: call off trades whose players have died, left or drifted apart. */
  check(world) {
    for (const trade of [...world.trades.values()]) {
      const [a, b] = trade.players.map((id) => world.entities.get(id));
      if (!a || !b || a.isDead() || b.isDead() || a.trade_id !== trade.id || b.trade_id !== trade.id) {
        Trading.cancel(world, trade, 'The trade was called off.');
      } else if (chebyshev(a.tile, b.tile) > Content.rules.trade.range) {
        Trading.cancel(world, trade, "You're too far apart to trade.");
      }
    }
  },

  /** What a player's trade window shows. Plain data, also what the server sends them. */
  view(world, entity) {
    const trade = Trading.of(world, entity);
    if (!trade) return null;
    const partner = world.entities.get(trade.partnerOf(entity.id));
    // Same items merged into one line, except gas in canisters (one line per canister).
    const lines = (id) => {
      const out = [];
      for (const s of Trading.goods(world, trade, id)) {
        const same = !s.item.container && out.find((line) => line[0] === s.item.id);
        if (same) same[1] += s.count;
        else out.push([s.item.id, s.count]);
      }
      return out;
    };
    return {
      id: trade.id,
      partner: trade.partnerOf(entity.id),
      partner_name: partner ? partner.display_name : '',
      stage: trade.stage,
      mine: lines(entity.id),
      /** inventory slot -> how many of it are offered */
      offered: Object.fromEntries(trade.offers[entity.id].map((o) => [o.slot, o.count])),
      theirs: lines(trade.partnerOf(entity.id)),
      accepted: trade.accepted[entity.id],
      they_accepted: trade.accepted[trade.partnerOf(entity.id)],
      their_free_slots: partner ? partner.inventory.freeSlots() : 0,
    };
  },
};

/** The trade window's data for [me]: worked out from the world offline, or as the server sent it online. */
export function tradeViewFor(world, me) {
  if (!me) return null;
  if (world.trades.size > 0 || me.trade_view === undefined) return Trading.view(world, me);
  return me.trade_view;
}
