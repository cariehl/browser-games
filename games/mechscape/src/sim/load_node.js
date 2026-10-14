// Loads content and maps from disk, for Node (tests, tools, a future
// headless server). The browser does the same with fetch() in src/main.js.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Content, CONTENT_FILES } from './defs.js';
import { MapData } from './map_data.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadContentFromDisk(root = ROOT) {
  if (Content.loaded) return;
  const bundle = {};
  for (const [kind, file] of Object.entries(CONTENT_FILES)) {
    bundle[kind] = JSON.parse(readFileSync(join(root, 'data', `${file}.json`), 'utf8'));
  }
  Content.load(bundle);
  for (const dir of ['data/maps', 'tests/maps']) {
    for (const file of readdirSync(join(root, dir))) {
      if (file.endsWith('.map')) MapData.register(`${dir}/${file}`, readFileSync(join(root, dir, file), 'utf8'));
    }
  }
}
