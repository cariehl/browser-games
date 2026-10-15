// How a pilot looks, and the frivolous things that change it: parts and
// colours picked when you join (and at the manufactory, "Reconfigure"),
// cosmetic items worn on top (a hat, a visor decal, a paint job), and a pet
// that follows you around. Nothing here changes any rule of the game.

import { Features } from './features.js';
import { Action, registerActions } from './actions.js';
import { NpcBrain } from './npc_brain.js';
import { Inventory, ItemStack } from './inventory.js';
import { Content, StationKind } from './defs.js';
import { chebyshev } from './grid.js';
import { Text } from './text.js';

export const HEADS = ['standard', 'dome', 'crest', 'mono'];
export const CHASSIS = ['standard', 'heavy', 'sleek'];
export const COSMETIC_PARTS = ['hat', 'decal', 'paint'];

/** A look for a new pilot: standard parts, colours varied by id so a crowd isn't identical. */
export function defaultLook(id = 1) {
  const primaries = ['#d98c40', '#4f9fd8', '#d95454', '#5cbf6a', '#c86fd0', '#e0c040'];
  return { head: 'standard', chassis: 'standard', visor: '#59d9ff', primary: primaries[(id - 1) % primaries.length], secondary: '#c7ccd1' };
}

/** A look from untrusted data, with anything unusable replaced by the default. */
export function cleanLook(data, id = 1) {
  const look = defaultLook(id);
  if (!data || typeof data !== 'object') return look;
  if (HEADS.includes(data.head)) look.head = data.head;
  if (CHASSIS.includes(data.chassis)) look.chassis = data.chassis;
  for (const key of ['visor', 'primary', 'secondary']) {
    if (typeof data[key] === 'string' && /^#[0-9a-f]{6}$/i.test(data[key])) look[key] = data[key].toLowerCase();
  }
  return look;
}

/** Change your look. Only beside the manufactory, where pilots are printed. */
export class SetLookAction extends Action {
  static TYPE = 'set_look';
  static FIELDS = { head: 'id', chassis: 'id', visor: 'color', primary: 'color', secondary: 'color' };
  constructor(look) {
    super();
    Object.assign(this, cleanLook(look));
  }
  slot() { return 'look'; }
  keepsTrade() { return true; }
  apply(world, entity) {
    const atManufactory = [...world.stations.values()].some((s) => s.def.kind === StationKind.RESPAWN && chebyshev(s.tile, entity.tile) <= 2);
    if (!atManufactory) {
      world.message(entity.id, Text.get('reconfigure.not_here'));
      return;
    }
    entity.look = cleanLook(this, entity.id);
    world.message(entity.id, Text.get('reconfigure.done'));
    world.emitEvent(entity.id, 'reconfigured', { entity: entity.id });
  }
}

/** Call a pet out of your pack. */
export class CallPetAction extends Action {
  static TYPE = 'call_pet';
  static FIELDS = { slot_index: 'int' };
  constructor(slotIndex) {
    super();
    this.slot_index = slotIndex;
  }
  slot() { return `pet_${this._unique}`; }
  keepsTrade() { return false; }
  apply(world, entity) {
    if (this.slot_index < 0 || this.slot_index >= Inventory.SIZE) return;
    const stack = entity.inventory.slots[this.slot_index];
    if (!stack || stack.item.kind !== 'pet') return;
    const previous = entity.pet;
    entity.pet = stack.item;
    entity.inventory.slots[this.slot_index] = previous ? new ItemStack(previous) : null;
    Pets.release(world, entity);
    Pets.ensure(world, entity);
    world.message(entity.id, `Your ${entity.pet.display_name.toLowerCase()} comes out to follow you.`);
  }
}

/** Put your pet back in your pack. */
export class DismissPetAction extends Action {
  static TYPE = 'dismiss_pet';
  slot() { return 'pet_dismiss'; }
  apply(world, entity) {
    if (!entity.pet) return;
    if (!entity.inventory.add(entity.pet)) {
      world.message(entity.id, "You don't have room in your pack for it.");
      return;
    }
    world.message(entity.id, `Your ${entity.pet.display_name.toLowerCase()} hops back into your pack.`);
    entity.pet = null;
    Pets.release(world, entity);
  }
}

registerActions(SetLookAction, CallPetAction, DismissPetAction);

export const Pets = {
  /** Spawns the follower for [player]'s pet if it isn't out. */
  ensure(world, player) {
    if (!player.pet || player.pet_npc_id >= 0 && world.entities.has(player.pet_npc_id)) return;
    const def = Content.npcs[player.pet.pet_npc];
    if (!def) return;
    let tile = world.freeTileNear(player.tile, 2);
    if (tile.x < 0) tile = { ...player.tile };
    const npc = world.addNpc(def, tile);
    npc.owner_id = player.id;
    player.pet_npc_id = npc.id;
  },

  /** Takes [player]'s follower out of the world. */
  release(world, player) {
    if (player.pet_npc_id >= 0) world.removeNpc(player.pet_npc_id);
    player.pet_npc_id = -1;
  },

  /** The pet following [player], or null. */
  of(world, player) {
    const npc = world.entities.get(player.pet_npc_id);
    return npc && npc.owner_id === player.id ? npc : null;
  },
};

/** Pets trail their owner, catch up through hatches, and never fight. */
class PetBrain extends NpcBrain {
  think(world, npc) {
    const owner = world.entities.get(npc.owner_id);
    if (!owner) return;
    const far = chebyshev(npc.tile, owner.tile);
    if (world.areaIdAt(npc.tile) !== world.areaIdAt(owner.tile) || far > 10) {
      const tile = world.freeTileNear(owner.tile, 2);
      npc.teleport(tile.x < 0 ? owner.tile : tile);
      return;
    }
    if (far > 2 && (!npc.isMoving() || owner.isMoving())) {
      npc.path = world.pathToAdjacentTile(npc.tile, owner.tile, npc);
      npc.running = owner.running || far > 4;
    } else if (far <= 1 && npc.isMoving()) {
      npc.path = [];
    }
    if (!npc.isMoving()) npc.face_target = { ...owner.tile };
  }

  beforeTask() {
    return false;
  }

  retaliate() {}
}
NpcBrain.register('pet', new PetBrain());

Features.register({
  id: 'look',

  initPlayer(_world, player) {
    /** Parts and colours (see defaultLook). Public. */
    player.look = defaultLook(player.id);
    /** Cosmetic items worn: part -> ItemDef. */
    player.cosmetics = {};
    /** The pet item that's out, or null; and its follower's id. */
    player.pet = null;
    player.pet_npc_id = -1;
  },

  tick(world) {
    for (const player of world.players()) {
      if (player.pet) Pets.ensure(world, player);
    }
    // Followers whose owner left go with them.
    for (const e of [...world.entities.values()]) {
      if (e.isNpc() && e.owner_id !== undefined && !world.entities.has(e.owner_id)) world.removeNpc(e.id);
    }
    // The survey drone has something to say about what you scan and sample.
    for (const ev of world.events) {
      if (!['scan', 'sampled', 'puzzle_solved'].includes(ev.type)) continue;
      if (ev.type === 'scan' && !ev.data.first) continue;
      const player = world.entities.get(ev.entity);
      const pet = player && !player.isNpc() ? Pets.of(world, player) : null;
      if (!pet || !pet.def.comments) continue;
      const key = ev.type === 'scan' ? ev.data.landmark : ev.type === 'sampled' ? 'specimen' : 'puzzle';
      const text = pet.def.comments[key];
      if (text) world.emitEvent(pet.id, 'say', { entity: pet.id, text });
    }
  },

  dropOnDeath(world, player) {
    const items = Object.values(player.cosmetics).map((item) => new ItemStack(item));
    player.cosmetics = {};
    if (player.pet) {
      items.push(new ItemStack(player.pet));
      player.pet = null;
      Pets.release(world, player);
    }
    return items;
  },

  savePlayer(player) {
    return {
      look: player.look,
      cosmetics: Object.fromEntries(Object.entries(player.cosmetics).map(([part, item]) => [part, item.id])),
      pet: player.pet ? player.pet.id : '',
    };
  },

  loadPlayer(_world, player, data) {
    player.look = cleanLook(data.look, player.id);
    player.cosmetics = {};
    for (const [part, id] of Object.entries(data.cosmetics || {})) {
      const item = Content.item(id);
      if (item && item.kind === 'cosmetic' && COSMETIC_PARTS.includes(part)) player.cosmetics[part] = item;
    }
    const pet = data.pet && Content.item(data.pet);
    player.pet = pet && pet.kind === 'pet' ? pet : null;
  },

  publicPlayer(player) {
    return {
      look: player.look,
      cosmetics: Object.fromEntries(Object.entries(player.cosmetics).map(([part, item]) => [part, item.id])),
      pet: player.pet ? player.pet.id : '',
      pet_npc: player.pet_npc_id,
    };
  },

  applyPlayer(_world, player, data) {
    if (JSON.stringify(player.look) !== JSON.stringify(data.look)) player.look = data.look;
    const cosmetics = {};
    for (const [part, id] of Object.entries(data.cosmetics)) {
      const item = Content.item(id);
      if (item) cosmetics[part] = item;
    }
    const same = Object.keys(cosmetics).length === Object.keys(player.cosmetics).length && Object.entries(cosmetics).every(([k, v]) => player.cosmetics[k] === v);
    if (!same) player.cosmetics = cosmetics;
    player.pet = data.pet ? Content.item(data.pet) : null;
    player.pet_npc_id = data.pet_npc;
  },
});
