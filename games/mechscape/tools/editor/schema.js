// What the editor knows about the data: which file holds what, each field's
// default and doc comment (read straight from src/sim/defs.js, so they never
// drift), which fields name other content (refs), and where any id is used.

import * as Defs from '/src/sim/defs.js';
import { Store } from './store.js';

/** Content collections: one file each, entries keyed by id. */
export const COLLECTIONS = {
  items: { file: 'data/items.json', title: 'Items', cls: 'ItemDef' },
  npcs: { file: 'data/npcs.json', title: 'NPCs and pets', cls: 'NpcDef' },
  nodes: { file: 'data/nodes.json', title: 'Gather nodes', cls: 'GatherNodeDef' },
  recipes: { file: 'data/recipes.json', title: 'Recipes', cls: 'RecipeDef' },
  stations: { file: 'data/stations.json', title: 'Stations', cls: 'StationDef' },
  loot_tables: { file: 'data/loot_tables.json', title: 'Loot tables', cls: 'LootTableDef' },
  mechs: { file: 'data/mechs.json', title: 'Mechs', cls: 'MechDef' },
  weapon_types: { file: 'data/weapon_types.json', title: 'Weapon types', cls: 'WeaponTypeDef' },
  skills: { file: 'data/skills.json', title: 'Skills', cls: 'SkillDef' },
  terrain: { file: 'data/terrain.json', title: 'Terrain', cls: 'TerrainDef' },
  decor: { file: 'data/decor.json', title: 'Decor', cls: 'DecorDef' },
  ground: { file: 'data/ground.json', title: 'Ground', cls: 'GroundDef' },
  quests: { file: 'data/quests.json', title: 'Quests', cls: 'QuestDef' },
  dialogue: { file: 'data/dialogue.json', title: 'Dialogue', cls: 'DialogueDef' },
};

export const LAYOUT = 'data/maps/world.json';

/** The collection a data file holds, or null. */
export function collectionOf(file) {
  return Object.keys(COLLECTIONS).find((c) => COLLECTIONS[c].file === file) || null;
}

/** Ids in a collection (plus 'areas', from the world layout, and 'maps'). */
export function idsOf(coll) {
  if (coll === 'areas') return ((Store.data(LAYOUT) || {}).areas || []).map((a) => a.id);
  if (coll === 'maps') return Store.paths().filter((p) => p.endsWith('.map'));
  const info = COLLECTIONS[coll];
  return info ? Object.keys(Store.data(info.file) || {}) : [];
}

/** A readable name for an entry. */
export function nameOf(coll, id) {
  if (coll === 'areas') {
    const area = ((Store.data(LAYOUT) || {}).areas || []).find((a) => a.id === id);
    return area ? area.name || id : id;
  }
  const info = COLLECTIONS[coll];
  const entry = info && (Store.data(info.file) || {})[id];
  if (!entry) return id;
  if (coll === 'recipes') {
    const out = (Store.data(COLLECTIONS.items.file) || {})[entry.output];
    return out ? `${out.display_name}${entry.output_count > 1 ? ` ×${entry.output_count}` : ''}` : id;
  }
  if (coll === 'dialogue') {
    const npc = Object.values(Store.data(COLLECTIONS.npcs.file) || {}).find((n) => n.talk === id);
    return npc ? npc.display_name : id;
  }
  return entry.display_name || id;
}

const defaultsCache = {};
/** The defaults a def class fills in for [coll]: { field: value }. */
export function defaultsOf(coll) {
  if (!defaultsCache[coll]) {
    const cls = COLLECTIONS[coll] && Defs[COLLECTIONS[coll].cls];
    const out = {};
    if (cls) {
      const instance = new cls({});
      for (const [k, v] of Object.entries(instance)) out[k] = v;
      if ('abbreviation' in out) out.abbreviation = '';
    }
    defaultsCache[coll] = out;
  }
  return defaultsCache[coll];
}

const docs = {};
/** Reads the doc comments of each def class's fields out of defs.js. */
export async function loadDocs() {
  const source = await (await fetch('/src/sim/defs.js')).text();
  const parts = source.split(/export class (\w+)/);
  for (let i = 1; i < parts.length; i += 2) {
    const cls = parts[i];
    const body = parts[i + 1];
    const out = (docs[cls] = {});
    const comment = /(?:\/\*\*([\s\S]*?)\*\/|\/\/([^\n]*))\s*\n([^\n]*)/g;
    for (const m of body.matchAll(comment)) {
      const text = (m[1] || m[2] || '').replace(/\s*\n\s*\*?\s*/g, ' ').trim();
      for (const key of m[3].matchAll(/([a-z_]+):/g)) if (!out[key[1]]) out[key[1]] = text;
    }
  }
}

export function docOf(coll, key) {
  const info = COLLECTIONS[coll];
  return (info && docs[info.cls] && docs[info.cls][key]) || '';
}

/** Which collection a field's value names, by its key. */
const REF_BY_KEY = {
  item: 'items', items: 'items', output: 'items', loot: 'items', rare_loot: 'items', ammo: 'items', leaves: 'items',
  container: 'items', gives: 'items', blueprint: 'items', plate_item: 'items', fuel_item: 'items', ammo_item: 'items',
  repair_item: 'items', keep_on_destroy: 'items', has: 'items', take: 'items', give: 'items', grows: 'items',
  pet_npc: 'npcs', npc: 'npcs', guard: 'npcs', add: 'npcs', husk: 'nodes', talk: 'dialogue',
  quest: 'quests', start: 'quests', complete: 'quests', table: 'loot_tables', bonus_table: 'loot_tables',
  weapon_type: 'weapon_types', skill: 'skills', boost_skill: 'skills', trophy_skill: 'skills',
  recipes: 'recipes', opens: 'terrain', opens_to: 'terrain', door: 'stations', mech: 'mechs', area: 'areas',
};
/** Exceptions, by "file:key.path" (array indices left out), matching that path and everything under it. */
const REF_BY_PATH = {
  'npcs:boss.loot': 'loot_tables',
  'npcs:boss.text': null,
  'npcs:comments': null,
  'npcs:cosmetics': 'items',
  'world:areas.map': 'maps',
};
/** Arrays whose first element names something: [area, x, y], [quest, stage]. */
const HEAD_REF = { stage: 'quests', pad: 'areas', drop: 'areas', from: 'areas', to: 'areas' };

function shortFile(file) {
  return file.replace(/^data\/(maps\/)?/, '').replace(/\.json$/, '');
}

/** The collection the value at [path] (keys and indices) of [file] names, or null. */
export function refFor(file, path) {
  const keys = path.filter((k) => typeof k === 'string');
  const short = shortFile(file);
  for (let j = keys.length; j > 0; j--) {
    const p = `${short}:${keys.slice(0, j).join('.')}`;
    if (p in REF_BY_PATH) return REF_BY_PATH[p];
  }
  const last = path[path.length - 1];
  if (typeof last === 'number' && last === 0 && HEAD_REF[path[path.length - 2]]) return HEAD_REF[path[path.length - 2]];
  if (typeof last === 'number' && HEAD_REF[path[path.length - 2]]) return null;
  if (short === 'text' || short === 'rules') return null;
  return REF_BY_KEY[keys[keys.length - 1]] || null;
}

/** Calls fn(value, path, set) for every string in [value]. */
function walk(value, path, fn, set) {
  if (typeof value === 'string') fn(value, path, set);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], fn, (nv) => (value[i] = nv)));
  else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) walk(value[k], [...path, k], fn, (nv) => (value[k] = nv));
  }
}

const MAP_KIND = { terrain: 'terrain', node: 'nodes', station: 'stations', npc: 'npcs', decor: 'decor', ground: 'ground' };

/**
 * Everywhere [id] of [coll] is used: [{ file, where, replace(newId) }], over
 * every data file, text tokens ({npcs:foreman}) and map legends.
 */
export function findRefs(coll, id) {
  const out = [];
  const token = new RegExp(`\\{${shortFile(COLLECTIONS[coll] ? COLLECTIONS[coll].file : coll)}:${id}(?=[.|}])`, 'g');
  for (const file of Store.paths()) {
    if (file.endsWith('.map')) {
      const kind = Object.keys(MAP_KIND).find((k) => MAP_KIND[k] === coll);
      const line = new RegExp(`^(\\S\\s+${kind}\\s+)${id}\\s*$`, 'm');
      if (kind && line.test(Store.text(file))) {
        out.push({ file, where: 'legend', replace: (nid) => Store.setText(file, Store.text(file).replace(line, `$1${nid}`)) });
      }
      continue;
    }
    const data = Store.data(file);
    if (!data) continue;
    const own = COLLECTIONS[coll] && COLLECTIONS[coll].file === file;
    walk(data, [], (value, path, set) => {
      const top = path[0];
      if (own && top === id && (path.length === 1 || path[1] === 'id')) return;
      const inPath = typeof top === 'string' && collectionOf(file) ? path.slice(1) : path;
      if (value === id && refFor(file, inPath) === coll) {
        out.push({ file, entry: collectionOf(file) ? top : null, where: path.join('.'), replace: (nid) => { set(nid); Store.touch(file); } });
      } else if (token.test(value)) {
        token.lastIndex = 0;
        out.push({ file, entry: collectionOf(file) ? top : null, where: `${path.join('.')} (text)`, replace: (nid) => { set(value.replace(token, `{${shortFile(COLLECTIONS[coll].file)}:${nid}`)); Store.touch(file); } });
      }
      token.lastIndex = 0;
    }, null);
  }
  return out;
}

/** Fills text tokens the way the game will (sim/text.js), from the data being edited. */
export function fill(template, vars = {}) {
  if (!template || !template.includes('{')) return template;
  return template.replace(/\{([a-z_]+)(?::([a-z0-9_.]+))?(\|lower)?\}/gi, (whole, head, path, lower) => {
    let value;
    if (path == null) value = vars[head] ?? `‹${head}›`;
    else {
      const parts = path.split('.');
      if (head === 'area') value = idsOf('areas').includes(parts[0]) ? nameOf('areas', parts[0]) : null;
      else {
        value = Store.data(head === 'rules' ? 'data/rules.json' : `data/${head}.json`);
        for (const part of parts) value = value && typeof value === 'object' ? value[part] : null;
      }
    }
    if (value == null) return `⚠${whole}`;
    const text = typeof value === 'object' && 'display_name' in value ? value.display_name : String(value);
    return lower ? text.toLowerCase() : text;
  });
}
