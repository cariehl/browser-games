// Small DOM helpers shared by the editor's views.

export function el(tag, cls = '', text = '', parent = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '' && text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export function button(label, parent, onClick, cls = 'small') {
  const b = el('button', cls, label, parent);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

/** [r, g, b(, a)] in 0..1 as #rrggbb. */
export function toHex(color) {
  return '#' + color.slice(0, 3).map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  return [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000);
}

export function cssColor(color) {
  if (typeof color === 'string') return color;
  if (!Array.isArray(color)) return '#777';
  return `rgb(${color.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})`;
}

export function toast(text, ms = 2200) {
  const t = el('div', 'toast', text, document.body);
  setTimeout(() => t.remove(), ms);
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Seconds for a tick count (0.6 s a tick), for hints. */
export function ticksHint(ticks) {
  const s = ticks * 0.6;
  return s >= 90 ? `≈ ${Math.round(s / 6) / 10} min` : `≈ ${Math.round(s * 10) / 10} s`;
}
