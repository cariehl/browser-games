// The storage screen: your storage on the left, your inventory on the right.
// Opens when the sim reports you've reached a storage locker (open_storage
// event), closes on Esc, the close button, or walking away.
//
// Left-click an item to move one across; right-click for 5, All and the
// rest. "Deposit all" empties the inventory.

import { ClientState } from '../client/client_state.js';
import { Inventory } from '../sim/inventory.js';
import { DepositAction, DepositAllAction, WithdrawAction } from '../sim/actions.js';
import { cssColor } from '../view/tile_math.js';
import { el } from './screen.js';
import { ITEM_COLOR, onEscape } from './common.js';

export class StorageMenu {
  constructor(parent, link, menu) {
    this.link = link;
    this.menu = menu;
    this.el = el('div', 'storage-menu panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    el('div', 'title grow', 'Storage', header);
    el('button', '', 'Deposit all', header).addEventListener('click', () => this.link.send(ClientState.localPlayerId, new DepositAllAction()));
    el('button', '', 'Close', header).addEventListener('click', () => this.close());
    const columns = el('div', 'columns', '', this.el);
    const left = el('div', '', '', columns);
    el('div', 'muted', 'In storage  ·  click to withdraw', left);
    this._storageGrid = el('div', 'storage-grid', '', left);
    this._empty = el('div', 'muted', 'Nothing stored yet.', left);
    const right = el('div', '', '', columns);
    el('div', 'muted', 'Inventory  ·  click to deposit', right);
    this._inventoryGrid = el('div', 'storage-inventory', '', right);
    this._station = null;
    this._shownKey = '';
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_storage') {
          const station = ClientState.world.stations.get(event.data.station);
          if (station) this.open(station);
        }
      }
    });
    onEscape(30, () => this.isOpen(), () => this.close());
  }

  open(station) {
    this._station = station;
    this._shownKey = '';
    this.el.style.display = '';
    this._refresh();
  }

  close() {
    this.el.style.display = 'none';
    this._station = null;
  }

  isOpen() {
    return this._station != null;
  }

  update() {
    if (!this._station) return;
    const me = ClientState.me();
    if (!me || !this._station.isAdjacent(me.tile)) {
      this.close();
      return;
    }
    this._refresh();
  }

  _refresh() {
    const me = ClientState.me();
    if (!me || !me.storage) return;
    const key = this._key(me);
    if (key === this._shownKey) return;
    this._shownKey = key;
    this._storageGrid.innerHTML = '';
    for (const item of me.storage.items()) {
      const cell = this._cell(item, me.storage.countOf(item), this._storageGrid);
      cell.addEventListener('pointerdown', (e) => this._onStorageClick(e, item));
    }
    this._empty.style.display = me.storage.isEmpty() ? '' : 'none';
    this._inventoryGrid.innerHTML = '';
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = me.inventory.slots[i];
      const cell = this._cell(stack ? stack.item : null, stack ? stack.count : 0, this._inventoryGrid);
      if (stack) cell.addEventListener('pointerdown', (e) => this._onInventoryClick(e, i));
    }
  }

  /** A fingerprint of what's shown. */
  _key(me) {
    const parts = me.storage.items().map((item) => `${item.id}:${me.storage.countOf(item)}`);
    parts.push('|');
    for (const stack of me.inventory.slots) parts.push(stack ? `${stack.item.id}:${stack.count}` : '-');
    return parts.join(',');
  }

  _cell(item, count, parent) {
    const cell = el('div', 'cell', '', parent);
    if (!item) return cell;
    el('div', 'swatch', '', cell).style.background = cssColor(item.color);
    el('div', 'cell-name', count <= 1 ? item.display_name : `${item.display_name} ×${count}`, cell);
    cell.title = count > 1 ? `${item.display_name} ×${count}` : item.display_name;
    return cell;
  }

  _onStorageClick(e, item) {
    e.preventDefault();
    const id = ClientState.localPlayerId;
    if (e.button === 0) {
      this.link.send(id, new WithdrawAction(item.id, 1));
    } else if (e.button === 2) {
      const options = [['Withdraw 1', 1], ['Withdraw 5', 5], ['Withdraw All', WithdrawAction.ALL]].map(([verb, amount]) => ({
        verb, target: item.display_name, color: ITEM_COLOR, action: () => this.link.send(id, new WithdrawAction(item.id, amount)),
      }));
      options.push({ verb: 'Cancel', action: null });
      this.menu.open(options, e.clientX, e.clientY);
    }
  }

  _onInventoryClick(e, index) {
    e.preventDefault();
    const id = ClientState.localPlayerId;
    const me = ClientState.me();
    const stack = me ? me.inventory.slots[index] : null;
    if (!stack) return;
    if (e.button === 0) {
      this.link.send(id, new DepositAction(index, 1));
    } else if (e.button === 2) {
      const options = [['Deposit 1', 1], ['Deposit 5', 5], ['Deposit All', DepositAction.ALL]].map(([verb, amount]) => ({
        verb, target: stack.item.display_name, color: ITEM_COLOR, action: () => this.link.send(id, new DepositAction(index, amount)),
      }));
      options.push({ verb: 'Cancel', action: null });
      this.menu.open(options, e.clientX, e.clientY);
    }
  }
}
