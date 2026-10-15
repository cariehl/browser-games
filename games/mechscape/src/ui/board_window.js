// The hab's commission board (open_board event): the hab's comfort and
// finished sets at the top, then every commission up, with Fill on other
// people's and Collect (or Take down) on yours, and a form to post one:
// what you want, how many, and what you'll pay from your inventory.

import { ClientState } from '../client/client_state.js';
import { Content } from '../sim/defs.js';
import { CommissionAction, Hab } from '../sim/hab.js';
import { el } from './screen.js';
import { onEscape } from './common.js';

export class BoardWindow {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'board-window panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    el('div', 'title grow', 'Commission board', header);
    el('button', '', 'Close', header).addEventListener('click', () => this.close());
    this._summary = el('div', 'muted small', '', this.el);
    this._list = el('div', 'board-list', '', this.el);
    el('hr', '', '', this.el);
    el('div', '', 'Post a commission', this.el);
    const form = el('div', 'board-form', '', this.el);
    el('span', 'muted small', 'Want', form);
    this._want = el('input', '', '', form);
    this._want.setAttribute('list', 'board-items');
    this._want.placeholder = 'item name';
    const options = el('datalist', '', '', form);
    options.id = 'board-items';
    for (const item of Object.values(Content.items)) {
      if (item.kind === 'quest') continue;
      el('option', '', '', options).value = item.display_name;
    }
    this._wantCount = el('input', 'count', '', form);
    this._wantCount.type = 'number';
    this._wantCount.min = 1;
    this._wantCount.value = 1;
    el('span', 'muted small', 'Pay', form);
    this._offer = el('select', '', '', form);
    this._offerCount = el('input', 'count', '', form);
    this._offerCount.type = 'number';
    this._offerCount.min = 1;
    this._offerCount.value = 1;
    this._post = el('button', '', 'Post', form);
    this._post.addEventListener('click', () => this._postCommission());
    this._board = null;
    this._key = '';
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_board') {
          const board = ClientState.world.stations.get(event.data.station);
          if (board) this.open(board);
        }
      }
      if (!this._board) return;
      const me = ClientState.me();
      if (!me || !this._board.isAdjacent(me.tile)) this.close();
      else this._refresh();
    });
    onEscape(30, () => this._board != null, () => this.close());
  }

  open(board) {
    this._board = board;
    this._key = '';
    this.el.style.display = '';
    this._refresh();
  }

  close() {
    this._board = null;
    this.el.style.display = 'none';
  }

  _send(command, fields) {
    this.link.send(ClientState.localPlayerId, new CommissionAction(this._board.id, command, fields));
  }

  _postCommission() {
    const name = this._want.value.trim().toLowerCase();
    const want = Object.values(Content.items).find((i) => i.display_name.toLowerCase() === name || i.id === name);
    if (!want || !this._offer.value) {
      this._want.classList.add('bad');
      return;
    }
    this._want.classList.remove('bad');
    this._send('post', { want: want.id, wantCount: Number(this._wantCount.value) || 1, offer: this._offer.value, offerCount: Number(this._offerCount.value) || 1 });
    this._want.value = '';
  }

  _refresh() {
    const world = ClientState.world;
    const me = ClientState.me();
    if (!me) return;
    const inv = me.inventory.slots.map((s) => (s ? `${s.item.id}:${s.count}` : '')).join(',');
    const key = JSON.stringify([world.commissions, world.hab_comfort, world.hab_sets, inv]);
    if (key === this._key) return;
    this._key = key;
    const sets = (world.hab_sets || []).map((id) => Hab.setName(id));
    this._summary.textContent = `Hab comfort ${world.hab_comfort || 0} (${Content.rules.hab.rested_comfort} to rest well).${sets.length ? ` Sets: ${sets.join(', ')}.` : ''}`;

    const name = (id) => (Content.item(id) || { display_name: id }).display_name;
    this._list.innerHTML = '';
    const list = world.commissions || [];
    if (!list.length) el('div', 'muted', 'Nothing pinned up yet.', this._list);
    for (const c of list) {
      const row = el('div', `row board-row ${c.filled_by ? 'done' : ''}`, '', this._list);
      el('span', 'grow', `${c.want_count} × ${name(c.want)} for ${c.offer_count} × ${name(c.offer)}`, row);
      const mine = c.by === me.display_name;
      el('span', 'muted small', mine ? (c.filled_by ? `filled by ${c.filled_by}` : 'yours') : c.by, row);
      if (mine) {
        el('button', '', c.filled_by ? 'Collect' : 'Take down', row).addEventListener('click', () => this._send('collect', { id: c.id }));
      } else if (!c.filled_by) {
        const want = Content.item(c.want);
        const button = el('button', '', 'Fill', row);
        button.disabled = !want || me.inventory.countOf(want) < c.want_count;
        button.addEventListener('click', () => this._send('fill', { id: c.id }));
      }
    }

    // What you can pay with: one entry per item you carry.
    const current = this._offer.value;
    this._offer.innerHTML = '';
    const seen = new Set();
    for (const s of me.inventory.slots) {
      if (!s || seen.has(s.item.id) || s.item.kind === 'quest') continue;
      seen.add(s.item.id);
      const option = el('option', '', `${s.item.display_name} (${me.inventory.countOf(s.item)})`, this._offer);
      option.value = s.item.id;
    }
    if (seen.has(current)) this._offer.value = current;
    const posted = list.filter((c) => c.by === me.display_name).length;
    this._post.disabled = !seen.size || posted >= Content.rules.hab.max_commissions_each;
  }
}
