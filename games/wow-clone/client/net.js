// The connection to the game server, and what the page remembers between visits.

import { isRole } from '../shared/roles.js';

/** The Colyseus client for the server this page came from (window.Colyseus: vendor/colyseus). */
export const client = new window.Colyseus.Client(location.origin);
export const { Callbacks } = window.Colyseus;

const NAME_KEY = 'raid.name';
const ROLE_KEY = 'raid.role';
/** Per tab, so a reload rejoins the raid but a second tab is a second player. */
const RAID_TOKEN_KEY = 'raid.reconnect';

function read(storage, key) {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value == null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Private mode or blocked storage: they type it again next time.
  }
}

/** { name, role } from last time, or ?name= / ?role= in the URL. */
export function savedProfile() {
  const params = new URLSearchParams(location.search);
  const name = params.get('name') ?? read(() => localStorage, NAME_KEY) ?? '';
  const role = params.get('role') ?? read(() => localStorage, ROLE_KEY);
  return { name, role: isRole(role) ? role : 'dps' };
}

export function rememberProfile(name, role) {
  write(() => localStorage, NAME_KEY, name);
  write(() => localStorage, ROLE_KEY, role);
}

/** A JSON value saved in the browser under [key], or [fallback]. */
export function loadSetting(key, fallback) {
  try {
    return JSON.parse(read(() => localStorage, key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  write(() => localStorage, key, value == null ? null : JSON.stringify(value));
}

export const raidToken = {
  get: () => read(() => sessionStorage, RAID_TOKEN_KEY),
  set: (token) => write(() => sessionStorage, RAID_TOKEN_KEY, token),
};

/** The message from a failed join, for showing to the player. */
export function errorText(error) {
  return error?.message || "Couldn't reach the server.";
}
