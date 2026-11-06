// Game text kept in data/text.json: the messages that name a person, place
// or thing, or set the scene, so they can be rewritten (and things renamed)
// without touching code. Text.get('mech.deployed', { mech }) fills one in.
//
// Tokens in a template:
//   {name}                    a value the code passes in (the editor lists
//                             the ones each message has)
//   {npcs:foreman}            a def's display_name, by data file and id
//   {npcs:foreman.talk}       any field of it
//   {area:deadfields}         an area's name (data/maps/world.json)
//   {rules:hab.rested_comfort}  a number from data/rules.json
//   {...|lower}               lower-cased ("The {mech|lower} is complete!")
//
// Dialogue lines and choices, quest journals and skill guide text can use
// the same tokens.

import { Content, CONTENT_FILES } from './defs.js';

/** Data file name -> Content kind ("loot_tables" -> "lootTables"). */
const KIND_FOR_FILE = Object.fromEntries(Object.entries(CONTENT_FILES).map(([kind, file]) => [file, kind]));
const TOKEN = /\{([a-z_]+)(?::([a-z0-9_.]+))?(\|lower)?\}/gi;

export const Text = {
  /** Area id -> name, filled in by each World from its layout. */
  areas: {},

  /** The template at [key], filled in. Missing keys come back as the key, so they're easy to spot. */
  get(key, vars = {}) {
    const template = Content.text[key];
    return template == null ? key : Text.fill(template, vars);
  },

  /** Fills in the tokens of [template]. Unknown ones are left as they are. */
  fill(template, vars = {}) {
    if (!template || !template.includes('{')) return template;
    return template.replace(TOKEN, (whole, head, path, lower) => {
      const value = path == null ? vars[head] : Text.lookup(head, path);
      if (value == null) return whole;
      const text = typeof value === 'object' && 'display_name' in value ? value.display_name : String(value);
      return lower ? text.toLowerCase() : text;
    });
  },

  /** What {[file]:[path]} names, or null. */
  lookup(file, path) {
    const parts = path.split('.');
    if (file === 'area') return Text.areas[parts[0]] ?? null;
    let value = file === 'rules' ? Content.rules : Content[KIND_FOR_FILE[file]];
    for (const part of parts) {
      if (value == null || typeof value !== 'object') return null;
      value = value[part];
    }
    return value ?? null;
  },

  /** "a, b and c". */
  list(names) {
    return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  },
};
