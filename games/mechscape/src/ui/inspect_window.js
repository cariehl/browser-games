// The "Inspect" popup: a small card of stats about one thing, opened from a
// right-click menu. Live things (an NPC's HP, a node's respawn timer)
// refresh every frame; it closes itself when the thing is gone, on Esc, or
// with its close button.

import { el } from './screen.js';
import { onEscape, clampToScreen } from './common.js';

export class InspectWindow {
  constructor(parent) {
    this.el = el('div', 'inspect panel', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    const titles = el('div', 'grow', '', header);
    this._title = el('div', 'title', '', titles);
    this._subtitle = el('div', 'subtitle muted', '', titles);
    const close = el('button', 'flat close', '×', header);
    close.addEventListener('click', () => this.close());
    this._separator = el('hr', '', '', this.el);
    this._grid = el('div', 'inspect-grid', '', this.el);
    this._source = null;
    this._live = false;
    this._shown = '';
    onEscape(50, () => this.isOpen(), () => this.close());
  }

  /** Shows [source]()'s info next to (x, y). [live]: refresh every frame. */
  open(source, x, y, live = true) {
    this._source = source;
    this._live = live;
    this._shown = '';
    this.el.style.display = '';
    if (!this._refresh()) return;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const at = clampToScreen(x + 16, y - h / 2, w, h, 8);
    this.el.style.left = `${at.x}px`;
    this.el.style.top = `${at.y}px`;
  }

  close() {
    this.el.style.display = 'none';
    this._source = null;
  }

  isOpen() {
    return this.el.style.display !== 'none';
  }

  update() {
    if (this.isOpen() && this._live) this._refresh();
  }

  /** Rebuilds the card. Returns false (and closes) if the thing is gone. */
  _refresh() {
    const info = this._source ? this._source() : null;
    if (!info) {
      this.close();
      return false;
    }
    const key = JSON.stringify(info);
    if (key === this._shown) return true;
    this._shown = key;
    this._title.textContent = info.title;
    this._subtitle.textContent = info.subtitle || '';
    this._separator.style.display = info.rows.length ? '' : 'none';
    this._grid.innerHTML = '';
    for (const [label, value, warn] of info.rows) {
      el('div', 'muted', label, this._grid);
      el('div', warn ? 'warn' : '', value, this._grid);
    }
    return true;
  }
}
