// Small DOM helpers for the HTML overlay screens.

export const ui = document.getElementById('ui');

/** An element with a class and optional text. */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Replaces everything in the overlay with [node]. */
export function show(node) {
  ui.replaceChildren(node);
}
