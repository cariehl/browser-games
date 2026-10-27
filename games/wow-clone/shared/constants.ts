// Numbers and names the client and server must agree on.

export const DEFAULT_PORT = 2567;

export const ROOM_LOBBY = 'lobby';
export const ROOM_RAID = 'raid';

/** A raid group: the whole lobby goes in together. */
export const PARTY_MIN = 2;
export const PARTY_MAX = 5;

/** Server simulation rate for raid instances. */
export const TICK_HZ = 20;

/** How long a dropped raider's character waits for them to reconnect. */
export const RECONNECT_SECONDS = 30;

export const NAME_MAX = 12;
const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

/** A trimmed, valid display name, or null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > NAME_MAX || !NAME_PATTERN.test(name)) return null;
  return name;
}
