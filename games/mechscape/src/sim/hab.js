// The hab: the crew's shared quarters and workshop beside camp, laid out
// together and tied into everyone else's work.
//
//   pieces       furniture and fittings made at the fabricator and placed
//                on the hab floor (the "build" zone). Anyone can place; only
//                whoever placed a piece can move, recolour or pick it up.
//                Nothing may cut off part of the hab from its door.
//   fittings     a tool wall speeds up Engineering at the hab's stations; a
//                coolant rack sometimes saves Splicing's ichor and coolant
//   grow beds    planted with seeds from the Quiet Reach and watered with
//                ichor or coolant, they grow Xenobiology plants for Splicing
//   comfort      every piece adds some, complete sets add more; a minute in
//                a comfortable hab leaves you rested (bonus XP for a while)
//   trophy wall  trophies from fights, mounted for a bonus everyone shares
//   commission board  post a request with an offer held in escrow; anyone
//                can fill it, and the poster collects later. The session's
//                market, with no currency.
//
// Pieces, beds, trophies and commissions are public, and saved.

import { Features } from './features.js';
import { Action, registerActions } from './actions.js';
import { Content, StationKind } from './defs.js';
import { WorldObject } from './objects.js';
import { Task, StationHandlers, a } from './tasks.js';
import { Inventory, ItemStack } from './inventory.js';
import { key, eq, UP, DOWN, LEFT, RIGHT, add } from './grid.js';
import { XENOBIOLOGY } from './skills.js';
import { Text } from './text.js';
import { TICK_SECONDS } from './constants.js';

/** The hab's numbers (data/rules.json "hab"): comfort, resting, trophies, sets, commissions, beds. */
const rules = () => Content.rules.hab;
/** "ichor or coolant": what a grow bed can be watered with. */
const liquidNames = () => rules().bed_liquids.map((id) => (Content.item(id) ? Content.item(id).display_name.toLowerCase() : id)).join(' or ');

/** A piece of furniture or a fitting placed in the hab. */
export class HabPiece extends WorldObject {
  constructor(id, item, tile) {
    super(id, tile);
    this.item = item;
    this.rotation = 0;
    this.color = item.piece.colors ? item.piece.colors[0] : '#c7ccd1';
    /** Who placed it (by name, which survives rejoining). */
    this.owner = '';
    /** Grow beds: { seed, fed, ready } or null when empty. */
    this.bed = null;
  }

  get def() {
    return this.item.piece;
  }

  displayName() {
    return this.item.display_name;
  }

  blocksMovement() {
    return !!this.item.piece.blocks;
  }

  makeTask() {
    return new PieceTask(this.id);
  }
}

export const Hab = {
  /** The hab floor's door tile: where the flood fill that keeps the hab open starts. */
  door(world) {
    if (world._habDoor !== undefined) return world._habDoor;
    world._habDoor = null;
    let best = null;
    for (let y = 0; y < world.size.y; y++) {
      for (let x = 0; x < world.size.x; x++) {
        const t = { x, y };
        if (!world.inZone(t, 'hab')) continue;
        // The hab tile with the most open ground straight outside it.
        const out = add(t, DOWN);
        if (!world.inZone(out, 'hab') && world.isWalkable(out) && world.isWalkable(add(out, DOWN)) && !world.inZone(add(out, DOWN), 'hab')) {
          if (!best || t.y > best.y) best = t;
        }
      }
    }
    world._habDoor = best;
    return best;
  },

  /** Every hab-zone tile reachable from the door, if [blocked] tiles were solid too. */
  reachable(world, blocked = new Set()) {
    const start = Hab.door(world);
    const seen = new Set();
    if (!start) return seen;
    const open = (t) => world.inZone(t, 'hab') && world.isWalkable(t) && !blocked.has(key(t));
    const queue = open(start) ? [start] : [];
    if (queue.length) seen.add(key(start));
    while (queue.length) {
      const t = queue.shift();
      for (const d of [UP, DOWN, LEFT, RIGHT]) {
        const n = add(t, d);
        const k = key(n);
        if (seen.has(k) || !open(n) || !world.edgeOk(t, n)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
    return seen;
  },

  /**
   * Why [item] can't go on [tile] (moving piece [ignore], if any), or ''.
   * Inside the build zone, on a free tile, and never cutting the hab off.
   */
  whyNot(world, item, tile, ignore = null) {
    if (!world.inZone(tile, 'build')) return 'Pieces go on the hab floor.';
    if (!world.isWalkable(tile) && !(ignore && eq(ignore.tile, tile))) return "There's something in the way.";
    const there = world.objectAt(tile);
    if (there && there !== ignore) return "There's something in the way.";
    if (!item.piece.blocks) return '';
    for (const e of world.entities.values()) if (eq(e.tile, tile) && !e.isDead()) return 'Someone is standing there.';
    // Flood fill: every open hab tile, station and bed must still be reachable from the door.
    const blocked = new Set([key(tile)]);
    const freed = ignore && ignore.blocksMovement() ? key(ignore.tile) : null;
    const before = Hab.reachable(world);
    const after = Hab.reachableWith(world, blocked, freed);
    for (const k of before) if (k !== key(tile) && !after.has(k)) return 'That would cut off part of the hab.';
    for (const object of [...world.stations.values(), ...world.pieces.values()]) {
      if (!world.inZone(object.tile, 'hab') || object === ignore) continue;
      const usable = object instanceof HabPiece ? object.bed || object.def.effect === 'grow_bed' : true;
      if (!usable) continue;
      const sides = object.interactionTiles().map(key);
      if (sides.some((k) => before.has(k)) && !sides.some((k) => after.has(k))) return `That would block the ${object.displayName().toLowerCase()}.`;
    }
    return '';
  },

  /** reachable(), with [blocked] solid and the tile [freed] (a piece being moved) open. */
  reachableWith(world, blocked, freed) {
    if (!freed) return Hab.reachable(world, blocked);
    const [x, y] = freed.split(',').map(Number);
    const object = world.objectAt({ x, y });
    // Lift the moving piece for the check, then put it back.
    world._objectTiles.delete(freed);
    world._refreshTile({ x, y });
    const out = Hab.reachable(world, blocked);
    world._objectTiles.set(freed, object);
    world._refreshTile({ x, y });
    return out;
  },

  /** The hab's comfort: every piece's, plus each complete set. */
  comfort(world) {
    let total = 0;
    for (const p of world.pieces.values()) if (world.inZone(p.tile, 'hab')) total += p.def.comfort || 0;
    return total + Hab.completeSets(world).length * rules().set_comfort;
  },

  /** Set id -> the item ids of its pieces (each piece's "set" in data/items.json). */
  sets() {
    const out = {};
    for (const item of Object.values(Content.items)) {
      if (item.piece && item.piece.set) (out[item.piece.set] = out[item.piece.set] || []).push(item.id);
    }
    return out;
  },

  /** A set's name, from data/rules.json (hab.sets). */
  setName(id) {
    return (rules().sets || {})[id] || id;
  },

  completeSets(world) {
    const placed = new Set([...world.pieces.values()].filter((p) => world.inZone(p.tile, 'hab')).map((p) => p.item.id));
    return Object.entries(Hab.sets()).filter(([, pieces]) => pieces.every((id) => placed.has(id))).map(([id]) => id);
  },

  /** A piece placed in the hab whose effect is [effect] (and, if given, for [skill]), or null. */
  fitting(world, effect, skill = null) {
    for (const p of world.pieces.values()) {
      if (p.def.effect === effect && (!skill || p.def.skill === skill) && world.inZone(p.tile, 'hab')) return p;
    }
    return null;
  },

  hasFitting(world, effect) {
    return Hab.fitting(world, effect) != null;
  },

  addPiece(world, item, tile, id = -1) {
    if (id < 0 || world.getObject(id)) id = world._takeObjectId();
    world._nextObjectId = Math.max(world._nextObjectId, id + 1);
    const piece = new HabPiece(id, item, tile);
    if (item.piece.effect === 'grow_bed') piece.bed = { seed: null, fed: false, ready: -1 };
    world.pieces.set(id, piece);
    world._placeObject(piece);
    return piece;
  },

  /** Whether every one of [stacks] ({ item, count }) would fit in [player]'s inventory together. */
  canTake(player, stacks) {
    const copy = new Inventory();
    copy.slots = player.inventory.slots.map((s) => (s ? new ItemStack(s.item, s.count) : null));
    return stacks.every(({ item, count }) => copy.add(item, count));
  },
};

// --- Using pieces -------------------------------------------------------------

/** Walk to a piece, then use it: plant, water or harvest a grow bed; admire anything else. */
export class PieceTask extends Task {
  constructor(pieceId) {
    super();
    this.piece_id = pieceId;
  }

  process(world, player) {
    const piece = world.pieces.get(this.piece_id);
    if (!piece) return false;
    if (!piece.isAdjacent(player.tile)) {
      if (player.isMoving()) return true;
      world.message(player.id, "I can't reach that.");
      return false;
    }
    player.face_target = { ...piece.tile };
    if (!piece.bed) {
      world.message(player.id, `${piece.item.description || piece.displayName()} (Comfort ${piece.def.comfort || 0}, placed by ${piece.owner || 'someone'}.)`);
      return false;
    }
    const bed = piece.bed;
    if (!bed.seed) {
      const slot = player.inventory.slots.findIndex((s) => s && s.item.kind === 'seed');
      if (slot < 0) {
        world.message(player.id, Text.get('hab.bed_empty'));
        return false;
      }
      const seed = player.inventory.slots[slot].item;
      player.inventory.remove(seed, 1);
      bed.seed = seed.id;
      bed.fed = false;
      bed.ready = -1;
      world.message(player.id, `You plant ${a(seed.display_name.toLowerCase())}. It needs watering with ${rules().bed_water} ${liquidNames()}.`);
      world.emitEvent(piece.id, 'planted', { piece: piece.id });
      return false;
    }
    const seed = Content.item(bed.seed);
    if (!bed.fed) {
      const water = rules().bed_water;
      const liquid = rules().bed_liquids.map((id) => Content.item(id)).find((it) => it && player.inventory.countOf(it) >= water);
      if (!liquid) {
        world.message(player.id, `It needs watering: ${water} ${liquidNames()}. Nothing grows dry.`);
        return false;
      }
      player.inventory.remove(liquid, water);
      bed.fed = true;
      bed.ready = world.tick + seed.grow_ticks;
      world.message(player.id, `You water the bed with ${liquid.display_name.toLowerCase()}. The ${seed.grows} will be ready in about ${Math.ceil(seed.grow_ticks * TICK_SECONDS / 60)} minutes.`);
      world.emitEvent(piece.id, 'watered', { piece: piece.id });
      return false;
    }
    if (world.tick < bed.ready) {
      world.message(player.id, `The ${seed.grows} is still growing. About ${Math.ceil((bed.ready - world.tick) * TICK_SECONDS)} seconds to go.`);
      return false;
    }
    const crop = Content.item(seed.grows);
    const [lo, hi] = seed.grow_count || [3, 5];
    const count = world.rng.randiRange(lo, hi);
    let got = 0;
    for (let i = 0; i < count; i++) if (player.inventory.add(crop)) got++;
    if (!got) {
      world.message(player.id, 'Your inventory is too full to harvest.');
      return false;
    }
    for (let i = got; i < count; i++) world.dropItem(crop, 1, player.tile);
    world.grantXp(player, XENOBIOLOGY, seed.grow_xp * count);
    world.message(player.id, `You harvest ${count} ${crop.display_name.toLowerCase()}${count === 1 ? '' : 's'}.`);
    piece.bed = { seed: null, fed: false, ready: -1 };
    world.emitEvent(piece.id, 'harvested', { piece: piece.id });
    return false;
  }
}

// --- Actions ------------------------------------------------------------------

/** Put a piece from your inventory on the hab floor. */
export class PlacePieceAction extends Action {
  static TYPE = 'place_piece';
  static FIELDS = { slot_index: 'int', tile: 'tile', rotation: 'int', color: 'color' };
  constructor(slotIndex, tile, rotation = 0, color = '') {
    super();
    this.slot_index = slotIndex;
    this.tile = { ...tile };
    this.rotation = rotation;
    this.color = color;
  }
  slot() { return `place_${this._unique}`; }
  apply(world, player) {
    const stack = player.inventory.slots[this.slot_index];
    if (!stack || stack.item.kind !== 'piece') return;
    const why = Hab.whyNot(world, stack.item, this.tile);
    if (why) {
      world.message(player.id, why);
      return;
    }
    player.inventory.remove(stack.item, 1);
    const piece = Hab.addPiece(world, stack.item, this.tile);
    piece.rotation = ((this.rotation % 4) + 4) % 4;
    if (piece.def.colors && piece.def.colors.includes(this.color)) piece.color = this.color;
    piece.owner = player.display_name;
    world.emitEvent(piece.id, 'piece_placed', { piece: piece.id, by: player.id });
    Hab.checkSets(world, player);
  }
}

/** Move (turning and recolouring it too), turn or recolour a piece you placed; or pick it back up. */
export class EditPieceAction extends Action {
  static TYPE = 'edit_piece';
  static FIELDS = { piece_id: 'int', command: 'id', tile: 'tile', rotation: 'int', color: 'color' };
  constructor(pieceId, command, { tile = null, rotation = 0, color = '' } = {}) {
    super();
    this.piece_id = pieceId;
    this.command = command;
    this.tile = tile ? { ...tile } : { x: -1, y: -1 };
    this.rotation = rotation;
    this.color = color;
  }
  slot() { return `edit_${this._unique}`; }
  apply(world, player) {
    const piece = world.pieces.get(this.piece_id);
    if (!piece) return;
    if (piece.owner !== player.display_name) {
      world.message(player.id, `Only ${piece.owner || 'whoever placed it'} can change that.`);
      return;
    }
    switch (this.command) {
      case 'move': {
        const why = Hab.whyNot(world, piece.item, this.tile, piece);
        if (why) {
          world.message(player.id, why);
          return;
        }
        world._objectTiles.delete(key(piece.tile));
        world._refreshTile(piece.tile);
        piece.tile = { ...this.tile };
        piece.rotation = ((this.rotation % 4) + 4) % 4;
        if (piece.def.colors && piece.def.colors.includes(this.color)) piece.color = this.color;
        world._objectTiles.set(key(piece.tile), piece);
        world._refreshTile(piece.tile);
        return;
      }
      case 'color':
        if (piece.def.colors && piece.def.colors.includes(this.color)) piece.color = this.color;
        return;
      case 'turn':
        piece.rotation = (piece.rotation + 1) % 4;
        return;
      case 'pick_up': {
        if (piece.bed && piece.bed.seed) {
          world.message(player.id, 'Harvest the bed (or wait for it) before you move it.');
          return;
        }
        if (!player.inventory.add(piece.item)) {
          world.message(player.id, "You don't have room for it.");
          return;
        }
        world.removeObject(piece.id);
        world.message(player.id, `You pick up the ${piece.displayName().toLowerCase()}.`);
      }
    }
  }
}

/** At the commission board: post, fill, cancel or collect. */
export class CommissionAction extends Action {
  static TYPE = 'commission';
  static FIELDS = { station_id: 'int', command: 'id', id: 'int', want: 'id', want_count: 'int', offer: 'id', offer_count: 'int' };
  constructor(stationId, command, { id = 0, want = '', wantCount = 0, offer = '', offerCount = 0 } = {}) {
    super();
    this.station_id = stationId;
    this.command = command;
    this.id = id;
    this.want = want;
    this.want_count = wantCount;
    this.offer = offer;
    this.offer_count = offerCount;
  }
  slot() { return `commission_${this._unique}`; }
  apply(world, player) {
    const board = world.stations.get(this.station_id);
    if (!board || board.def.kind !== StationKind.BOARD || !board.isAdjacent(player.tile)) return;
    const say = (text) => world.message(player.id, text);
    const list = world.commissions;
    const c = list.find((x) => x.id === this.id);
    switch (this.command) {
      case 'post': {
        const want = Content.item(this.want);
        const offer = Content.item(this.offer);
        const wantCount = Math.max(1, Math.min(this.want_count, 1000));
        const offerCount = Math.max(1, Math.min(this.offer_count, 1000));
        if (!want || !offer || ['quest'].includes(want.kind)) return say("You can't ask for that.");
        const most = rules().max_commissions_each;
        if (list.filter((x) => x.by === player.display_name).length >= most) return say(`You can only have ${most} commissions up at once.`);
        if (player.inventory.countOf(offer) < offerCount) return say(`You don't have ${offerCount} ${offer.display_name.toLowerCase()} to offer.`);
        player.inventory.remove(offer, offerCount);
        const id = world.next_commission_id++;
        list.push({ id, by: player.display_name, want: want.id, want_count: wantCount, offer: offer.id, offer_count: offerCount, filled_by: '', posted: world.tick });
        say(`You pin up a commission: ${wantCount} × ${want.display_name} wanted, for ${offerCount} × ${offer.display_name}. Your offer is held by the board.`);
        world.announce(`${player.display_name} posted a commission: ${wantCount} × ${want.display_name} wanted, paying ${offerCount} × ${offer.display_name}.`);
        return;
      }
      case 'fill': {
        if (!c || c.filled_by) return say('That commission is gone.');
        if (c.by === player.display_name) return say("That's your own commission.");
        const want = Content.item(c.want);
        const offer = Content.item(c.offer);
        if (player.inventory.countOf(want) < c.want_count) return say(`You need ${c.want_count} ${want.display_name.toLowerCase()} to fill it.`);
        // All at once: their payment must fit once your goods are out.
        const copy = new Inventory();
        copy.slots = player.inventory.slots.map((s) => (s ? new ItemStack(s.item, s.count) : null));
        copy.remove(want, c.want_count);
        if (!copy.add(offer, c.offer_count)) return say("You don't have room for the payment.");
        player.inventory.remove(want, c.want_count);
        player.inventory.add(offer, c.offer_count);
        c.filled_by = player.display_name;
        say(`You fill ${c.by}'s commission and take ${c.offer_count} × ${offer.display_name}.`);
        world.announce(`${player.display_name} filled ${c.by}'s commission for ${c.want_count} × ${want.display_name}.`);
        const poster = world.players().find((p) => p.display_name === c.by);
        if (poster) world.message(poster.id, `${player.display_name} filled your commission. Collect it at the board.`);
        return;
      }
      case 'collect': {
        if (!c || c.by !== player.display_name) return;
        const item = Content.item(c.filled_by ? c.want : c.offer);
        const count = c.filled_by ? c.want_count : c.offer_count;
        if (!Hab.canTake(player, [{ item, count }])) return say("You don't have room for it.");
        player.inventory.add(item, count);
        world.commissions = list.filter((x) => x !== c);
        say(c.filled_by ? `You collect ${count} × ${item.display_name} from the board.` : `You take down your commission and get your ${item.display_name.toLowerCase()} back.`);
      }
    }
  }
}

registerActions(PlacePieceAction, EditPieceAction, CommissionAction);

Hab.checkSets = (world, player) => {
  for (const id of Hab.completeSets(world)) {
    if (world.hab_sets_done.includes(id)) continue;
    world.hab_sets_done.push(id);
    world.announce(Text.get('hab.set_done', { player: player.display_name, set: Hab.setName(id), comfort: rules().set_comfort }));
  }
};

// --- Stations -----------------------------------------------------------------

StationHandlers[StationKind.BOARD] = (world, player, station) => {
  world.emitEvent(player.id, 'open_board', { station: station.id });
};

StationHandlers[StationKind.TROPHY] = (world, player) => {
  const mounted = new Set(world.trophies.map((t) => t.item));
  const stack = player.inventory.slots.find((s) => s && s.item.kind === 'trophy' && !mounted.has(s.item.id));
  if (stack) {
    player.inventory.remove(stack.item, 1);
    world.trophies.push({ item: stack.item.id, by: player.display_name });
    const skill = stack.item.trophy_skill;
    world.announce(`${player.display_name} mounted ${a(stack.item.display_name.toLowerCase())} on the hab's trophy wall.${skill ? ` Everyone gets +${Math.round(rules().trophy_bonus * 100)}% ${skill} XP.` : ''}`);
    return;
  }
  if (!world.trophies.length) {
    const trophies = Object.values(Content.items).filter((i) => i.kind === 'trophy').map((i) => a(i.display_name.toLowerCase()));
    world.message(player.id, Text.get('hab.trophy_wall_bare', { trophies: Text.list(trophies) }));
    return;
  }
  const lines = world.trophies.map((t) => {
    const item = Content.item(t.item);
    return `${item ? item.display_name : t.item} (${t.by}${item && item.trophy_skill ? `, +${Math.round(rules().trophy_bonus * 100)}% ${item.trophy_skill}` : ''})`;
  });
  world.message(player.id, `On the wall: ${lines.join(', ')}.`);
};

// --- The feature --------------------------------------------------------------

function pieceToData(p) {
  return { id: p.id, item: p.item.id, tile: p.tile, rotation: p.rotation, color: p.color, owner: p.owner, bed: p.bed };
}

Features.register({
  id: 'hab',

  init(world) {
    /** id -> HabPiece */
    world.pieces = new Map();
    /** [{ item, by }] on the trophy wall. */
    world.trophies = [];
    /** [{ id, by, want, want_count, offer, offer_count, filled_by, posted }] */
    world.commissions = [];
    world.next_commission_id = 1;
    /** Set ids already announced as complete. */
    world.hab_sets_done = [];
  },

  initPlayer(_world, player) {
    /** Ticks spent in the hab in a row, and when being rested wears off. */
    player.hab_ticks = 0;
    player.rested_until = -1;
  },

  tick(world) {
    const comfort = world.tick % 10 === 0 ? Hab.comfort(world) : null;
    for (const player of world.players()) {
      if (!world.inZone(player.tile, 'hab')) {
        player.hab_ticks = 0;
        continue;
      }
      player.hab_ticks++;
      const r = rules();
      if (player.hab_ticks >= r.rested_after_ticks && player.rested_until < world.tick + r.rested_ticks - r.rested_after_ticks && comfort !== null) {
        if (comfort >= r.rested_comfort) {
          const fresh = player.rested_until <= world.tick;
          player.rested_until = world.tick + r.rested_ticks;
          player.hab_ticks = 0;
          if (fresh) world.message(player.id, Text.get('hab.rested', { bonus: Math.round(r.rested_bonus * 100), minutes: Math.round(r.rested_ticks * TICK_SECONDS / 60) }));
        } else if (player.hab_ticks === r.rested_after_ticks) {
          world.message(player.id, Text.get('hab.too_bare', { comfort, needed: r.rested_comfort }));
        }
      }
    }
  },

  xpAmount(amount, world, entity, skill) {
    if (entity.isNpc()) return amount;
    let bonus = 0;
    if (entity.rested_until > world.tick) bonus += rules().rested_bonus;
    for (const t of world.trophies) {
      const item = Content.item(t.item);
      if (item && item.trophy_skill === skill) bonus += rules().trophy_bonus;
    }
    return amount * (1 + bonus);
  },

  craftTicks(ticks, world, entity, station, recipe) {
    if (world.inZone(station.tile, 'hab') && Hab.fitting(world, 'craft_speed', recipe.skill)) {
      return Math.max(1, Math.round(ticks * rules().craft_speed_factor));
    }
    return ticks;
  },

  afterCraft(world, entity, station, recipe) {
    const rack = world.inZone(station.tile, 'hab') ? Hab.fitting(world, 'save_liquid', recipe.skill) : null;
    if (!rack) return;
    if (world.rng.randf() >= rules().save_liquid_chance) return;
    const saved = recipe.inputs.filter((i) => rules().bed_liquids.includes(i.item.id));
    for (const input of saved) entity.inventory.add(input.item, input.count);
    if (saved.length) world.message(entity.id, `The ${rack.displayName().toLowerCase()} keeps your ${saved.map((i) => i.item.display_name.toLowerCase()).join(' and ')} from going to waste.`);
  },

  save(world) {
    return {
      pieces: [...world.pieces.values()].map(pieceToData),
      trophies: world.trophies,
      commissions: world.commissions,
      next_commission_id: world.next_commission_id,
      sets: world.hab_sets_done,
    };
  },

  load(world, data) {
    for (const p of data.pieces || []) {
      const item = Content.item(p.item);
      if (!item || item.kind !== 'piece') continue;
      if (world.objectAt(p.tile)) continue;
      const piece = Hab.addPiece(world, item, p.tile, p.id);
      Object.assign(piece, { rotation: p.rotation, color: p.color, owner: p.owner, bed: p.bed || piece.bed });
    }
    world.trophies = (data.trophies || []).filter((t) => Content.item(t.item));
    world.commissions = (data.commissions || []).filter((c) => Content.item(c.want) && Content.item(c.offer));
    world.next_commission_id = data.next_commission_id || 1;
    world.hab_sets_done = data.sets || [];
  },

  snapshot(world) {
    return {
      pieces: [...world.pieces.values()].map(pieceToData),
      trophies: world.trophies,
      commissions: world.commissions,
      comfort: Hab.comfort(world),
      sets: Hab.completeSets(world),
    };
  },

  apply(world, data) {
    const seen = new Set();
    for (const p of data.pieces) {
      seen.add(p.id);
      let piece = world.pieces.get(p.id);
      const item = Content.item(p.item);
      if (!item) continue;
      if (!piece) {
        const there = world.objectAt(p.tile);
        if (there && there !== piece) world.removeObject(there.id);
        piece = Hab.addPiece(world, item, p.tile, p.id);
      }
      if (!eq(piece.tile, p.tile)) {
        world._objectTiles.delete(key(piece.tile));
        world._refreshTile(piece.tile);
        piece.tile = { ...p.tile };
        world._objectTiles.set(key(piece.tile), piece);
        world._refreshTile(piece.tile);
      }
      Object.assign(piece, { rotation: p.rotation, color: p.color, owner: p.owner, bed: p.bed });
    }
    for (const id of [...world.pieces.keys()]) if (!seen.has(id)) world.removeObject(id);
    world.trophies = data.trophies;
    world.commissions = data.commissions;
    world.hab_comfort = data.comfort;
    world.hab_sets = data.sets;
  },

  publicPlayer(player) {
    return player.rested_until;
  },

  applyPlayer(_world, player, data) {
    player.rested_until = data;
  },
});
