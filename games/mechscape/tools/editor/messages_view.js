// Messages (data/text.json): the lines the game sends that name people,
// places and things. Each shows the values the game fills in ({player},
// {mech}...) and how it reads with the current data.

import { Store } from './store.js';
import { fill } from './schema.js';
import { el } from './ui.js';

const FILE = 'data/text.json';

const GROUPS = {
  death: 'Dying and being reprinted', reconfigure: 'The manufactory', mech: 'The mech', hab: 'The hab', survey: 'The survey',
};

export function messagesView(main) {
  const data = Store.data(FILE) || {};
  el('h2', '', 'Messages', main);
  el('div', 'subtitle', 'Chat-box lines the game sends. {name} is filled in by the game; {npcs:foreman}, {stations:manufactory|lower}, {area:deadfields} and {rules:hab.rested_comfort} come from the data, so renaming something updates every message. A boss\'s lines are in its script, under NPCs.', main);
  const search = el('input', '', '', main);
  search.placeholder = 'Search messages';
  search.style.width = '320px';
  const box = el('div', 'form', '', main);
  let saved = {};
  try {
    saved = JSON.parse(Store.text(FILE));
  } catch {
    saved = {};
  }
  const draw = () => {
    box.innerHTML = '';
    const q = search.value.toLowerCase();
    let group = null;
    for (const key of Object.keys(data)) {
      if (q && !key.includes(q) && !data[key].toLowerCase().includes(q)) continue;
      const g = key.split('.')[0];
      if (g !== group) {
        group = g;
        el('h3', '', GROUPS[g] || g, box);
      }
      const row = el('div', 'field', '', box);
      const label = el('div', 'label', '', row);
      el('div', 'name', key.split('.').slice(1).join('.').replace(/_/g, ' '), label);
      const vars = [...new Set([...(saved[key] || data[key]).matchAll(/\{([a-z_]+)(?:\|lower)?\}/g)].map((m) => m[1]))];
      if (vars.length) el('div', 'doc', `Filled in: ${vars.map((v) => `{${v}}`).join(' ')}`, label);
      const value = el('div', 'value', '', row);
      const area = el('textarea', '', '', value);
      area.value = data[key];
      area.rows = 2;
      const preview = el('div', 'preview', '', value);
      const show = () => (preview.textContent = `Reads: ${fill(area.value)}`);
      show();
      area.addEventListener('input', () => {
        data[key] = area.value;
        show();
        Store.touch(FILE);
      });
    }
  };
  search.addEventListener('input', draw);
  draw();
}
