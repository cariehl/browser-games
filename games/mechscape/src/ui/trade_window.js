// The trade window: what you offer, what they offer, and your inventory to
// offer from. Both accept, then both accept the final check, and the server
// swaps everything at once.
//
// It's drawn from the trade's state (Trading.view), so it opens when a trade
// opens and closes when it ends, however that happens. Decline or Esc
// calls it off for both.
//
// Your inventory: click to offer one, right-click for 5, 10 or All. Your
// offer: click to take one back, right-click for All.

import { ClientState } from '../client/client_state.js';
import { Inventory } from '../sim/inventory.js';
import { Content } from '../sim/defs.js';
import { tradeViewFor } from '../sim/trade.js';
import { TradeOfferAction, TradeRemoveAction, TradeAcceptAction, TradeCancelAction } from '../sim/actions.js';
import { cssColor } from '../view/tile_math.js';
import { el } from './screen.js';
import { ITEM_COLOR, onEscape } from './common.js';

export class TradeWindow {
  constructor(parent, link, menu) {
    this.link = link;
    this.menu = menu;
    this.el = el('div', 'trade-window panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    this._title = el('div', 'title grow', '', header);
    this._stageText = el('div', 'muted', '', this.el);
    const columns = el('div', 'columns', '', this.el);
    const mine = el('div', 'trade-col', '', columns);
    el('div', 'muted', 'Your offer', mine);
    this._mine = el('div', 'trade-list', '', mine);
    const theirs = el('div', 'trade-col', '', columns);
    this._theirsLabel = el('div', 'muted', '', theirs);
    this._theirs = el('div', 'trade-list', '', theirs);
    this._invBlock = el('div', 'trade-col', '', columns);
    el('div', 'muted', 'Your inventory  ·  click to offer', this._invBlock);
    this._inventory = el('div', 'storage-inventory trade-inventory', '', this._invBlock);
    this._status = el('div', 'trade-status', '', this.el);
    const buttons = el('div', 'row', '', this.el);
    this._accept = el('button', 'accept', 'Accept', buttons);
    this._accept.addEventListener('click', () => {
      const view = this._view;
      if (view) this.link.send(ClientState.localPlayerId, new TradeAcceptAction(view.stage));
    });
    el('button', '', 'Decline', buttons).addEventListener('click', () => this.decline());
    this._view = null;
    this._shownKey = '';
    onEscape(35, () => this.isOpen(), () => this.decline());
  }

  isOpen() {
    return this._view != null;
  }

  decline() {
    if (this._view) this.link.send(ClientState.localPlayerId, new TradeCancelAction());
  }

  update() {
    const me = ClientState.me();
    const view = me ? tradeViewFor(ClientState.world, me) : null;
    this._view = view;
    this.el.style.display = view ? '' : 'none';
    if (!view) {
      this._shownKey = '';
      return;
    }
    const key = JSON.stringify(view) + '|' + me.inventory.slots.map((s) => (s ? `${s.item.id}:${s.count}` : '-')).join(',');
    if (key === this._shownKey) return;
    this._shownKey = key;
    const confirm = view.stage === 2;
    this._title.textContent = `Trading with ${view.partner_name}`;
    this._stageText.textContent = confirm ? 'Are you sure you want to make this trade? Check both sides.' : 'Offer items, then accept. You both accept twice.';
    this._theirsLabel.textContent = `${view.partner_name}'s offer`;
    this._invBlock.style.display = confirm ? 'none' : '';
    this._fillList(this._mine, view.mine, !confirm);
    this._fillList(this._theirs, view.theirs, false);
    if (!confirm) this._fillInventory(me, view);
    let status = '';
    if (view.accepted && view.they_accepted) status = 'Both accepted.';
    else if (view.accepted) status = `Waiting for ${view.partner_name}…`;
    else if (view.they_accepted) status = `${view.partner_name} has accepted.`;
    this._status.textContent = status;
    this._accept.disabled = view.accepted;
  }

  _fillList(box, lines, removable) {
    box.innerHTML = '';
    if (lines.length === 0) el('div', 'muted small', 'Nothing', box);
    for (const [id, count] of lines) {
      const item = Content.item(id);
      if (!item) continue;
      const cell = el('div', 'cell', '', box);
      el('div', 'swatch', '', cell).style.background = cssColor(item.color);
      const amount = item.container ? ` (${count}/${item.capacity})` : count > 1 ? ` ×${count}` : '';
      el('div', 'cell-name', item.display_name + amount, cell);
      if (!removable) continue;
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const id0 = ClientState.localPlayerId;
        if (e.button === 0) this.link.send(id0, new TradeRemoveAction(id, 1));
        else if (e.button === 2) {
          this.menu.open([
            { verb: 'Remove 1', target: item.display_name, color: ITEM_COLOR, action: () => this.link.send(id0, new TradeRemoveAction(id, 1)) },
            { verb: 'Remove All', target: item.display_name, color: ITEM_COLOR, action: () => this.link.send(id0, new TradeRemoveAction(id, -1)) },
            { verb: 'Cancel', action: null },
          ], e.clientX, e.clientY);
        }
      });
    }
  }

  _fillInventory(me, view) {
    const box = this._inventory;
    box.innerHTML = '';
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = me.inventory.slots[i];
      const cell = el('div', 'cell', '', box);
      if (!stack) continue;
      const offered = view.offered[i] || 0;
      const left = stack.count - offered;
      if (left <= 0) {
        cell.style.opacity = '0.3';
        continue;
      }
      el('div', 'swatch', '', cell).style.background = cssColor(stack.item.color);
      const amount = stack.item.container ? ` (${stack.count}/${stack.item.capacity})` : left > 1 ? ` ×${left}` : '';
      el('div', 'cell-name', stack.item.display_name + amount, cell);
      const send = (count) => this.link.send(ClientState.localPlayerId, new TradeOfferAction(i, count));
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (e.button === 0) send(1);
        else if (e.button === 2) {
          const options = [['Offer 1', 1], ['Offer 5', 5], ['Offer 10', 10], ['Offer All', -1]].map(([verb, n]) => ({
            verb, target: stack.item.display_name, color: ITEM_COLOR, action: () => send(n),
          }));
          options.push({ verb: 'Cancel', action: null });
          this.menu.open(options, e.clientX, e.clientY);
        }
      });
    }
  }
}
