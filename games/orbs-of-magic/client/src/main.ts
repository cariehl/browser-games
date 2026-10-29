import './style.css';
import type { Room } from 'colyseus.js';
import { ALL_CARDS, COLOR_INFO, cardDef } from '../../shared/cards';
import { DECKS } from '../../shared/decks';
import type { Color } from '../../shared/types';
import { sfx } from './audio';
import { cardHTML, esc } from './cardview';
import { openDeckBuilder } from './deckbuilder';
import { allDecks, deckOptions, deleteCustom, findDeck } from './deckstore';
import { GameController, HELP_HTML } from './game';
import { music, renderOffline } from './music';
import { client } from './net';
import { BoardScene } from './scene';

const ui = document.getElementById('ui')!;
const scene = new BoardScene(document.getElementById('scene') as HTMLCanvasElement);
let current: GameController | null = null;

const store = {
  get(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const WIZARD_NAMES = ['Arcanist', 'Spellwright', 'Orbkeeper', 'Starweaver', 'Runesmith', 'Hexblade', 'Mistcaller', 'Emberheart'];
let playerName = store.get('oom-name', `${WIZARD_NAMES[Math.floor(Math.random() * WIZARD_NAMES.length)]}${Math.floor(Math.random() * 90 + 10)}`);
let deckId = store.get('oom-deck', DECKS[0].id);
let aiDeck = store.get('oom-aideck', 'random');

function colorDots(colors: Color[]) {
  return colors.map((c) => `<i class="dot" style="--c:${COLOR_INFO[c].hex}" title="${COLOR_INFO[c].name}"></i>`).join('');
}

function menu() {
  scene.setMenuMode(true);
  music.play('menu');
  const decks = allDecks();
  const sel = findDeck(deckId);
  deckId = sel.id;
  const deckTiles = decks.map((d) => `
    <button class="deck-tile ${d.id === deckId ? 'sel' : ''} ${d.custom ? 'custom' : ''}" data-id="${d.id}" style="--c1:${COLOR_INFO[d.colors[0] ?? 'neutral'].hex};--c2:${COLOR_INFO[d.colors[d.colors.length - 1] ?? 'neutral'].hex}">
      <span class="deck-icon">${d.icon}</span>
      <span class="deck-name">${esc(d.name)}</span>
      <span class="deck-arch">${colorDots(d.colors)} ${esc(d.archetype)}</span>
    </button>`).join('') + `<button class="deck-tile new-deck"><span class="deck-icon">＋</span><span class="deck-name">New Deck</span><span class="deck-arch">Deck builder</span></button>`;
  ui.innerHTML = `
  <div class="menu">
    <div class="title"><h1>Orbs <span>of</span> Magic</h1><div class="subtitle">A tactical card battle for the five Orbs</div></div>
    <div class="menu-body">
      <div class="panel deck-picker">
        <div class="row name-row"><label>Wizard name <input class="name-input" maxlength="20" value="${esc(playerName)}"></label></div>
        <h3>Choose your deck</h3>
        <div class="deck-grid">${deckTiles}</div>
        <div class="deck-detail">
          <div class="dd-head"><b>${esc(sel.name)}</b> <span class="tag">${esc(sel.archetype)}</span> ${colorDots(sel.colors)}</div>
          <p>${esc(sel.blurb)}</p>
          <p class="dim">${esc(sel.howToPlay)}</p>
          <div class="row left">
            <button class="btn ghost small btn-view-deck">View decklist</button>
            <button class="btn ghost small btn-edit-deck">${sel.custom ? 'Edit deck' : 'Copy &amp; edit'}</button>
            ${sel.custom ? '<button class="btn ghost small btn-del-deck">Delete</button>' : ''}
          </div>
        </div>
      </div>
      <div class="panel play-panel">
        <h3>Play</h3>
        <button class="btn big btn-ai">🤖 Battle the AI</button>
        <label class="ai-deck">AI deck <select class="ai-deck-sel"><option value="random">Random</option>${DECKS.map((d) => `<option value="${d.id}" ${aiDeck === d.id ? 'selected' : ''}>${esc(d.name)} (${d.archetype})</option>`).join('')}</select></label>
        <div class="sep">Online</div>
        <button class="btn big btn-quick">⚡ Quick Match</button>
        <button class="btn btn-private">🔒 Create Private Match</button>
        <div class="join-row"><input class="code-input" placeholder="Match code"><button class="btn btn-join">Join</button></div>
        <div class="sep">Learn</div>
        <div class="row"><button class="btn ghost btn-howto">How to Play</button><button class="btn ghost btn-library">Card Library</button><button class="btn ghost btn-orbs">The Five Orbs</button><button class="btn ghost btn-music-menu">🎵 Music: ${music.isOn() ? 'On' : 'Off'}</button></div>
        <div class="status dim"></div>
      </div>
    </div>
    <div class="modal hidden"></div>
  </div>`;

  const q = <T extends HTMLElement>(s: string) => ui.querySelector(s) as T;
  q<HTMLInputElement>('.name-input').oninput = (e) => { playerName = (e.target as HTMLInputElement).value.trim() || 'Wizard'; store.set('oom-name', playerName); };
  ui.querySelectorAll<HTMLElement>('.deck-tile[data-id]').forEach((b) => (b.onclick = () => { deckId = b.dataset.id!; store.set('oom-deck', deckId); sfx.click(); menu(); }));
  const afterBuild = (id: string | null) => { if (id) { deckId = id; store.set('oom-deck', id); } menu(); };
  q('.new-deck').onclick = () => openDeckBuilder(ui, null, afterBuild);
  q('.btn-edit-deck').onclick = () => openDeckBuilder(ui, sel.custom ? { id: sel.id, name: sel.name, cards: sel.cards } : { id: `custom_${Date.now()}`, name: `${sel.name} Remix`, cards: sel.cards.map(([c, n]) => [c, n]) }, afterBuild);
  const del = ui.querySelector('.btn-del-deck') as HTMLElement | null;
  if (del) del.onclick = () => { if (confirm(`Delete "${sel.name}"?`)) { deleteCustom(sel.id); deckId = DECKS[0].id; store.set('oom-deck', deckId); menu(); } };
  q<HTMLSelectElement>('.ai-deck-sel').onchange = (e) => { aiDeck = (e.target as HTMLSelectElement).value; store.set('oom-aideck', aiDeck); };
  const dopts = deckOptions(deckId);
  q('.btn-ai').onclick = () => start(() => client.create('duel', { name: playerName, ...dopts, vsAI: true, aiDeckId: aiDeck === 'random' ? undefined : aiDeck }));
  q('.btn-quick').onclick = () => start(() => client.joinOrCreate('duel', { name: playerName, ...dopts }));
  q('.btn-private').onclick = () => start(() => client.create('duel', { name: playerName, ...dopts, private: true }));
  q('.btn-join').onclick = () => {
    const code = q<HTMLInputElement>('.code-input').value.trim();
    if (!code) return;
    start(() => client.joinById(code, { name: playerName, ...dopts }));
  };
  q('.btn-howto').onclick = () => modal(`<div class="help">${HELP_HTML}</div>`);
  q('.btn-library').onclick = () => library('all');
  q('.btn-orbs').onclick = () => orbs();
  q('.btn-music-menu').onclick = (e) => { (e.target as HTMLElement).textContent = `🎵 Music: ${music.toggle() ? 'On' : 'Off'}`; };
  q('.btn-view-deck').onclick = () => deckList(sel.id);
}

function modal(html: string) {
  const m = ui.querySelector('.modal') as HTMLElement;
  m.innerHTML = `<div class="panel modal-panel"><button class="close">✕</button>${html}</div>`;
  m.classList.remove('hidden');
  (m.querySelector('.close') as HTMLElement).onclick = () => m.classList.add('hidden');
  m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
  return m;
}

function library(filter: Color | 'all') {
  const colors: (Color | 'all')[] = ['all', 'ember', 'tide', 'grove', 'dawn', 'dusk'];
  const sortKey = (c: (typeof ALL_CARDS)[number]) => (c.levelOf ? cardDef(c.levelOf).cost + 0.5 : c.cost);
  const cards = ALL_CARDS.filter((c) => (!c.token || c.levelOf) && (filter === 'all' || c.color === filter)).sort((a, b) => sortKey(a) - sortKey(b) || (a.levelOf ?? a.id).localeCompare(b.levelOf ?? b.id) || (a.levelOf ? 1 : -1));
  const m = modal(`<h2>Card Library</h2>
    <div class="filters">${colors.map((c) => `<button class="btn small ${c === filter ? '' : 'ghost'}" data-c="${c}">${c === 'all' ? 'All' : COLOR_INFO[c].name}</button>`).join('')}</div>
    <div class="card-grid">${cards.map((c) => cardHTML(c)).join('')}</div>`);
  m.querySelectorAll<HTMLElement>('.filters button').forEach((b) => (b.onclick = () => library(b.dataset.c as Color | 'all')));
}

function deckList(id: string) {
  const d = findDeck(id);
  const cards = d.cards.map(([cid, n]) => ({ c: cardDef(cid), n })).sort((a, b) => a.c.cost - b.c.cost);
  modal(`<h2>${esc(d.name)} <span class="tag">${esc(d.archetype)}</span></h2><p>${esc(d.howToPlay)}</p>
    <div class="card-grid">${cards.map(({ c, n }) => `<div class="deck-card">${cardHTML(c)}<span class="count">×${n}</span></div>`).join('')}</div>`);
}

function orbs() {
  const order: Color[] = ['ember', 'tide', 'grove', 'dawn', 'dusk'];
  modal(`<h2>The Five Orbs</h2><p class="dim">Long ago the world's magic was split into five Orbs. Every wizard draws on one or two of them, and each Orb shapes how its followers fight.</p>
    <div class="orb-list">${order.map((c) => {
      const i = COLOR_INFO[c];
      const decks = DECKS.filter((d) => d.colors.includes(c)).map((d) => d.name).join(', ');
      return `<div class="orb-row" style="--c:${i.hex}"><div class="orb-ball"></div><div><h3>${i.name} <span class="dim">· ${i.orb}</span></h3><p><b>${esc(i.ideals)}</b> ${esc(i.style)}</p><p class="dim">Decks: ${esc(decks)}</p></div></div>`;
    }).join('')}</div>`);
}

async function start(join: () => Promise<Room>) {
  const status = ui.querySelector('.status') as HTMLElement | null;
  if (status) status.textContent = 'Connecting…';
  sfx.select();
  try {
    const room = await join();
    launch(room);
  } catch (e) {
    console.error(e);
    if (status) status.textContent = `Couldn't connect: ${(e as Error).message ?? e}`;
    sfx.error();
  }
}

function launch(room: Room) {
  current?.dispose();
  current = new GameController(room, scene, ui, () => { current = null; menu(); }, () => deckId);
}

// Browsers only start audio after a click or key press.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => music.unlock(), { capture: true });

async function boot() {
  let token: string | null = null;
  try { token = sessionStorage.getItem('oom-reconnect'); } catch { /* ignore */ }
  if (token) {
    try { const room = await client.reconnect(token); launch(room); return; } catch { try { sessionStorage.removeItem('oom-reconnect'); } catch { /* ignore */ } }
  }
  menu();
}
boot();

// Handy for debugging in the console.
(window as unknown as { oom: unknown }).oom = { scene, cardDef, music, renderOffline, get game() { return current; } };
