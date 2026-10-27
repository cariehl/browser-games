// The connection to the game server, and what the page remembers between visits.

import { Client } from '@colyseus/sdk';
import { DEFAULT_PORT } from '../../shared/constants';
import { isRole, type Role } from '../../shared/roles';

/**
 * The server this page came from. Under `npm run dev` Vite serves the page
 * on its own port, so the game server is on DEFAULT_PORT of the same host.
 */
export const endpoint = import.meta.env.DEV
  ? `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`
  : location.origin;

export const client = new Client(endpoint);

const NAME_KEY = 'raid.name';
const ROLE_KEY = 'raid.role';
/** Per tab, so a reload rejoins the raid but a second tab is a second player. */
const RAID_TOKEN_KEY = 'raid.reconnect';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value == null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Private mode or blocked storage: they type it again next time.
  }
}

/** Name and role from last time, or ?name= / ?role= in the URL. */
export function savedProfile(): { name: string; role: Role } {
  const params = new URLSearchParams(location.search);
  const name = params.get('name') ?? read(() => localStorage, NAME_KEY) ?? '';
  const role = params.get('role') ?? read(() => localStorage, ROLE_KEY);
  return { name, role: isRole(role) ? role : 'dps' };
}

export function rememberProfile(name: string, role: Role) {
  write(() => localStorage, NAME_KEY, name);
  write(() => localStorage, ROLE_KEY, role);
}

export const raidToken = {
  get: () => read(() => sessionStorage, RAID_TOKEN_KEY),
  set: (token: string | null) => write(() => sessionStorage, RAID_TOKEN_KEY, token),
};

/** The message from a failed join, for showing to the player. */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't reach the server.";
}
