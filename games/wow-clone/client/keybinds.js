// Rebindable keys, saved in the browser. Keys are KeyboardEvent.code values,
// so a binding follows the key's position (W is Z on an AZERTY keyboard).

import { loadSetting, saveSetting } from './net.js';

const STORAGE_KEY = 'raid.keybinds';

/** Everything a key can do, in the order the keybinding panel lists them. */
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', key: 'KeyW' },
  { id: 'back', label: 'Move backward', key: 'KeyS' },
  { id: 'turnLeft', label: 'Turn left', key: 'KeyA' },
  { id: 'turnRight', label: 'Turn right', key: 'KeyD' },
  { id: 'strafeLeft', label: 'Strafe left', key: 'KeyQ' },
  { id: 'strafeRight', label: 'Strafe right', key: 'KeyE' },
  { id: 'action1', label: 'Action button 1', key: 'Digit1' },
  { id: 'action2', label: 'Action button 2', key: 'Digit2' },
  { id: 'action3', label: 'Action button 3', key: 'Digit3' },
  { id: 'action4', label: 'Action button 4', key: 'Digit4' },
  { id: 'action5', label: 'Action button 5', key: 'Digit5' },
  { id: 'targetNext', label: 'Target next enemy', key: 'Tab' },
  { id: 'targetSelf', label: 'Target yourself', key: 'F1' },
  { id: 'targetParty1', label: 'Target party member 1', key: 'F2' },
  { id: 'targetParty2', label: 'Target party member 2', key: 'F3' },
  { id: 'targetParty3', label: 'Target party member 3', key: 'F4' },
  { id: 'targetParty4', label: 'Target party member 4', key: 'F5' },
  { id: 'clear', label: 'Stop casting / clear target', key: 'Escape' },
];

/** Actions held down rather than pressed once. */
export const MOVEMENT = new Set(['forward', 'back', 'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight']);

const DEFAULTS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key]));

/** A short name for a key code, for buttons: 'KeyW' -> 'W', 'Digit1' -> '1'. */
export function keyLabel(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
  const names = {
    Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Space: 'Space', CapsLock: 'Caps',
    ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl', AltLeft: 'LAlt', AltRight: 'RAlt',
  };
  return names[code] ?? code;
}

export class Keybinds {
  /** Action id -> key code ('' if unbound). */
  binds = { ...DEFAULTS };

  constructor() {
    const saved = loadSetting(STORAGE_KEY, {});
    for (const [action, code] of Object.entries(saved ?? {})) {
      if (action in DEFAULTS && typeof code === 'string') this.binds[action] = code;
    }
  }

  keyFor(action) {
    return this.binds[action] ?? '';
  }

  /** The action bound to key [code], or null. */
  actionFor(code) {
    for (const [action, key] of Object.entries(this.binds)) if (key === code) return action;
    return null;
  }

  /** Binds [action] to [code]; whatever had that key loses it. */
  set(action, code) {
    for (const [other, key] of Object.entries(this.binds)) if (key === code) this.binds[other] = '';
    this.binds[action] = code;
    this.save();
  }

  reset() {
    this.binds = { ...DEFAULTS };
    this.save();
  }

  save() {
    // Only what differs from the defaults, so new defaults reach old saves.
    const changed = Object.fromEntries(Object.entries(this.binds).filter(([a, k]) => DEFAULTS[a] !== k));
    saveSetting(STORAGE_KEY, changed);
  }
}
