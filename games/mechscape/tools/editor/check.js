// Runs every content check and prints the problems as JSON, for the editor's
// Check button (a fresh process each time, so it reads the files as saved):
// content that won't load (an id that names nothing), maps that won't
// parse, missing messages and tokens, production loops that skip combat,
// and anything walled off from spawn.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadContentFromDisk } from '../../src/sim/load_node.js';
import { MapData } from '../../src/sim/map_data.js';
import { DEFAULT_MAP } from '../../src/sim/world.js';

const problems = [];
const add = (check, text) => problems.push({ check, text });

try {
  loadContentFromDisk();
} catch (error) {
  add('Content', error.message);
}

if (!problems.length) {
  const layout = JSON.parse(readFileSync(join(ROOT, DEFAULT_MAP), 'utf8'));
  for (const area of layout.areas) {
    const map = MapData.parse(MapData.source(area.map) ?? '', area.map);
    for (const line of map.errors) add('Maps', line);
  }
}

if (!problems.length) {
  const run = async (check, fn) => {
    try {
      for (const line of await fn()) add(check, line);
    } catch (error) {
      add(check, `couldn't run: ${error.message}`);
    }
  };
  await run('Text', async () => (await import('../check_text.js')).checkText());
  await run('Economy loops', async () => (await import('../check_loops.js')).checkLoops().cycles.map((c) => `loop skips combat: ${c.join(' -> ')}`));
  await run('Reach', async () => (await import('../check_reach.js')).checkReach().map((t) => `can't be reached: ${t}`));
}

process.stdout.write(JSON.stringify(problems));
