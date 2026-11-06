// The chatbox, bottom left: game messages ("You begin to salvage...",
// level-ups), public chat from every player online, and announcements for
// everyone (someone joined, a quest finished).
//
// Keeps the last MAX_LINES lines in a scrollable box. New lines scroll it to
// the bottom, unless you've scrolled up to read something, in which case it
// stays put.
//
// Typing: press Enter to start a chat line, Enter again to say it, Esc to
// stop typing. While the box has focus, keys go to it, not the game.

import { ClientState } from '../client/client_state.js';
import { ChatAction, TradeRequestAction, MAX_CHAT } from '../sim/actions.js';
import { el } from './screen.js';
import { isTyping } from '../view/camera_rig.js';

const MAX_LINES = 500;

export class MessageLog {
  constructor(parent, link = null) {
    this.link = link;
    this.el = el('div', 'message-log panel', '', parent);
    this._text = el('div', 'lines', '', this.el);
    this.input = el('input', 'chat-input', '', this.el);
    this.input.maxLength = MAX_CHAT;
    this.input.placeholder = 'Press Enter to chat';
    this.input.spellcheck = false;
    this.push('Welcome to MechScape.');
    if (ClientState.notice) {
      this.push(ClientState.notice);
      ClientState.notice = '';
    }
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.type === 'chat') this.pushChat(event.data.name, event.data.text, event.entity === ClientState.localPlayerId);
        else if (event.type === 'broadcast') this.push(event.data.text, 'broadcast');
        else if (event.type === 'say' && event.data.to === ClientState.localPlayerId) this.pushChat(event.data.name, event.data.text, false);
        else if (event.entity !== ClientState.localPlayerId) continue;
        else if (event.type === 'message') this.push(event.data.text);
        else if (event.type === 'trade_request') this._tradeRequest(event.data.from, event.data.name);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      this.input.focus();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.input.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.say(this.input.value);
        this.input.value = '';
        this.input.blur();
      }
    });
  }

  /** "Bo wishes to trade with you.": click it to say yes. */
  _tradeRequest(from, name) {
    const line = this.push(`${name} wishes to trade with you. (Click here to accept.)`, 'request');
    line.addEventListener('click', () => {
      if (this.link) this.link.send(ClientState.localPlayerId, new TradeRequestAction(from));
    });
  }

  /** Sends a chat line (ignored if blank). */
  say(text) {
    const line = String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT);
    if (!line || !this.link) return;
    this.link.send(ClientState.localPlayerId, new ChatAction(line));
  }

  /** Adds a line: from the sim, or from the client (saving, loading). */
  push(text, className = '') {
    return this._add((line) => {
      line.textContent = text;
    }, className);
  }

  pushChat(name, text, mine) {
    return this._add((line) => {
      el('span', mine ? 'chat-name mine' : 'chat-name', `${name}: `, line);
      el('span', 'chat-text', text, line);
    }, 'chat');
  }

  _add(fill, className) {
    const box = this._text;
    const atBottom = box.scrollTop >= box.scrollHeight - box.clientHeight - 4;
    const line = el('div', className ? `line ${className}` : 'line', '', box);
    fill(line);
    while (box.childElementCount > MAX_LINES) box.firstElementChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
    return line;
  }

  lineCount() {
    return this._text.childElementCount;
  }
}
