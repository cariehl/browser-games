// Collapsible debug window: live tick state, toggles for the debug overlay,
// tick speed, simulated input latency, and cheats for testing progression.
// Click the header (or press F4) to expand or collapse it.
//
// Local play only: its cheats are debug actions a server refuses, and tick
// speed only exists when you run the sim yourself.

import { ClientState, SPEEDS, TICK_SECONDS } from '../client/client_state.js';
import { AUTOSAVE_TICKS } from '../client/save_manager.js';
import { Skills } from '../sim/skills.js';
import { DebugGrantXpAction } from '../sim/actions.js';
import { Hitbox } from '../view/hitbox.js';
import { isTyping } from '../view/camera_rig.js';
import { el } from './screen.js';

export class DebugHud {
  constructor(parent, { overlay, link, saves }) {
    this.overlay = overlay;
    this.link = link;
    this.saves = saves;
    this.el = el('div', 'debug-hud panel', '', parent);
    this._header = el('button', 'flat header', '', this.el);
    this._header.addEventListener('click', () => this._toggle());
    this._body = el('div', 'body', '', this.el);
    this._status = el('div', 'status', '', this._body);
    el('hr', '', '', this._body);

    // The overlay toggles sit in two columns to keep the window short.
    const toggles = el('div', 'toggles', '', this._body);
    this._boxes = [
      ['Path (F1)', () => overlay.showPath, (on) => { overlay.showPath = on; }],
      ['True tile (F2)', () => overlay.showTrueTile, (on) => { overlay.showTrueTile = on; }],
      ['Tick metronome (F3)', () => overlay.metronome, (on) => { overlay.metronome = on; }],
      ['Hitboxes (F5)', () => Hitbox.debugVisible, (on) => Hitbox.setDebugVisible(on)],
    ].map(([text, get, set]) => {
      const label = el('label', 'check', '', toggles);
      const box = el('input', '', '', label);
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        set(box.checked);
        box.blur();
      });
      label.append(text);
      return { box, get };
    });

    const speedRow = el('div', 'row', '', this._body);
    el('span', 'label', 'Tick speed', speedRow);
    this._speed = el('select', '', '', speedRow);
    for (const value of SPEEDS) el('option', '', `${value}x`, this._speed);
    this._speed.addEventListener('change', () => {
      ClientState.setSpeed(SPEEDS[this._speed.selectedIndex]);
      this._speed.blur();
    });
    el('span', 'muted', '  [ and ] keys', speedRow);

    el('hr', '', '', this._body);
    el('div', 'muted', 'Simulated input delay', this._body);
    this._spinRow('Base', 2000, (v) => { link.baseMs = v; });
    this._spinRow('Fuzz ±', 1000, (v) => { link.fuzzMs = v; });
    this._inFlight = el('div', '', '', this._body);

    el('hr', '', '', this._body);
    el('div', 'muted', 'Grant XP (arrives as a normal XP drop)', this._body);
    const xpRow = el('div', 'row', '', this._body);
    this._xpSkill = el('select', '', '', xpRow);
    for (const skill of Skills.ALL) el('option', '', Skills.displayName(skill), this._xpSkill);
    this._xpAmount = el('input', 'number', '', xpRow);
    this._xpAmount.type = 'number';
    this._xpAmount.min = '1';
    this._xpAmount.max = String(Skills.MAX_XP);
    this._xpAmount.value = '100';
    el('span', 'muted', 'XP', xpRow);
    el('button', '', 'Add', xpRow).addEventListener('click', () => this._grantXp());
    this._xpAmount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._grantXp();
    });

    el('hr', '', '', this._body);
    this._saved = el('div', '', '', this._body);
    const saveRow = el('div', 'row', '', this._body);
    for (const [text, fn] of [['Save', () => saves.save()], ['Load', () => saves.load()], ['New game', () => saves.newGame()]]) {
      el('button', '', text, saveRow).addEventListener('click', fn);
    }
    el('div', 'muted small', 'Right-click: options · R: run · Ctrl+S/L: save/load · F4: hide', this._body);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping(e)) return;
      if (e.key === 'F4') this._toggle();
      else if (e.key === 'F5') Hitbox.setDebugVisible(!Hitbox.debugVisible);
      else if (e.key === '[') this._stepSpeed(-1);
      else if (e.key === ']') this._stepSpeed(1);
      else return;
      e.preventDefault();
    });
    this._updateHeader();
  }

  _spinRow(text, max, onChange) {
    const row = el('div', 'row', '', this._body);
    el('span', 'label', text, row);
    const input = el('input', 'number', '', row);
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.step = '10';
    input.value = '0';
    el('span', 'muted', 'ms', row);
    input.addEventListener('input', () => {
      const v = Math.min(Math.max(Math.round(Number(input.value) || 0), 0), max);
      onChange(v);
    });
  }

  /** Slower or faster through SPEEDS. */
  _stepSpeed(direction) {
    const index = Math.min(Math.max(SPEEDS.indexOf(ClientState.speed) + direction, 0), SPEEDS.length - 1);
    ClientState.setSpeed(SPEEDS[index]);
    this.saves.messageLog.push(`Tick speed: ${SPEEDS[index]}x (one tick every ${(TICK_SECONDS / SPEEDS[index]).toFixed(2)}s)`);
  }

  /** Sends the XP through the normal input queue, so it lands on a tick, respects simulated latency, and shows up as a regular XP drop. */
  _grantXp() {
    const skill = Skills.ALL[this._xpSkill.selectedIndex];
    const amount = Math.min(Math.max(Math.round(Number(this._xpAmount.value) || 0), 1), Skills.MAX_XP);
    this.link.send(ClientState.localPlayerId, new DebugGrantXpAction(skill, amount));
  }

  update() {
    const world = ClientState.world;
    const me = ClientState.me();
    if (this._body.style.display === 'none') return;
    if (me) {
      const doing = me.activity ? `  ·  ${Skills.displayName(me.activity)}` : '';
      const speed = ClientState.speed !== 1 ? `   ·   ${ClientState.speed}x speed` : '';
      setText(this._status, `Tick ${world.tick}   True tile (${me.tile.x}, ${me.tile.y})   ${me.running ? 'Running' : 'Walking'}${doing}${speed}`);
    }
    // Keep the boxes in sync when the F-keys change things.
    for (const { box, get } of this._boxes) box.checked = get();
    const index = SPEEDS.indexOf(ClientState.speed);
    if (index >= 0 && this._speed.selectedIndex !== index) this._speed.selectedIndex = index;
    setText(this._inFlight, `Actions in flight: ${this.link.inFlight()}`);
    setText(this._saved, this.saves.lastSavedTick >= 0
      ? `Last saved: tick ${this.saves.lastSavedTick} (autosaves every ${AUTOSAVE_TICKS})`
      : `Not saved yet (autosaves every ${AUTOSAVE_TICKS} ticks)`);
  }

  _toggle() {
    this._body.style.display = this._body.style.display === 'none' ? '' : 'none';
    this._updateHeader();
  }

  _updateHeader() {
    this._header.textContent = (this._body.style.display === 'none' ? '▸ ' : '▾ ') + 'Debug';
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
