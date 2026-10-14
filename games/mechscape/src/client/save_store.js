// Single-player saving in the browser: the save is JSON in localStorage,
// written so a failure part-way can't ruin it, with the previous save kept
// as a backup. A save that can't be read is moved aside (never deleted or
// overwritten: it may be from a newer build) and the reason given.
//
// A server-side job living in the page for now: it saves the authoritative
// world. In the alpha, saving moves to the server, which writes the same
// SaveGame JSON to a file instead.

import { SaveGame, SAVE_VERSION } from '../sim/save_game.js';

export const SAVE_KEY = 'mechscape_save';
const BACKUP_KEY = SAVE_KEY + '.bak';

export const LoadStatus = { NONE: 'none', OK: 'ok', FROM_BACKUP: 'from_backup', UNREADABLE: 'unreadable' };

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const SaveStore = {
  /** Saves [world]. Returns '' or why it failed. */
  save(world) {
    const store = storage();
    if (!store) return 'this browser blocks storage';
    try {
      const text = SaveGame.toJSON(world);
      const previous = store.getItem(SAVE_KEY);
      if (previous != null) store.setItem(BACKUP_KEY, previous);
      store.setItem(SAVE_KEY, text);
      return '';
    } catch (error) {
      return error && error.name === 'QuotaExceededError' ? 'storage is full' : String(error && error.message || error);
    }
  },

  exists() {
    const store = storage();
    return !!store && store.getItem(SAVE_KEY) != null;
  },

  /** { status, world, reason, keptAs } */
  loadSafely() {
    const result = { status: LoadStatus.NONE, world: null, reason: '', keptAs: '' };
    const store = storage();
    if (!store) return result;
    const text = store.getItem(SAVE_KEY);
    if (text == null) return result;
    const main = tryLoad(text);
    if (main.world) {
      result.status = LoadStatus.OK;
      result.world = main.world;
      return result;
    }
    result.reason = main.reason;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    result.keptAs = `${SAVE_KEY}.unreadable-${stamp}`;
    try {
      store.setItem(result.keptAs, text);
      store.removeItem(SAVE_KEY);
    } catch {
      result.keptAs = '';
    }
    const backup = store.getItem(BACKUP_KEY);
    if (backup != null) {
      const older = tryLoad(backup);
      if (older.world) {
        result.status = LoadStatus.FROM_BACKUP;
        result.world = older.world;
        return result;
      }
    }
    result.status = LoadStatus.UNREADABLE;
    return result;
  },

  /** Deletes the save and its backup. */
  clear() {
    const store = storage();
    if (!store) return;
    store.removeItem(SAVE_KEY);
    store.removeItem(BACKUP_KEY);
  },

  /** What to tell the player when their save couldn't be read. */
  failureMessage(loaded) {
    const kept = loaded.keptAs ? ` It was kept in local storage as ${loaded.keptAs}.` : '';
    if (loaded.status === LoadStatus.FROM_BACKUP) {
      return `Your save couldn't be read (${loaded.reason}), so the one before it was loaded.${kept}`;
    }
    return `Your save couldn't be loaded (${loaded.reason}).${kept}`;
  },
};

function tryLoad(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { world: null, reason: "it isn't valid JSON" };
  }
  if (typeof data !== 'object' || data == null) return { world: null, reason: "it isn't valid JSON" };
  if (typeof data.version !== 'number' || data.version < 1 || data.version > SAVE_VERSION) {
    return { world: null, reason: `it's version ${data.version}; this build reads versions 1 to ${SAVE_VERSION}` };
  }
  try {
    return { world: SaveGame.fromDict(data), reason: '' };
  } catch (error) {
    return { world: null, reason: `it couldn't be read (${error.message})` };
  }
}
