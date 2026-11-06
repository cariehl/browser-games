// Single-player saving: Ctrl+S saves, Ctrl+L loads, it autosaves every
// AUTOSAVE_TICKS ticks and when the page closes, and main.js loads the save
// on startup.
//
// Loading or starting over rebuilds the page from scratch (like Godot
// reloading the scene), since views hold references into the old world.

import { ClientState } from './client_state.js';
import { SaveStore, LoadStatus } from './save_store.js';

export const AUTOSAVE_TICKS = 100;
/** Carries a message across the reload a load or new game does. */
export const NOTICE_KEY = 'mechscape_notice';
/** Tells the next page to start a new game. */
const NEW_GAME_KEY = 'mechscape_new_game';

export class SaveManager {
  constructor(messageLog) {
    this.messageLog = messageLog;
    this.lastSavedTick = -1;
    this._leaving = false;
    ClientState.onTick((tick) => {
      if (tick % AUTOSAVE_TICKS === 0) this.save(true);
    });
    // Save on close.
    window.addEventListener('pagehide', () => {
      if (!this._leaving) this.save(true);
    });
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 's') this.save();
      else if (key === 'l') this.load();
      else return;
      e.preventDefault();
    });
  }

  save(quiet = false) {
    const error = SaveStore.save(ClientState.loop.world);
    if (error) {
      this.messageLog.push(`Couldn't save the game (${error}).`);
      return;
    }
    this.lastSavedTick = ClientState.world.tick;
    if (!quiet) this.messageLog.push('Game saved.');
  }

  load() {
    if (!SaveStore.exists()) {
      this.messageLog.push("There's no saved game to load.");
      return;
    }
    const loaded = SaveStore.loadSafely();
    if (loaded.status === LoadStatus.UNREADABLE) {
      // Carry on with the game in progress.
      this.messageLog.push(SaveStore.failureMessage(loaded));
      return;
    }
    if (loaded.status === LoadStatus.FROM_BACKUP) {
      // The backup is now the save to load; keep it so the reload finds it.
      SaveStore.save(loaded.world);
    }
    const message = loaded.status === LoadStatus.OK ? 'Game loaded.' : SaveStore.failureMessage(loaded);
    this._reload(message);
  }

  newGame() {
    SaveStore.clear();
    sessionStore(NEW_GAME_KEY, '1');
    this._reload('Started a new game.');
  }

  _reload(message) {
    this._leaving = true;
    sessionStore(NOTICE_KEY, message);
    window.location.reload();
  }

  /** Startup: the world to play, and a notice for the message log. */
  static startingWorld(makeWorld) {
    const notice = sessionTake(NOTICE_KEY);
    if (sessionTake(NEW_GAME_KEY)) return { world: makeWorld(), notice };
    const loaded = SaveStore.loadSafely();
    if (loaded.status === LoadStatus.OK) return { world: loaded.world, notice: notice || 'Welcome back. Your game was loaded.' };
    if (loaded.status === LoadStatus.FROM_BACKUP) return { world: loaded.world, notice: SaveStore.failureMessage(loaded) };
    if (loaded.status === LoadStatus.UNREADABLE) return { world: makeWorld(), notice: `${SaveStore.failureMessage(loaded)} A new game was started.` };
    return { world: makeWorld(), notice };
  }
}

function sessionStore(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Without session storage the notice is just lost.
  }
}

function sessionTake(key) {
  try {
    const value = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    return value || '';
  } catch {
    return '';
  }
}
