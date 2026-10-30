import { Client } from 'colyseus.js';

// A static build (`npm run build:pages`, for GitHub Pages) has no server of its own: games against
// the AI run in the browser, and online play goes through whatever game server the player names.
// That comes from `?serverUrl=…` in the page URL, the server box in the menu, or VITE_SERVER_URL.
const STATIC = import.meta.env.VITE_STATIC === '1';
const BUILT_IN_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;
const KEY = 'oom-server';

/** True when the page has no server of its own, so the player picks one to play online. */
export const PICK_SERVER = STATIC;
/** True when games against the AI run in the browser instead of on the server. */
export const LOCAL_AI = STATIC;

/**
 * Turns what a player typed into a server address, or null if it isn't one.
 * A bare host gets https://, except local addresses, which get http://.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(s);
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Why a page served over https can't reach this server, if it can't. */
export function serverUrlProblem(url: string): string | null {
  const u = new URL(url);
  const insecure = u.protocol === 'http:' || u.protocol === 'ws:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (location.protocol === 'https:' && insecure && !local) {
    return 'This page is served over https, so browsers only allow https:// (or wss://) servers, apart from localhost.';
  }
  return null;
}

function load(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function save(url: string | null) {
  try { if (url) localStorage.setItem(KEY, url); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function defaultUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // In dev, Vite serves the client on :5173 and the game server runs on :2567.
  if (import.meta.env.DEV) return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

let url: string | null = null;
if (STATIC) {
  // ?serverUrl=… picks a server and is remembered, so it's taken out of the address bar.
  const params = new URLSearchParams(location.search);
  if (params.has('serverUrl')) {
    const fromLink = normalizeServerUrl(params.get('serverUrl') ?? '');
    if (fromLink) save(fromLink);
    params.delete('serverUrl');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }
  url = load() ?? (BUILT_IN_URL ? normalizeServerUrl(BUILT_IN_URL) : null);
} else {
  url = defaultUrl();
}

let client: Client | null = url ? new Client(url) : null;

/** The client for online play, or null when no server is set. */
export function onlineClient() { return client; }

/** The server online play goes through, or null. */
export function serverUrl() { return url; }

/** Picks the server for online play (static builds only); null forgets it. */
export function setServerUrl(next: string | null) {
  url = next;
  save(next);
  client = next ? new Client(next) : null;
}

/** A link to this page that picks the current server. */
export function inviteLink() {
  const link = new URL(location.href);
  link.hash = '';
  link.search = '';
  if (url) link.searchParams.set('serverUrl', url);
  return link.toString();
}

/** Resolves true if the server answers at all. Its /health has no CORS headers, so this can't read the reply. */
export async function pingServer(target: string): Promise<boolean> {
  const http = target.replace(/^ws/, 'http');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    await fetch(`${http}/health`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
