// OSRS-style right-click menu: "Choose option", then one row per option,
// each a verb in white and the target in its colour. Click a row to pick it;
// clicking elsewhere, Esc, or moving the mouse well away closes it.

import { el } from './screen.js';
import { optionHtml, onEscape, clampToScreen } from './common.js';

/** Close when the mouse wanders this far outside the menu. */
const LEAVE_MARGIN = 24;

export class ContextMenu {
  constructor(parent) {
    this.el = el('div', 'context-menu panel', '', parent);
    this.el.style.display = 'none';
    // A click outside closes the menu and does nothing else.
    window.addEventListener('pointerdown', (e) => {
      if (!this.isOpen() || this.el.contains(e.target)) return;
      this.close();
      e.stopPropagation();
      e.preventDefault();
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (!this.isOpen()) return;
      const r = this.el.getBoundingClientRect();
      if (e.clientX < r.left - LEAVE_MARGIN || e.clientX > r.right + LEAVE_MARGIN
        || e.clientY < r.top - LEAVE_MARGIN || e.clientY > r.bottom + LEAVE_MARGIN) this.close();
    });
    onEscape(100, () => this.isOpen(), () => this.close());
  }

  open(options, x, y) {
    this.el.innerHTML = '';
    el('div', 'menu-title', 'Choose option', this.el);
    for (const option of options) {
      const row = el('div', 'menu-row', '', this.el);
      row.innerHTML = optionHtml(option);
      row.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 2) return;
        e.stopPropagation();
        e.preventDefault();
        this.close();
        if (option.action) option.action();
      });
    }
    this.el.style.display = '';
    // Centred under the mouse, like OSRS, but kept on screen.
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const at = clampToScreen(x - w / 2, y - 8, w, h);
    this.el.style.left = `${at.x}px`;
    this.el.style.top = `${at.y}px`;
  }

  close() {
    this.el.style.display = 'none';
  }

  isOpen() {
    return this.el.style.display !== 'none';
  }
}
