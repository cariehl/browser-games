// Which game server to play on, when the page isn't served by one (the copy
// on cariehl.github.io, or a plain static server).
//
// A link with ?serverUrl=<address> picks the server: the address is
// remembered in this browser and taken out of the address bar, so a reload
// or a bookmark doesn't carry it. The invite link puts it back.

const SERVER_KEY = 'mechscape_server';

/**
 * A server address as typed ("abc.trycloudflare.com", "localhost:2567",
 * "https://x.y/") made into a full origin like "https://abc.trycloudflare.com",
 * or null if it isn't one. Local addresses default to http, others to https.
 */
export function normalizeServer(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(s);
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname) return null;
  const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  return `${protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Why the browser won't connect to [server] from this page, or null if it will. */
export function mixedContentProblem(server, pageProtocol = window.location.protocol) {
  const url = new URL(server);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (pageProtocol === 'https:' && url.protocol === 'http:' && !local) {
    return 'This page is served over https, so browsers only allow https:// servers, apart from localhost.';
  }
  return null;
}

/** The remembered server, or null. */
export function savedServer() {
  try {
    return window.localStorage.getItem(SERVER_KEY) || null;
  } catch {
    return null;
  }
}

/** Remembers [server] in this browser (null forgets it). */
export function rememberServer(server) {
  try {
    if (server) window.localStorage.setItem(SERVER_KEY, server);
    else window.localStorage.removeItem(SERVER_KEY);
  } catch {
    // Then it's typed again next time.
  }
}

/** Takes ?serverUrl= out of the address bar, remembering it if it's a server address. */
export function takeServerFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('serverUrl')) return;
  const server = normalizeServer(params.get('serverUrl'));
  if (server) rememberServer(server);
  params.delete('serverUrl');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
}

/** A link to this page that plays on [server]. */
export function inviteLink(server) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('serverUrl', server);
  return url.toString();
}

/**
 * What a game server says about itself (GET /server-info): { online, xp_rate,
 * debug, build }, or null if it can't be reached. [server] null asks the
 * server this page came from.
 */
export async function serverInfo(server = null, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${server || ''}/server-info`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The version of the game files in this copy (build.json, written by npm run build:pages), or null. */
export async function pageBuild() {
  try {
    const res = await fetch('build.json', { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}
