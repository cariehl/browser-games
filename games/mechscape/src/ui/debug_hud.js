// Collapsible debug window: live tick state, toggles for the debug overlay,
// tick speed, simulated input latency, and cheats for testing progression.
// Click the header (or press F4) to expand or collapse it.
//
// Online, the server runs the ticks, so there's no tick speed and no
// save/load, and the XP cheat only shows when the server allows debug actions.

import { ClientState, SPEEDS, TICK_SECONDS } from '../client/client_state.js';
import { AUTOSAVE_TICKS } from '../client/save_manager.js';
import { Skills } from '../sim/skills.js';
import { DebugGrantXpAction, DebugGiveAction } from '../sim/actions.js';
import { Content } from '../sim/defs.js';
import { Hitbox, HitboxFilter } from '../view/hitbox.js';
import { isTyping } from '../view/camera_rig.js';
import { el } from './screen.js';
import { DebugView } from './common.js';

export class DebugHud {
  /** [saves]: the SaveManager, or null online. [cheats]: whether to offer debug actions. */
  constructor(parent, { overlay, link, saves, messageLog, cheats = true }) {
    this.overlay = overlay;
    this.link = link;
    this.saves = saves;
    this.messageLog = messageLog;
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
      ['Ids in menus (F6)', () => DebugView.showIds, (on) => { DebugView.showIds = on; }],
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

    const hitRow = el('div', 'row', '', this._body);
    el('span', 'label', 'Hitboxes (F5)', hitRow);
    this._hitboxes = el('select', '', '', hitRow);
    for (const [key, { label }] of Object.entries(HitboxFilter)) el('option', '', label, this._hitboxes).value = key;
    this._hitboxes.addEventListener('change', () => {
      Hitbox.setDebugFilter(this._hitboxes.value);
      this._hitboxes.blur();
    });

    const speedRow = el('div', 'row', '', this._body);
    if (!saves) speedRow.style.display = 'none';
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

    const xp = el('div', '', '', this._body);
    if (!cheats) xp.style.display = 'none';
    el('hr', '', '', xp);
    el('div', 'muted', 'Grant XP (arrives as a normal XP drop)', xp);
    const xpRow = el('div', 'row', '', xp);
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

    // Give items: type to search every item by name or id, pick one, say how many.
    el('div', 'muted', 'Give item', xp);
    const giveRow = el('div', 'row', '', xp);
    this._giveName = el('input', 'grow', '', giveRow);
    this._giveName.placeholder = 'Item name or id';
    this._giveName.spellcheck = false;
    const listId = 'debug-items';
    this._giveName.setAttribute('list', listId);
    const list = el('datalist', '', '', giveRow);
    list.id = listId;
    for (const item of Object.values(Content.items).sort((a, b) => a.display_name.localeCompare(b.display_name))) {
      el('option', '', item.id, list).value = `${item.display_name} (${item.id})`;
    }
    this._giveCount = el('input', 'number', '', giveRow);
    this._giveCount.type = 'number';
    this._giveCount.min = '1';
    this._giveCount.max = '1000';
    this._giveCount.value = '1';
    el('button', '', 'Give', giveRow).addEventListener('click', () => this._give());
    for (const input of [this._giveName, this._giveCount]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this._give();
      });
    }
    this._giveNote = el('div', 'muted small', '', xp);

    el('hr', '', '', this._body);
    this._saved = el('div', '', '', this._body);
    if (saves) {
      const saveRow = el('div', 'row', '', this._body);
      for (const [text, fn] of [['Save', () => saves.save()], ['Load', () => saves.load()], ['New game', () => saves.newGame()]]) {
        el('button', '', text, saveRow).addEventListener('click', fn);
      }
      el('div', 'muted small', 'Right-click: options · R: run · Ctrl+S/L: save/load · F4: hide', this._body);
    } else {
      this._saved.textContent = 'The server saves the world every minute.';
      el('div', 'muted small', 'Right-click: options · R: run · F4: hide', this._body);
    }

    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping(e)) return;
      if (e.key === 'F4') this._toggle();
      else if (e.key === 'F5') Hitbox.cycleDebugFilter();
      else if (e.key === 'F6') DebugView.showIds = !DebugView.showIds;
      else if (e.key === '[' && saves) this._stepSpeed(-1);
      else if (e.key === ']' && saves) this._stepSpeed(1);
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
    this.messageLog.push(`Tick speed: ${SPEEDS[index]}x (one tick every ${(TICK_SECONDS / SPEEDS[index]).toFixed(2)}s)`);
  }

  /** Sends the XP through the normal input queue, so it lands on a tick, respects simulated latency, and shows up as a regular XP drop. */
  _grantXp() {
    const skill = Skills.ALL[this._xpSkill.selectedIndex];
    const amount = Math.min(Math.max(Math.round(Number(this._xpAmount.value) || 0), 1), Skills.MAX_XP);
    this.link.send(ClientState.localPlayerId, new DebugGrantXpAction(skill, amount));
  }

  /** Gives the item named in the box: "Name (id)" from the list, a bare id, or a unique bit of a name. */
  _give() {
    const text = this._giveName.value.trim();
    if (!text) return;
    const items = Object.values(Content.items);
    const byId = text.match(/\(([a-z0-9_]+)\)$/);
    const lower = text.toLowerCase();
    let item = Content.items[byId ? byId[1] : text] || items.find((i) => i.display_name.toLowerCase() === lower);
    if (!item) {
      const matches = items.filter((i) => i.display_name.toLowerCase().includes(lower) || i.id.includes(lower));
      if (matches.length === 1) item = matches[0];
      else {
        this._giveNote.textContent = matches.length ? `${matches.length} items match "${text}". Be more specific.` : `No item called "${text}".`;
        return;
      }
    }
    const count = Math.min(Math.max(Math.round(Number(this._giveCount.value) || 1), 1), 1000);
    this._giveNote.textContent = `Gave ${count} × ${item.display_name}.`;
    this.link.send(ClientState.localPlayerId, new DebugGiveAction(item.id, count));
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
    if (this._hitboxes.value !== Hitbox.debugFilter) this._hitboxes.value = Hitbox.debugFilter;
    const index = SPEEDS.indexOf(ClientState.speed);
    if (index >= 0 && this._speed.selectedIndex !== index) this._speed.selectedIndex = index;
    setText(this._inFlight, `Actions in flight: ${this.link.inFlight()}`);
    if (!this.saves) return;
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
