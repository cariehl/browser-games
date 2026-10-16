// The dialogue box: what an NPC (and you) say, one line at a time, then the
// choices. Drawn from the player's dialogue state, which the server sets
// when you talk to someone and clears when you walk off.
//
// Click or Space for the next line; 1-9 or click to pick a choice. When the
// lines run out with no choices, continuing closes it. A choice can lead to
// more lines and another menu (the server walks the tree; see sim/quests.js).

import { ClientState } from '../client/client_state.js';
import { DialogueChoiceAction, DialogueCloseAction } from '../sim/quests.js';
import { el } from './screen.js';
import { onEscape } from './common.js';

export class DialogueBox {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'dialogue-box panel', '', parent);
    this.el.style.display = 'none';
    this._speaker = el('div', 'speaker', '', this.el);
    this._text = el('div', 'text', '', this.el);
    this._choices = el('div', 'choices', '', this.el);
    this._continue = el('div', 'continue muted', 'Click here to continue', this.el);
    this._continue.addEventListener('click', () => this._next());
    this._shown = null;
    this._line = 0;
    window.addEventListener('keydown', (e) => {
      if (!this._shown || document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (e.key === ' ' && this._line < this._shown.lines.length) {
        e.preventDefault();
        this._next();
      } else if (/^[1-9]$/.test(e.key) && this._atChoices()) {
        this._choose(Number(e.key) - 1);
      }
    });
    onEscape(33, () => this._shown != null, () => this._close());
  }

  _atChoices() {
    return this._shown && this._line >= this._shown.lines.length - 1 && this._shown.choices.length > 0;
  }

  _next() {
    if (!this._shown) return;
    if (this._line < this._shown.lines.length - 1) {
      this._line++;
      this._render();
    } else if (this._shown.choices.length === 0) {
      this._close();
    }
  }

  _choose(index) {
    if (!this._shown || index >= this._shown.choices.length) return;
    this.link.send(ClientState.localPlayerId, new DialogueChoiceAction(index));
    this._hide();
  }

  _close() {
    this.link.send(ClientState.localPlayerId, new DialogueCloseAction());
    this._hide();
  }

  _hide() {
    this._shown = { ...this._shown, closed: true };
    this.el.style.display = 'none';
  }

  _render() {
    const d = this._shown;
    const line = d.lines[this._line] || { who: 'npc', text: '' };
    const me = ClientState.me();
    const npc = ClientState.world.entities.get(d.npc_id);
    this._speaker.textContent = line.who === 'player' ? (me ? me.display_name : 'You') : (npc ? npc.def.display_name : '');
    this._speaker.classList.toggle('mine', line.who === 'player');
    // Back at a menu with nothing new said: just the choices.
    this._text.textContent = d.lines.length ? line.text : 'Choose an answer.';
    this._text.classList.toggle('muted', !d.lines.length);
    this._choices.innerHTML = '';
    const last = this._line >= d.lines.length - 1;
    if (last && d.choices.length) {
      d.choices.forEach((text, i) => {
        const button = el('button', 'choice', `${i + 1}. ${text}`, this._choices);
        button.addEventListener('click', () => this._choose(i));
      });
    }
    this._continue.style.display = last && d.choices.length ? 'none' : '';
  }

  update() {
    const me = ClientState.me();
    const d = me ? me.dialogue : null;
    if (!d) {
      if (this._shown) {
        this._shown = null;
        this.el.style.display = 'none';
      }
      return;
    }
    if (this._shown && this._shown.serial === d.serial) return;
    this._shown = d;
    this._line = 0;
    this.el.style.display = '';
    this._render();
  }
}
