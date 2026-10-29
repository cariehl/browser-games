import { ALL_CARDS, COLOR_INFO, cardDef } from '../../shared/cards';
import { DECKS, DECK_SIZE, MAX_COLORS, MAX_COPIES, deckColors, deckCount, validateDeck, type DeckList } from '../../shared/decks';
import type { Color } from '../../shared/types';
import { sfx } from './audio';
import { cardHTML, esc } from './cardview';
import { upsertCustom } from './deckstore';

const COLORS: Color[] = ['ember', 'tide', 'grove', 'dawn', 'dusk'];

/** Full-screen deck editor. Calls `done(id)` with the saved deck id, or null if cancelled. */
export function openDeckBuilder(ui: HTMLElement, start: DeckList | null, done: (id: string | null) => void) {
  const deck: DeckList = start ? structuredClone(start) : { id: `custom_${Date.now()}`, name: 'My Deck', cards: [] };
  let colorFilter: Color | 'all' = 'all';
  let costFilter = -1;
  let search = '';

  const root = document.createElement('div');
  root.className = 'builder';
  ui.appendChild(root);

  const count = (id: string) => deck.cards.find(([c]) => c === id)?.[1] ?? 0;

  function add(id: string) {
    const d = cardDef(id);
    if (deckCount(deck.cards) >= DECK_SIZE) return flash(`Decks hold exactly ${DECK_SIZE} cards.`);
    if (count(id) >= MAX_COPIES) return flash(`Max ${MAX_COPIES} copies per card.`);
    const cols = deckColors(deck.cards);
    if (!cols.includes(d.color) && cols.length >= MAX_COLORS) return flash(`Decks can use at most ${MAX_COLORS} colors.`);
    const e = deck.cards.find(([c]) => c === id);
    if (e) e[1]++; else deck.cards.push([id, 1]);
    sfx.click();
    render();
  }
  function remove(id: string) {
    const e = deck.cards.find(([c]) => c === id);
    if (!e) return;
    e[1]--;
    if (e[1] <= 0) deck.cards = deck.cards.filter(([c]) => c !== id);
    sfx.pass();
    render();
  }
  function flash(msg: string) {
    sfx.error();
    const el = root.querySelector('.b-msg') as HTMLElement;
    el.textContent = msg;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function render() {
    const cols = deckColors(deck.cards);
    const pool = ALL_CARDS.filter((c) => !c.token)
      .filter((c) => colorFilter === 'all' || c.color === colorFilter)
      .filter((c) => costFilter < 0 || (costFilter >= 7 ? c.cost >= 7 : c.cost === costFilter))
      .filter((c) => !search || (c.name + ' ' + c.text + ' ' + (c.kw ?? []).join(' ')).toLowerCase().includes(search))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    const total = deckCount(deck.cards);
    const curve = Array.from({ length: 8 }, (_, i) => deck.cards.reduce((a, [id, n]) => a + ((Math.min(7, cardDef(id).cost) === i) ? n : 0), 0));
    const maxC = Math.max(4, ...curve);
    const types = { unit: 0, spell: 0, order: 0 };
    for (const [id, n] of deck.cards) types[cardDef(id).type] += n;
    const err = validateDeck(deck.cards);
    const list = [...deck.cards].sort((a, b) => cardDef(a[0]).cost - cardDef(b[0]).cost || cardDef(a[0]).name.localeCompare(cardDef(b[0]).name));

    root.innerHTML = `
      <div class="panel b-pool">
        <div class="b-filters">
          <button class="btn small ${colorFilter === 'all' ? '' : 'ghost'}" data-color="all">All</button>
          ${COLORS.map((c) => `<button class="btn small ${colorFilter === c ? '' : 'ghost'} ${cols.length >= MAX_COLORS && !cols.includes(c) ? 'locked' : ''}" data-color="${c}"><i class="dot" style="--c:${COLOR_INFO[c].hex}"></i> ${COLOR_INFO[c].name}</button>`).join('')}
          <span class="b-costs">${[-1, 0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="cost-btn ${costFilter === n ? 'on' : ''}" data-cost="${n}">${n < 0 ? 'Any' : n >= 7 ? '7+' : n}</button>`).join('')}</span>
          <input class="b-search" placeholder="Search name or text…" value="${esc(search)}">
        </div>
        <div class="b-hint dim">Click a card to add it. Right-click (or click its row on the right) to remove. ${MAX_COPIES} copies max, ${MAX_COLORS} colors max.</div>
        <div class="b-grid">${pool.map((c) => {
          const n = count(c.id);
          const blocked = !cols.includes(c.color) && cols.length >= MAX_COLORS;
          return `<div class="b-card ${blocked ? 'blocked' : ''} ${n ? 'in' : ''}" data-id="${c.id}">${cardHTML(c)}${n ? `<span class="count">×${n}</span>` : ''}</div>`;
        }).join('')}</div>
      </div>
      <div class="panel b-deck">
        <input class="b-name" maxlength="30" value="${esc(deck.name)}">
        <div class="b-summary">
          <span class="b-total ${total === DECK_SIZE ? 'ok' : ''}">${total}/${DECK_SIZE}</span>
          <span>${cols.map((c) => `<i class="dot" style="--c:${COLOR_INFO[c].hex}"></i>`).join(' ')}</span>
          <span class="dim">${types.unit} units · ${types.spell} spells · ${types.order} orders</span>
        </div>
        <div class="b-curve">${curve.map((n, i) => `<div class="bar"><div class="fill" style="height:${(n / maxC) * 100}%"></div><span>${n || ''}</span><b>${i >= 7 ? '7+' : i}</b></div>`).join('')}</div>
        <div class="b-list">${list.map(([id, n]) => { const d = cardDef(id); return `<div class="b-row" data-id="${id}" style="--col:${COLOR_INFO[d.color].hex}"><span class="c">${d.cost}</span><span class="nm">${d.icon} ${esc(d.name)}</span><span class="n">×${n}</span></div>`; }).join('') || '<p class="dim">Your deck is empty. Click cards on the left to add them, or start from a prebuilt deck below.</p>'}</div>
        <div class="b-msg"></div>
        <div class="b-actions">
          <select class="b-template"><option value="">Start from a prebuilt deck…</option>${DECKS.map((d) => `<option value="${d.id}">${esc(d.name)} (${d.archetype})</option>`).join('')}</select>
          <div class="row">
            <button class="btn ghost small b-clear">Clear</button>
            <button class="btn ghost b-cancel">Cancel</button>
            <button class="btn b-save" ${err ? 'disabled' : ''} title="${esc(err ?? 'Save deck')}">Save Deck</button>
          </div>
          ${err && total > 0 ? `<div class="dim small-note">${esc(err)}</div>` : ''}
        </div>
      </div>`;

    root.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => (b.onclick = () => { colorFilter = b.dataset.color as Color | 'all'; render(); }));
    root.querySelectorAll<HTMLElement>('[data-cost]').forEach((b) => (b.onclick = () => { costFilter = Number(b.dataset.cost); render(); }));
    const s = root.querySelector('.b-search') as HTMLInputElement;
    s.oninput = () => { search = s.value.toLowerCase(); const pos = s.selectionStart; render(); const s2 = root.querySelector('.b-search') as HTMLInputElement; s2.focus(); s2.setSelectionRange(pos, pos); };
    root.querySelectorAll<HTMLElement>('.b-card').forEach((c) => {
      c.onclick = () => add(c.dataset.id!);
      c.oncontextmenu = (e) => { e.preventDefault(); remove(c.dataset.id!); };
    });
    root.querySelectorAll<HTMLElement>('.b-row').forEach((r) => {
      r.onclick = () => remove(r.dataset.id!);
      r.oncontextmenu = (e) => { e.preventDefault(); add(r.dataset.id!); };
    });
    (root.querySelector('.b-name') as HTMLInputElement).oninput = (e) => { deck.name = (e.target as HTMLInputElement).value || 'My Deck'; };
    (root.querySelector('.b-template') as HTMLSelectElement).onchange = (e) => {
      const d = DECKS.find((x) => x.id === (e.target as HTMLSelectElement).value);
      if (!d) return;
      deck.cards = d.cards.map(([id, n]) => [id, n]);
      deck.name = `${d.name} Remix`;
      sfx.select();
      render();
    };
    (root.querySelector('.b-clear') as HTMLElement).onclick = () => { deck.cards = []; render(); };
    (root.querySelector('.b-cancel') as HTMLElement).onclick = () => { root.remove(); done(null); };
    (root.querySelector('.b-save') as HTMLElement).onclick = () => {
      if (validateDeck(deck.cards)) return;
      upsertCustom(deck);
      sfx.select();
      root.remove();
      done(deck.id);
    };
  }
  render();
}
