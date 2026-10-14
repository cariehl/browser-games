// The line next to the mouse saying what a left click would do, OSRS-style:
// "Attack Relic sentry", "Salvage Crashed drone". It says how many other
// options a right click has. Hidden over plain ground and walls.

import { el } from './screen.js';
import { optionHtml, escapeHtml } from './common.js';

export class HoverText {
  constructor(parent) {
    this.el = el('div', 'hover-text', '', parent);
    this.el.style.display = 'none';
    /** Set by UI (an inventory slot under the mouse); shown instead of what the world has under the mouse. */
    this._ui = null;
    this._html = '';
  }

  /** For UI: what to show while the mouse is over it (null to clear). */
  setUiOption(option, more = 0, detail = '') {
    this._ui = option ? { option, more, detail } : null;
  }

  uiOption() {
    return this._ui;
  }

  /** Shows the default option, how many more a right click offers, and an optional line of detail. */
  show(option, more, x, y, detail = '') {
    let html = optionHtml(option);
    if (more > 0) html += `  <span class="muted">/ ${more} more option${more === 1 ? '' : 's'}</span>`;
    if (detail) html += `<div class="detail">${escapeHtml(detail)}</div>`;
    if (html !== this._html) {
      this.el.innerHTML = html;
      this._html = html;
    }
    this.el.style.display = '';
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(x + 18, window.innerWidth - w - 4)}px`;
    this.el.style.top = `${Math.min(y + 20, window.innerHeight - h - 4)}px`;
  }

  hide() {
    this.el.style.display = 'none';
  }
}
