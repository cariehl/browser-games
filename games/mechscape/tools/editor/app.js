// The editor's shell: the sections on the left, the entry list, the page for
// the selected entry, and Save / Check / Revert. The address bar remembers
// where you are (#items/alloy_blade), so reloading keeps your place.

import { Store } from './store.js';
import { COLLECTIONS, LAYOUT, loadDocs, defaultsOf, nameOf, findRefs, collectionOf } from './schema.js';
import { objectFields, refreshDatalists } from './forms.js';
import { el, button, cssColor, toast } from './ui.js';
import { questView } from './quest_view.js';
import { dialogueView } from './dialogue_view.js';
import { messagesView } from './messages_view.js';
import { mapView } from './map_view.js';

const nav = document.getElementById('nav');
const list = document.getElementById('list');
const main = document.getElementById('main');
const status = document.getElementById('status');
const problemsBox = document.getElementById('problems');

/** The sections, in the order they're listed. */
const SECTIONS = [
  { group: 'World' },
  { id: 'maps', title: 'Maps' },
  { id: 'world', title: 'Areas and links', file: LAYOUT },
  { group: 'Story' },
  { id: 'quests', title: 'Quests' },
  { id: 'dialogue', title: 'Dialogue' },
  { id: 'text', title: 'Messages', file: 'data/text.json' },
  { group: 'Things' },
  { id: 'items', title: 'Items' },
  { id: 'npcs', title: 'NPCs and pets' },
  { id: 'nodes', title: 'Gather nodes' },
  { id: 'recipes', title: 'Recipes' },
  { id: 'stations', title: 'Stations' },
  { id: 'loot_tables', title: 'Loot tables' },
  { id: 'mechs', title: 'Mechs' },
  { group: 'Rules' },
  { id: 'skills', title: 'Skills' },
  { id: 'weapon_types', title: 'Weapon types' },
  { id: 'rules', title: 'Game rules', file: 'data/rules.json' },
  { group: 'Scenery' },
  { id: 'terrain', title: 'Terrain' },
  { id: 'decor', title: 'Decor' },
  { id: 'ground', title: 'Ground' },
];

const state = { section: 'items', entry: null, filter: '' };

function fileOf(section) {
  const s = SECTIONS.find((x) => x.id === section);
  return s && s.file ? s.file : COLLECTIONS[section] ? COLLECTIONS[section].file : null;
}

function go(section, entry = null) {
  location.hash = entry ? `${section}/${encodeURIComponent(entry)}` : section;
}

function route() {
  const hash = location.hash.slice(1);
  const cut = hash.indexOf('/');
  const [section, entry] = cut < 0 ? [hash, ''] : [hash.slice(0, cut), hash.slice(cut + 1)];
  state.section = SECTIONS.some((s) => s.id === section) ? section : 'items';
  state.entry = entry ? decodeURIComponent(entry) : null;
  render();
}

function render() {
  drawNav();
  drawList();
  drawMain();
}

function drawNav() {
  nav.innerHTML = '';
  for (const s of SECTIONS) {
    if (s.group) {
      el('div', 'group', s.group, nav);
      continue;
    }
    const a = el('a', s.id === state.section ? 'active' : '', s.title, nav);
    const file = fileOf(s.id);
    const dirty = s.id === 'maps' ? Store.dirtyPaths().some((p) => p.endsWith('.map')) : file && Store.isDirty(file);
    if (dirty) el('span', 'dirty', ' •', a);
    a.addEventListener('click', () => go(s.id));
  }
}

function drawList() {
  const coll = COLLECTIONS[state.section] ? state.section : null;
  list.hidden = !coll;
  if (!coll) return;
  list.innerHTML = '';
  const tools = el('div', 'tools', '', list);
  const search = el('input', '', '', tools);
  search.placeholder = 'Search';
  search.value = state.filter;
  button('+ New', tools, () => newEntry(coll));
  const entries = el('div', 'entries', '', list);
  const data = Store.data(COLLECTIONS[coll].file) || {};
  const fill = () => {
    entries.innerHTML = '';
    const q = state.filter.toLowerCase();
    const ids = Object.keys(data).sort((a, b) => nameOf(coll, a).localeCompare(nameOf(coll, b)));
    for (const id of ids) {
      const name = nameOf(coll, id);
      if (q && !name.toLowerCase().includes(q) && !id.includes(q)) continue;
      const row = el('div', id === state.entry ? 'entry active' : 'entry', '', entries);
      const entry = data[id];
      const color = entry.color || (coll === 'recipes' && (Store.data(COLLECTIONS.items.file)[entry.output] || {}).color);
      if (color) el('span', 'swatch', '', row).style.background = cssColor(color);
      el('span', '', name || '(no name)', row);
      if (name !== id) el('span', 'id', id, row);
      row.addEventListener('click', () => go(coll, id));
    }
  };
  search.addEventListener('input', () => {
    state.filter = search.value;
    fill();
  });
  fill();
}

function drawMain() {
  main.innerHTML = '';
  main.classList.toggle('map-mode', state.section === 'maps');
  refreshDatalists();
  const section = state.section;
  if (section === 'maps') return mapView(main, state.entry, (path) => go('maps', path));
  if (section === 'text') return messagesView(main);
  if (section === 'rules' || section === 'world') {
    const file = fileOf(section);
    el('h2', '', SECTIONS.find((s) => s.id === section).title, main);
    el('div', 'subtitle', section === 'rules'
      ? 'Tuning numbers the code reads (data/rules.json). Ticks are 0.6 s.'
      : 'Which maps make up the world, where each sits, and the links between them (data/maps/world.json). Paint the maps themselves under Maps.', main);
    const form = el('div', 'form', '', main);
    objectFields(form, Store.data(file), { file, path: [], fixed: section === 'rules', rerender: () => {} });
    return;
  }
  const coll = section;
  const data = Store.data(COLLECTIONS[coll].file) || {};
  if (!state.entry || !data[state.entry]) {
    el('h2', '', COLLECTIONS[coll].title, main);
    el('div', 'subtitle', `${Object.keys(data).length} in ${COLLECTIONS[coll].file}. Pick one on the left, or make a new one.`, main);
    return;
  }
  const id = state.entry;
  const entry = data[id];
  el('h2', '', nameOf(coll, id) || id, main);
  const bar = el('div', 'toolbar', '', main);
  el('span', 'muted', `id: ${id}`, bar);
  button('Rename id', bar, () => renameEntry(coll, id));
  button('Duplicate', bar, () => duplicateEntry(coll, id));
  button('Delete', bar, () => deleteEntry(coll, id), 'small danger');
  if (coll === 'quests') questView(main, coll, id, entry);
  else if (coll === 'dialogue') dialogueView(main, id, entry);
  else {
    const form = el('div', 'form', '', main);
    const changed = () => {
      main.querySelector('h2').textContent = nameOf(coll, id) || id;
      drawNavDirty();
    };
    objectFields(form, entry, {
      file: COLLECTIONS[coll].file, coll, path: [id], defaults: defaultsOf(coll), rerender: () => {}, changed,
    });
  }
  usedBy(main, coll, id);
}

function drawNavDirty() {
  const active = nav.querySelector('a.active');
  if (active && !active.querySelector('.dirty')) el('span', 'dirty', ' •', active);
}

function usedBy(parent, coll, id) {
  const refs = findRefs(coll, id);
  const box = el('div', 'usedby', '', parent);
  el('h3', '', `Used by (${refs.length})`, box);
  if (!refs.length) el('div', 'muted', 'Nothing refers to this yet.', box);
  for (const r of refs) {
    const line = el('div', 'small', '', box);
    const target = collectionOf(r.file);
    if (target && r.entry) {
      const a = el('a', '', `${nameOf(target, r.entry)}`, line);
      a.addEventListener('click', () => go(target, r.entry));
      el('span', 'muted', ` · ${COLLECTIONS[target].title.toLowerCase()} · ${r.where.split('.').slice(1).join('.')}`, line);
    } else if (r.file.endsWith('.map')) {
      const a = el('a', '', r.file.replace('data/maps/', ''), line);
      a.addEventListener('click', () => go('maps', r.file));
      el('span', 'muted', ' · map legend', line);
    } else {
      el('span', '', r.file.replace('data/', ''), line);
      el('span', 'muted', ` · ${r.where}`, line);
    }
  }
}

function askId(question, initial = '') {
  const id = prompt(question, initial);
  if (id == null) return null;
  const clean = id.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(clean)) {
    alert('Ids are lower case letters, digits and underscores, starting with a letter (like "rusty_blade").');
    return null;
  }
  return clean;
}

function newEntry(coll) {
  const data = Store.data(COLLECTIONS[coll].file);
  const id = askId(`New ${COLLECTIONS[coll].title.toLowerCase()} id:`);
  if (!id) return;
  if (data[id]) return alert(`There's already one called "${id}".`);
  const fresh = { id };
  const defaults = defaultsOf(coll);
  if ('display_name' in defaults) fresh.display_name = id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (coll === 'quests') Object.assign(fresh, { description: '', stages: [{ id: 'start', journal: '', goal: { type: 'talk' } }], rewards: { xp: {}, items: [] } });
  if (coll === 'dialogue') fresh.entries = [{ lines: [{ who: 'npc', text: '' }] }];
  if (coll === 'recipes') Object.assign(fresh, { inputs: [{ item: '', count: 1 }], output: '' });
  data[id] = fresh;
  Store.touch(COLLECTIONS[coll].file);
  go(coll, id);
}

function duplicateEntry(coll, id) {
  const data = Store.data(COLLECTIONS[coll].file);
  const copy = askId('Id for the copy:', `${id}_copy`);
  if (!copy) return;
  if (data[copy]) return alert(`There's already one called "${copy}".`);
  data[copy] = { ...JSON.parse(JSON.stringify(data[id])), id: copy };
  Store.touch(COLLECTIONS[coll].file);
  go(coll, copy);
}

/** Renames an entry, keeping its place in the file, and (if asked) everything that uses it. */
function renameEntry(coll, id) {
  const file = COLLECTIONS[coll].file;
  const data = Store.data(file);
  const next = askId(`Rename "${id}" to:`, id);
  if (!next || next === id) return;
  if (data[next]) return alert(`There's already one called "${next}".`);
  const refs = findRefs(coll, id);
  const update = refs.length ? confirm(`${refs.length} place(s) use "${id}". Update them to "${next}" too?\n\n(Old saves keep the old id, so a renamed item vanishes from them.)`) : false;
  const entries = Object.entries(data);
  for (const key of Object.keys(data)) delete data[key];
  for (const [k, v] of entries) data[k === id ? next : k] = k === id ? { ...v, id: next } : v;
  if (update) for (const r of refs) r.replace(next);
  Store.touch(file);
  go(coll, next);
}

function deleteEntry(coll, id) {
  const refs = findRefs(coll, id);
  const warning = refs.length ? `\n\n${refs.length} place(s) still use it, and the game won't load until they're changed.` : '';
  if (!confirm(`Delete "${nameOf(coll, id)}" (${id})?${warning}`)) return;
  delete Store.data(COLLECTIONS[coll].file)[id];
  Store.touch(COLLECTIONS[coll].file);
  go(coll);
}

async function save() {
  if (!Store.dirtyPaths().length) return toast('Nothing to save.');
  try {
    const saved = await Store.saveAll();
    toast(`Saved ${saved.map((p) => p.replace('data/', '')).join(', ')}`);
    await check();
  } catch (error) {
    alert(`Couldn't save: ${error.message}`);
  }
}

async function check() {
  status.textContent = 'Checking...';
  const problems = await (await fetch('/api/check', { method: 'POST' })).json();
  status.textContent = problems.length ? '' : 'All checks pass.';
  showProblems(problems);
}

function showProblems(problems) {
  problemsBox.innerHTML = '';
  problemsBox.hidden = !problems.length;
  if (!problems.length) return;
  const head = el('div', 'head', '', problemsBox);
  el('span', 'bad-text grow', `${problems.length} problem${problems.length === 1 ? '' : 's'} in the saved files`, head);
  button('Close', head, () => (problemsBox.hidden = true));
  for (const p of problems) {
    const line = el('div', 'p', '', problemsBox);
    el('b', '', p.check, line);
    el('span', '', p.text, line);
  }
}

function updateStatus() {
  drawNav();
  const dirty = Store.dirtyPaths();
  document.getElementById('save').disabled = !dirty.length;
  document.title = `${dirty.length ? '• ' : ''}MechScape Content Editor`;
  if (dirty.length) status.textContent = `Unsaved: ${dirty.map((p) => p.replace(/^data\/(maps\/)?/, '')).join(', ')}`;
  else if (status.textContent.startsWith('Unsaved')) status.textContent = 'Saved.';
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('check').addEventListener('click', check);
document.getElementById('revert').addEventListener('click', async () => {
  if (Store.dirtyPaths().length && !confirm('Throw away every unsaved change?')) return;
  await Store.load();
  render();
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (Store.dirtyPaths().length) e.preventDefault();
});
window.addEventListener('hashchange', route);
Store.onChange(updateStatus);

await loadDocs();
await Store.load();
route();
window.editor = { Store, go };
