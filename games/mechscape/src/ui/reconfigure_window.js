// The manufactory's Reconfigure window: the look picker, opened when you use
// the manufactory (open_reconfigure event). Apply sends a SetLookAction; the
// sim only accepts it beside the manufactory.

import { ClientState } from '../client/client_state.js';
import { SetLookAction } from '../sim/appearance.js';
import { chebyshev } from '../sim/grid.js';
import { el } from './screen.js';
import { onEscape } from './common.js';
import { LookEditor, rememberLook } from './look_editor.js';

export class ReconfigureWindow {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'reconfigure panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    el('div', 'title grow', 'Reconfigure', header);
    this._slot = el('div', '', '', this.el);
    el('div', 'muted small', 'Cosmetics you wear (hats, decals, paint jobs) go on top of this.', this.el);
    const buttons = el('div', 'row', '', this.el);
    el('button', '', 'Reprint', buttons).addEventListener('click', () => this._apply());
    el('button', '', 'Cancel', buttons).addEventListener('click', () => this.close());
    this._editor = null;
    this._station = null;
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_reconfigure') {
          const station = ClientState.world.stations.get(event.data.station);
          if (station) this.open(station);
        }
      }
      // Walked away: close.
      const me = ClientState.me();
      if (this._station && me && chebyshev(me.tile, this._station.tile) > 2) this.close();
    });
    onEscape(30, () => this.isOpen(), () => this.close());
  }

  open(station) {
    if (this.isOpen()) return;
    this._station = station;
    const me = ClientState.me();
    this._editor = new LookEditor(this._slot, me && me.look);
    this.el.style.display = '';
  }

  _apply() {
    const look = this._editor.look;
    rememberLook(look);
    this.link.send(ClientState.localPlayerId, new SetLookAction(look));
    this.close();
  }

  close() {
    this.el.style.display = 'none';
    this._station = null;
    if (this._editor) this._editor.dispose();
    this._editor = null;
  }

  isOpen() {
    return this._station != null;
  }
}
