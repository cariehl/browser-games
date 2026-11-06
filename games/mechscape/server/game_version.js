// A short fingerprint of the game's code and content (src/ and data/), so a
// static copy of the game (npm run build:pages) can tell when the server it
// joins runs a different version. Built from the files themselves, not the
// git commit, so a merge commit with the same files still matches.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from '../src/sim/load_node.js';

const PARTS = ['src', 'data'];

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** 8 hex characters that change whenever any file under src/ or data/ does. */
export function gameVersion(root = ROOT) {
  const hash = createHash('sha256');
  const files = PARTS.flatMap((part) => filesUnder(join(root, part)))
    .map((path) => relative(root, path).split(sep).join('/'))
    .sort();
  for (const file of files) {
    // Line endings normalised, so a Windows checkout (autocrlf) matches.
    const text = readFileSync(join(root, file)).toString('latin1').replace(/\r\n/g, '\n');
    hash.update(`${file}\0${text}\0`);
  }
  return hash.digest('hex').slice(0, 8);
}
