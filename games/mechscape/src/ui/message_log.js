// OSRS-style game messages, bottom-left: "You begin to salvage...", level-ups.
//
// Keeps the last MAX_LINES messages in a scrollable box. New messages scroll
// it to the bottom, unless you've scrolled up to read something, in which
// case it stays put.

import { ClientState } from '../client/client_state.js';
import { el } from './screen.js';

const MAX_LINES = 500;

export class MessageLog {
  constructor(parent) {
    this.el = el('div', 'message-log panel', '', parent);
    this._text = el('div', 'lines', '', this.el);
    this.push('Welcome to MechScape.');
    if (ClientState.notice) {
      this.push(ClientState.notice);
      ClientState.notice = '';
    }
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'message') this.push(event.data.text);
      }
    });
  }

  /** Adds a line: from the sim, or from the client (saving, loading). */
  push(text) {
    const box = this._text;
    const atBottom = box.scrollTop >= box.scrollHeight - box.clientHeight - 4;
    el('div', 'line', text, box);
    while (box.childElementCount > MAX_LINES) box.firstElementChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  lineCount() {
    return this._text.childElementCount;
  }
}
