import { Client } from 'colyseus.js';

// A static build (`npm run build:pages`, for GitHub Pages) has no server of its own: games against
// the AI run in the browser, and online play is only offered if VITE_SERVER_URL names a server.
const STATIC = import.meta.env.VITE_STATIC === '1';
const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

function serverUrl() {
  if (SERVER_URL) return SERVER_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // In dev, Vite serves the client on :5173 and the game server runs on :2567.
  if (import.meta.env.DEV) return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

/** True when there is a game server to play online through. */
export const ONLINE = !STATIC || !!SERVER_URL;
/** True when games against the AI run in the browser instead of on the server. */
export const LOCAL_AI = STATIC;

export const client: Client | null = ONLINE ? new Client(serverUrl()) : null;
