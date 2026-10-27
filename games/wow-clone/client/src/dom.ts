// Small DOM helpers for the HTML overlay screens.

export const ui = document.getElementById('ui') as HTMLDivElement;

/** An element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Replaces everything in the overlay with [node]. */
export function show(node: HTMLElement) {
  ui.replaceChildren(node);
}
