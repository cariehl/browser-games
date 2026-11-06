// The damage meter: damage or healing per raider, and per second, for the
// current fight, built from the 'hit' messages every client receives. A
// fight starts with the first hit after FIGHT_GAP seconds of quiet. Hover a
// row for its breakdown by ability.

import { ABILITIES } from '../../shared/classes.js';
import { roleCss } from '../../shared/roles.js';
import { el } from '../dom.js';

/** Seconds without a hit that end a fight; the next hit starts a new one. */
const FIGHT_GAP = 5;

const ABILITY_NAMES = { attack: 'Auto Attack' };

function short(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export class Meter {
  mode = 'damage';

  constructor() {
    this.root = el('div', 'meter');
    const head = el('div', 'meter-head');
    this.tabs = ['damage', 'healing'].map((mode) => {
      const tab = el('button', 'meter-tab', mode === 'damage' ? 'Damage' : 'Healing');
      tab.onclick = () => {
        this.mode = mode;
        this.render();
      };
      return tab;
    });
    this.clock = el('span', 'meter-time muted small');
    const reset = el('button', 'meter-tab', 'Reset');
    reset.title = 'Start a fresh fight';
    reset.onclick = () => this.reset();
    head.append(...this.tabs, this.clock, reset);
    this.rows = el('div', 'meter-rows');
    this.root.append(head, this.rows);
    this.reset();
  }

  reset() {
    /** By raider id: { name, role, damage, healing, abilities: { damage: {id: n}, healing: {id: n} } }. */
    this.totals = new Map();
    this.start = 0;
    this.last = -Infinity;
    this.render();
  }

  /** Counts a 'hit' message. [raiders]: the synced raiders, for names and roles. */
  add(hit, raiders) {
    const source = raiders.get(hit.source);
    if (!source || hit.amount <= 0) return;
    const now = performance.now() / 1000;
    if (now - this.last > FIGHT_GAP) {
      this.totals = new Map();
      this.start = now;
    }
    this.last = now;
    let row = this.totals.get(hit.source);
    if (!row) {
      row = { name: source.name, role: source.role, damage: 0, healing: 0, abilities: { damage: {}, healing: {} } };
      this.totals.set(hit.source, row);
    }
    const kind = hit.heal ? 'healing' : 'damage';
    row[kind] += hit.amount;
    row.abilities[kind][hit.ability] = (row.abilities[kind][hit.ability] ?? 0) + hit.amount;
  }

  /** The fight's length so far in seconds (frozen once it's over). */
  elapsed() {
    if (!this.totals.size) return 0;
    const now = performance.now() / 1000;
    const end = now - this.last > FIGHT_GAP ? this.last : now;
    return Math.max(1, end - this.start);
  }

  render() {
    for (const [i, tab] of this.tabs.entries()) tab.classList.toggle('on', ['damage', 'healing'][i] === this.mode);
    const seconds = this.elapsed();
    this.clock.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '';
    const rows = [...this.totals.values()].filter((r) => r[this.mode] > 0).sort((a, b) => b[this.mode] - a[this.mode]);
    const top = rows[0]?.[this.mode] ?? 1;
    const key = rows.map((r) => `${r.name}${Math.round(r[this.mode])}`).join() + seconds.toFixed(0);
    if (key === this.key) return;
    this.key = key;
    if (!rows.length) {
      this.rows.replaceChildren(el('div', 'muted small meter-empty', this.mode === 'damage' ? 'No damage yet.' : 'No healing yet.'));
      return;
    }
    this.rows.replaceChildren(...rows.map((r, i) => {
      const amount = r[this.mode];
      const row = el('div', 'meter-row');
      const bar = el('div', 'meter-bar');
      bar.style.width = `${(amount / top) * 100}%`;
      bar.style.background = roleCss(r.role);
      row.append(bar, el('span', 'meter-name', `${i + 1}. ${r.name}`), el('span', 'meter-num', `${short(amount)} (${short(amount / seconds)})`));
      row.title = Object.entries(r.abilities[this.mode])
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${ABILITIES[id]?.name ?? ABILITY_NAMES[id] ?? id}: ${short(n)} (${Math.round((n / amount) * 100)}%)`)
        .join('\n');
      return row;
    }));
  }
}
