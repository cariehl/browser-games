// The keybinding panel: click an action's key, then press the new key (or
// the middle or a side mouse button). Esc cancels a rebind; a key already in
// use moves to the new action.

import { el } from '../dom.js';
import { ACTIONS, keyLabel } from '../keybinds.js';

export class KeybindPanel {
  /** [onClose]: called when the panel closes. */
  constructor(keybinds, onClose) {
    this.keybinds = keybinds;
    this.onClose = onClose;
    this.root = el('div', 'panel keybinds');
    this.root.hidden = true;
    this.list = el('div', 'bind-list');
    const reset = el('button', 'quiet', 'Reset to defaults');
    reset.onclick = () => {
      keybinds.reset();
      this.render();
    };
    const close = el('button', 'primary', 'Done');
    close.onclick = () => this.close();
    const actions = el('div', 'actions');
    actions.append(reset, close);
    this.root.append(el('h1', '', 'Keybindings'), el('p', 'muted small', 'Click a key, then press the new key or mouse button. Esc cancels.'), this.list, actions);
  }

  get open() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
    this.render();
  }

  close() {
    this.stopListening();
    this.root.hidden = true;
    this.onClose();
  }

  render() {
    this.list.replaceChildren(...ACTIONS.map((action) => {
      const row = el('div', 'bind-row');
      const key = el('button', 'bind-key', keyLabel(this.keybinds.keyFor(action.id)) || '—');
      key.onclick = () => this.listen(action.id, key);
      row.append(el('span', '', action.label), key);
      return row;
    }));
  }

  /** Waits for the next key press and binds it to [actionId]. */
  listen(actionId, button) {
    this.stopListening();
    button.textContent = 'Press a key…';
    button.classList.add('listening');
    this.onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.stopListening();
      if (e.code !== 'Escape') this.keybinds.set(actionId, e.code);
      this.render();
    };
    // Middle (1) and side (3, 4) buttons; left and right stay for clicking.
    this.onButton = (e) => {
      const code = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button];
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopListening();
      this.keybinds.set(actionId, code);
      this.render();
    };
    window.addEventListener('keydown', this.onKey, { capture: true });
    window.addEventListener('mousedown', this.onButton, { capture: true });
  }

  stopListening() {
    if (this.onKey) window.removeEventListener('keydown', this.onKey, { capture: true });
    if (this.onButton) window.removeEventListener('mousedown', this.onButton, { capture: true });
    this.onKey = null;
    this.onButton = null;
  }

  dispose() {
    this.stopListening();
  }
}
