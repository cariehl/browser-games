// Playing on a game server (server/index.js) over Colyseus.
//
// The server runs the only real World. This page keeps a mirror of it: a
// World built from the same map that never runs a tick itself, only applies
// each snapshot the server sends (src/sim/snapshot.js). NetLoop drives it
// with the same interface as GameLoop, so ClientState and every view work
// unchanged. NetLink sends actions to the server, with the same interface
// as SimulatedLink (it still offers the debug input delay on top).

import { World } from '../sim/world.js';
import { applySnapshot } from '../sim/snapshot.js';
import { TICK_SECONDS } from '../sim/constants.js';
import { SimulatedLink } from './simulated_link.js';
import { LookEditor, savedLook, rememberLook } from '../ui/look_editor.js';

export const ROOM_NAME = 'scrapyard';
const NAME_KEY = 'mechscape_name';

/** Stands in for GameLoop online: ticks happen when the server's snapshots arrive. */
export class NetLoop {
  constructor(world, viewerId) {
    this.world = world;
    this.viewerId = viewerId;
    /** 0..1 progress through the current tick, measured from when the last snapshot arrived. */
    this.alpha = 0;
    this.running = true;
    this.listeners = [];
    this._lastAt = performance.now();
  }

  onTick(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  /** A snapshot from the server: the world moves on a tick. */
  receive(snapshot) {
    applySnapshot(this.world, snapshot, this.viewerId);
    this._lastAt = performance.now();
    this.alpha = 0;
    for (const fn of this.listeners) fn(this.world.tick);
  }

  /** Time passes between snapshots; only the interpolation moves. */
  advance() {
    const seconds = (performance.now() - this._lastAt) / 1000;
    this.alpha = Math.min(Math.max(seconds / TICK_SECONDS, 0), 1);
  }

  /** Offline the GameLoop takes actions here; online they go to the server (NetLink). */
  submit() {}
}

/** Sends actions to the server, numbered like SimulatedLink's. */
export class NetLink extends SimulatedLink {
  constructor(room) {
    super();
    this.room = room;
  }

  _deliver(_entityId, data) {
    // The server applies it to this connection's own pilot.
    this.room.send('action', data);
  }
}

/** The name to play as: ?name= in the URL, else the last one used here, else ''. */
export function savedName() {
  const fromUrl = new URLSearchParams(window.location.search).get('name');
  if (fromUrl) return fromUrl;
  try {
    return window.localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function rememberName(name) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Then they type it again next time.
  }
}

/** Loads the Colyseus client (a plain script that sets window.Colyseus). */
function loadSdk() {
  if (window.Colyseus) return Promise.resolve(window.Colyseus);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/colyseus/colyseus.js';
    script.onload = () => resolve(window.Colyseus);
    script.onerror = () => reject(new Error("Couldn't load the Colyseus client"));
    document.head.appendChild(script);
  });
}

/**
 * Joins the server this page came from as [name]. Resolves to
 * { room, loop, id, debug } once the first snapshot is in the mirror, or
 * rejects with the server's reason (name taken, server full...).
 */
export async function join(name, mapPath = World.defaultMap, look = savedLook()) {
  const Colyseus = await loadSdk();
  const client = new Colyseus.Client(window.location.origin);
  const room = await client.join(ROOM_NAME, look ? { name, look } : { name });
  rememberName(name);
  // Ticks can arrive before the welcome is handled; hold them until the mirror exists.
  let loop = null;
  const early = [];
  room.onMessage('tick', (snapshot) => {
    if (loop) loop.receive(snapshot);
    else early.push(snapshot);
  });
  const welcome = await new Promise((resolve, reject) => {
    room.onMessage('welcome', resolve);
    room.onLeave(() => reject(new Error('The server closed the connection.')));
  });
  const world = new World(mapPath);
  loop = new NetLoop(world, welcome.id);
  applySnapshot(world, welcome.snapshot, welcome.id);
  for (const snapshot of early) if (snapshot.tick > world.tick) loop.receive(snapshot);
  return { room, loop, id: welcome.id, debug: welcome.debug, xpRate: welcome.xp_rate || 1 };
}

/** What the server says about itself (GET /server-info), or null. */
async function serverInfo() {
  try {
    const res = await fetch('/server-info');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Shows the connect screen over the loading screen (a name box and the look
 * picker) and resolves with the name typed; the look picked is remembered.
 * [error] is shown above it (why the last try failed).
 */
export function askName(status, initial = '', error = '') {
  return new Promise((resolve) => {
    status.textContent = '';
    status.classList.remove('error');
    const form = document.createElement('form');
    form.className = 'join-form panel';
    form.innerHTML = '<div class="title">MechScape</div><div class="muted small server-info"></div>'
      + '<label>Pilot name <input name="name" maxlength="12" autocomplete="nickname" spellcheck="false"></label>'
      + '<div class="look-slot"></div>'
      + '<div class="warn join-error"></div><button type="submit">Join</button>';
    const input = form.querySelector('input');
    input.value = initial;
    form.querySelector('.join-error').textContent = error;
    const editor = new LookEditor(form.querySelector('.look-slot'), savedLook());
    serverInfo().then((info) => {
      if (!info) return;
      const parts = [`${info.online} online`];
      if (info.xp_rate && info.xp_rate !== 1) parts.push(`XP rate ×${info.xp_rate}`);
      form.querySelector('.server-info').textContent = parts.join('  ·  ');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      rememberLook(editor.look);
      editor.dispose();
      form.remove();
      resolve(name);
    });
    status.appendChild(form);
    input.focus();
    input.select();
  });
}
