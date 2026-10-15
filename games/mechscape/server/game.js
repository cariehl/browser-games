// The one shared game the server runs: the authoritative World, its tick
// loop, who's playing as which entity, and players who've logged out.
//
// Nothing here knows about Colyseus or sockets; ScrapyardRoom connects them.
// That keeps this testable on its own and the room thin.
//
// Logging out takes your pilot out of the world but the server remembers it
// by name (inventory, XP, storage, where you stood), and joining again with
// the same name brings it back. That's what lets a dropped player rejoin, and
// players pick up after the server restarts from its autosave. Nothing is
// kept between play sessions: the operator starts a fresh world for those
// (npm start -- --new).

import { World, DEFAULT_MAP } from '../src/sim/world.js';
import { GameLoop } from '../src/sim/game_loop.js';
import { Action } from '../src/sim/actions.js';
import { SaveGame } from '../src/sim/save_game.js';

/** Saves every this many ticks (a minute), like the single-player autosave. */
export const AUTOSAVE_TICKS = 100;
export const MAX_NAME_LENGTH = 12;

export class Game {
  /**
   * [store]: where saves go (see WorldStore), or null to never save.
   * [debug]: allow debug actions (granting XP).
   * [fresh]: ignore any saved world and start a new one.
   */
  constructor({ store = null, debug = false, fresh = false, map = DEFAULT_MAP } = {}) {
    this.store = store;
    this.debug = debug;
    /** Logged-out players by name key: playerToDict() data. */
    this.away = new Map();
    /** Entity ids of players online now. */
    this.online = new Set();
    this.lastSavedTick = -1;
    let world = null;
    const saved = !fresh && store ? store.load() : null;
    if (saved) {
      world = SaveGame.fromDict(saved.world, map);
      for (const entry of saved.away || []) this.away.set(nameKey(entry.display_name), entry);
      // Everyone who was online when it was saved is logged out until they rejoin.
      for (const player of world.players()) this._logOut(world, player);
      this.notice = `Loaded the saved world at tick ${world.tick} (${this.away.size} pilots to rejoin).`;
    } else {
      world = new World(map);
      this.notice = 'Started a new world.';
    }
    this.loop = new GameLoop(world);
    this.loop.onTick((tick) => {
      if (this.store && tick % AUTOSAVE_TICKS === 0) this.save();
    });
  }

  get world() {
    return this.loop.world;
  }

  /** Cleans up a name a client asked for. Throws with a message for the player if it can't be used. */
  static checkName(raw) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (name.length === 0) throw new Error('Pick a name to play.');
    if (name.length > MAX_NAME_LENGTH) throw new Error(`Names are at most ${MAX_NAME_LENGTH} characters.`);
    if (!/^[A-Za-z0-9 _-]+$/.test(name)) throw new Error('Names can use letters, numbers, spaces, - and _.');
    return name;
  }

  /**
   * A player joins as [name]: their pilot from before if they've played this
   * session, otherwise a new one at the manufactory. Returns the entity.
   * Throws (with a message for the player) if the name is taken or the world is full.
   */
  join(rawName) {
    const name = Game.checkName(rawName);
    const key = nameKey(name);
    const world = this.world;
    const playing = this.findOnline(name);
    if (playing >= 0) throw new Error(`${world.entities.get(playing).display_name} is already playing.`);
    // Logged-out pilots keep their ids (their wrecks are marked with them)
    // unless someone else has had to take it.
    const reserved = new Set([...this.away.values()].map((e) => e.id));
    let player;
    const entry = this.away.get(key);
    if (entry) {
      reserved.delete(entry.id);
      const id = world.entities.has(entry.id) ? freePlayerId(world, reserved) : entry.id;
      if (id < 0) throw new Error('The server is full.');
      player = SaveGame.playerFromDict(world, entry, id);
      for (const wreck of world.wrecks.values()) if (wreck.owner_id === entry.id) wreck.owner_id = id;
      this.away.delete(key);
    } else {
      let id = freePlayerId(world, reserved);
      if (id < 0) id = freePlayerId(world, new Set());
      if (id < 0) throw new Error('The server is full.');
      player = world.spawn(id, world.spawn_point);
    }
    player.display_name = name;
    // The client numbers its actions from 1 again.
    player.last_action_seq = 0;
    this.online.add(player.id);
    world.announce(`${name} has joined.`);
    return player;
  }

  /** The entity id of the online player called [name], or -1. */
  findOnline(name) {
    const key = nameKey(name);
    for (const id of this.online) if (nameKey(this.world.entities.get(id)?.display_name) === key) return id;
    return -1;
  }

  /** The player with entity [id] has gone: remember their pilot and take it out of the world. */
  leave(id) {
    if (!this.online.delete(id)) return;
    const player = this.world.entities.get(id);
    if (!player) return;
    this.world.announce(`${player.display_name} has left.`);
    this._logOut(this.world, player);
  }

  _logOut(world, player) {
    const entry = SaveGame.playerToDict(player);
    // Like logging out mid-walk in OSRS: you come back standing still.
    entry.path = [];
    this.away.set(nameKey(player.display_name), entry);
    world.removePlayer(player.id);
  }

  /**
   * An action from the player with entity [id], as the JSON the client sent.
   * Returns '' if queued, or a message for the player if it was refused.
   */
  submit(id, data) {
    if (!this.online.has(id)) return 'You are not in the game.';
    const action = Action.fromJSON(data);
    if (!action) return '';
    if (action.isDebug() && !this.debug) return 'Debug actions are off on this server.';
    this.loop.submit(id, action);
    return '';
  }

  advance(seconds) {
    this.loop.advance(seconds);
  }

  onTick(fn) {
    return this.loop.onTick(fn);
  }

  /** Everything needed to carry on after a restart: the world, with logged-out pilots kept apart. */
  toDict() {
    return { world: SaveGame.toDict(this.world), away: [...this.away.values()] };
  }

  save() {
    if (!this.store) return;
    try {
      this.store.save(this.toDict());
      this.lastSavedTick = this.world.tick;
    } catch (error) {
      console.error('Autosave failed:', error);
    }
  }
}

function nameKey(name) {
  return String(name ?? '').toLowerCase();
}

/** The lowest player id nobody is using, avoiding [reserved] ones. -1 if none. */
function freePlayerId(world, reserved) {
  for (let id = 1; id <= World.MAX_PLAYER_ID; id++) if (!world.entities.has(id) && !reserved.has(id)) return id;
  return -1;
}
