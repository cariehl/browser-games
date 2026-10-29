import { cardDef } from '../../shared/cards';
import { cardHTML, cardHelp } from './cardview';

/**
 * The battlefield's hover preview (big card, champion level-up, keyword notes) for card lists
 * outside a game. Hovering any `[data-id]` inside `container` that matches `selector` shows it
 * beside that element. Returns a function that removes the preview.
 */
export function attachCardHover(container: HTMLElement, selector: string) {
  const hc = document.createElement('div');
  hc.className = 'hover-card floating';
  document.body.appendChild(hc);
  let current: HTMLElement | null = null;

  const show = (el: HTMLElement) => {
    const id = el.dataset.id;
    if (!id) return;
    current = el;
    const d = cardDef(id);
    const lvl = d.champion ? cardHTML(cardDef(d.champion.to), { extraClass: 'big' }) : '';
    hc.innerHTML = `<div class="hc-row">${cardHTML(d, { extraClass: 'big' })}${lvl}</div><div class="hc-help">${cardHelp(d)}</div>`;
    hc.classList.add('show');
    // Beside the card, on whichever side has room, kept on screen.
    const r = el.getBoundingClientRect();
    const w = hc.offsetWidth, h = hc.offsetHeight;
    const left = r.right + 12 + w <= innerWidth ? r.right + 12 : Math.max(8, r.left - 12 - w);
    hc.style.left = `${left}px`;
    hc.style.top = `${Math.min(Math.max(8, r.top + r.height / 2 - h / 2), innerHeight - h - 8)}px`;
  };
  const hide = () => { current = null; hc.classList.remove('show'); };

  container.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (el && el !== current && container.contains(el)) show(el);
    else if (!el) hide();
  });
  container.addEventListener('mouseleave', hide);
  // Lists re-render on click: if the hovered element is gone, the preview goes too.
  container.addEventListener('click', () => requestAnimationFrame(() => { if (current && !current.isConnected) hide(); }));
  return () => hc.remove();
}
