// Small pieces the UI shares: colours, number formatting, the option format
// menus and hover text use, and Esc handling.

import { cssColor } from '../view/tile_math.js';

export const NPC_COLOR = cssColor([1, 0.85, 0.25]);
export const OBJECT_COLOR = cssColor([0.4, 0.85, 1]);
export const ITEM_COLOR = cssColor([1, 0.6, 0.3]);
export const MUTED = cssColor([0.72, 0.75, 0.8]);

/**
 * An option, OSRS-style: { verb, target, color, action }. The verb in white,
 * the target in its colour. action may be null (Cancel).
 */
export function optionHtml(option) {
  const verb = escapeHtml(option.verb || '');
  if (!option.target) return verb;
  return `${verb} <span style="color:${option.color || '#fff'}">${escapeHtml(option.target)}</span>`.trim();
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function commas(value) {
  return Math.trunc(value).toLocaleString('en-US');
}

/** Compact stack counts, like OSRS: 999, 12K, 3M. */
export function short(value) {
  if (value >= 10000000) return `${Math.floor(value / 1000000)}M`;
  if (value >= 100000) return `${Math.floor(value / 1000)}K`;
  return String(value);
}

/** "4 ticks (2.4s)" */
export function ticks(n) {
  n = Math.max(n, 0);
  return `${n} tick${n === 1 ? '' : 's'} (${(n * 0.6).toFixed(1)}s)`;
}

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Esc closes the topmost open window. Windows register a check and a close,
 * highest priority first (the right-click menu, then popups, then menus).
 */
const closers = [];
export function onEscape(priority, isOpen, close) {
  closers.push({ priority, isOpen, close });
  closers.sort((a, b) => b.priority - a.priority);
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const c of closers) {
    if (c.isOpen()) {
      c.close();
      e.preventDefault();
      return;
    }
  }
});

/** Keeps a box of [width]×[height] on screen next to a point. */
export function clampToScreen(x, y, width, height, margin = 4) {
  return {
    x: Math.min(Math.max(x, margin), window.innerWidth - width - margin),
    y: Math.min(Math.max(y, margin), window.innerHeight - height - margin),
  };
}
