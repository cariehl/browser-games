// Checks the game's text: every message key the code asks for is in
// data/text.json (and every boss line in each boss's script), and every
// token in the data ({npcs:foreman}, {area:undercroft}...) names something
// that exists. Run it after renaming or deleting content.
//
//   node tools/check_text.js      (or npm run check-text)
//
// Exits with code 1 (and lists each problem) if anything is missing.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContentFromDisk, ROOT } from '../src/sim/load_node.js';
import { Content, CONTENT_FILES } from '../src/sim/defs.js';
import { Text } from '../src/sim/text.js';
import { DEFAULT_MAP } from '../src/sim/world.js';

const TOKEN = /\{([a-z_]+):([a-z0-9_.]+)(\|lower)?\}/gi;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Every string in [value], with where it is. */
function* strings(value, where) {
  if (typeof value === 'string') yield [value, where];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${where}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, `${where}.${k}`);
}

export function checkText() {
  loadContentFromDisk();
  const layout = JSON.parse(readFileSync(join(ROOT, DEFAULT_MAP), 'utf8'));
  for (const area of layout.areas) Text.areas[area.id] ??= area.name || area.id;
  const problems = [];

  const bosses = Object.values(Content.npcs).filter((n) => n.boss);
  for (const file of [...sourceFiles('src'), ...sourceFiles('server')]) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    for (const m of code.matchAll(/Text\.get\('([^']+)'/g)) {
      if (!(m[1] in Content.text)) problems.push(`${file}: message "${m[1]}" isn't in data/text.json.`);
    }
    for (const m of code.matchAll(/bossText\([^,]+,\s*(?:[^'),]*\?\s*)?'([^']+)'(?:\s*:\s*'([^']+)')?/g)) {
      for (const key of [m[1], m[2]].filter(Boolean)) {
        for (const boss of bosses) {
          if (!(key in (boss.boss.text || {}))) problems.push(`${file}: boss line "${key}" isn't in ${boss.id}'s "text" (data/npcs.json).`);
        }
      }
    }
  }

  for (const file of Object.values(CONTENT_FILES)) {
    const data = JSON.parse(readFileSync(join(ROOT, 'data', `${file}.json`), 'utf8'));
    for (const [text, where] of strings(data, file)) {
      for (const m of text.matchAll(TOKEN)) {
        if (Text.lookup(m[1], m[2]) == null) problems.push(`data/${where}: ${m[0]} doesn't name anything.`);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkText();
  for (const p of problems) console.log(p);
  console.log(problems.length ? `${problems.length} problem(s).` : 'All text checks out.');
  process.exit(problems.length ? 1 : 0);
}
