// Keeps the server's game in one JSON file, so a crash or restart loses at
// most a minute of play.
//
// Writes go to a temporary file first, then the previous save becomes the
// .bak and the new one takes its place, so a crash mid-write can't leave
// only a broken save. A save that won't parse is moved aside (never
// deleted) and the .bak is tried instead.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class WorldStore {
  constructor(path) {
    this.path = path;
  }

  /** The saved data, or null if there's none that can be read. */
  load() {
    for (const path of [this.path, this.path + '.bak']) {
      if (!existsSync(path)) continue;
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        const aside = `${path}.unreadable-${Date.now()}`;
        console.error(`Couldn't read ${path} (${error.message}); moved it to ${aside}.`);
        renameSync(path, aside);
      }
    }
    return null;
  }

  save(data) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    if (existsSync(this.path)) renameSync(this.path, this.path + '.bak');
    renameSync(tmp, this.path);
  }
}
