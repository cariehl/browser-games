// Things a player asks for. Queued between ticks, applied by World at the
// start of the next one. In multiplayer these are what clients send, so each
// is plain data: toJSON() gives { type, ...params } and Action.fromJSON()
// rebuilds it on the other side.

import { Inventory, ItemStack } from './inventory.js';
import { Skills } from './skills.js';
import { AttackTask, CraftTask, GatherTask, StationTask, TakeTask, WreckTask } from './tasks.js';
import { GatherNode, Station, Wreck } from './objects.js';
import { TICK_SECONDS } from './constants.js';
import { Trading, TRADE_RANGE, REQUEST_TICKS } from './trade.js';
import { chebyshev } from './grid.js';
import { Content } from './defs.js';

let nextUnique = 1;

export class Action {
  constructor() {
    /**
     * Order the client sent it in (1, 2, 3...). The World applies a tick's
     * actions in this order and records the latest on the entity, so the
     * client knows which of its predictions have landed. 0 = unnumbered.
     */
    this.seq = 0;
    this._unique = nextUnique++;
  }

  /** Actions in the same slot replace each other (latest click wins). */
  slot() {
    return 'default';
  }

  /**
   * Whether this stops what the entity is doing. Clicking somewhere or
   * something cancels; inventory changes, toggles and injecting don't.
   */
  cancelsTask() {
    return false;
  }

  /** Whether an open trade survives this. Anything else calls it off (it might change the inventory). */
  keepsTrade() {
    return false;
  }

  /** Whether an open dialogue stays open when this is applied (chat, run toggles). */
  keepsDialogue() {
    return this.keepsTrade();
  }

  /** Fields fromJSON() accepts, by kind ('int', 'bool', 'id' or 'tile'). */
  static FIELDS = {};

  /** A cheat for testing. The server refuses these unless debug is on. */
  isDebug() {
    return false;
  }

  apply(_world, _entity) {}

  toJSON() {
    const out = { type: this.constructor.TYPE, seq: this.seq };
    for (const [k, v] of Object.entries(this)) if (!k.startsWith('_') && k !== 'seq') out[k] = v;
    return out;
  }

  /**
   * Rebuilds an action from data a client sent. Returns null if the data
   * isn't a well-formed action: unknown type, missing or wrongly typed
   * fields. Only the fields the type declares (FIELDS) are copied, so a
   * client can't smuggle anything else in. Whether the action makes sense
   * (in reach, owned, affordable) is still each apply()'s job.
   */
  static fromJSON(data) {
    if (typeof data !== 'object' || data == null) return null;
    const cls = Object.hasOwn(ACTION_TYPES, data.type) ? ACTION_TYPES[data.type] : null;
    if (!cls) return null;
    const action = Object.create(cls.prototype);
    action.seq = Number.isSafeInteger(data.seq) && data.seq >= 0 ? data.seq : 0;
    for (const [name, kind] of Object.entries(cls.FIELDS)) {
      const value = readField(kind, data[name]);
      if (value === undefined) return null;
      action[name] = value;
    }
    action._unique = nextUnique++;
    return action;
  }
}

const MAX_INT = 1 << 30;
/** Longest chat line, in characters. */
export const MAX_CHAT = 120;

/** Checks one field against its kind. Returns the value to use, or undefined if it's bad. */
function readField(kind, value) {
  switch (kind) {
    case 'int': return Number.isSafeInteger(value) && Math.abs(value) <= MAX_INT ? value : undefined;
    case 'bool': return typeof value === 'boolean' ? value : undefined;
    case 'id': return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
    case 'tile': {
      if (typeof value !== 'object' || value == null) return undefined;
      const { x, y } = value;
      return Number.isSafeInteger(x) && Number.isSafeInteger(y) && Math.abs(x) <= 100000 && Math.abs(y) <= 100000 ? { x, y } : undefined;
    }
    case 'text': return cleanText(value);
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    default: throw new Error(`unknown field kind ${kind}`);
  }
}

/** A line of text a player typed, tidied: control characters out, runs of spaces squashed. Undefined if blank or too long. */
export function cleanText(value, max = MAX_CHAT) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 && text.length <= max ? text : undefined;
}

/** Walk (or run) to a tile. */
export class MoveAction extends Action {
  static TYPE = 'move';
  static FIELDS = { target: 'tile' };
  constructor(target) {
    super();
    this.target = { ...target };
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    // An unreachable target simply does nothing.
    entity.path = world.findPath(entity.tile, this.target);
  }
}

/** Clicked an NPC: chase and fight it. */
export class AttackAction extends Action {
  static TYPE = 'attack';
  static FIELDS = { target_id: 'int' };
  constructor(targetId) {
    super();
    this.target_id = targetId;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const target = world.entities.get(this.target_id);
    if (!target || target.isDead() || target === entity) return;
    // No fighting other players (no PvP in the alpha), though a paintball is fair game.
    if (!target.isNpc() && !(entity.weapon && entity.weapon.fun_effect)) return;
    if (target.isNpc() && !target.def.attackable) {
      world.message(entity.id, "You can't attack that.");
      return;
    }
    entity.path = [];
    entity.task = new AttackTask(this.target_id);
  }
}

/** Clicked a world object: walk beside it, then gather, open its menu, or salvage your wreck. */
export class InteractAction extends Action {
  static TYPE = 'interact';
  static FIELDS = { object_id: 'int' };
  constructor(objectId) {
    super();
    this.object_id = objectId;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const target = world.getObject(this.object_id);
    if (!target) return;
    if (target instanceof Wreck && target.owner_id !== entity.id) {
      world.message(entity.id, "That isn't yours to salvage.");
      return;
    }
    entity.path = [];
    const onWreck = target instanceof Wreck && target.tile.x === entity.tile.x && target.tile.y === entity.tile.y;
    if (!target.isAdjacent(entity.tile) && !onWreck) {
      entity.path = world.pathToAdjacent(entity.tile, target);
      if (entity.path.length === 0) {
        world.message(entity.id, "I can't reach that.");
        return;
      }
    }
    if (target instanceof GatherNode) entity.task = new GatherTask(this.object_id);
    else if (target instanceof Station) entity.task = new StationTask(this.object_id);
    else if (target instanceof Wreck) entity.task = new WreckTask(this.object_id);
  }
}

/** Picked a recipe in a station's menu: make [count] of it (-1 = All). */
export class CraftAction extends Action {
  static TYPE = 'craft';
  static FIELDS = { station_id: 'int', recipe_index: 'int', count: 'int' };
  static ALL = -1;
  constructor(stationId, recipeIndex, count) {
    super();
    this.station_id = stationId;
    this.recipe_index = recipeIndex;
    this.count = count;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const station = world.stations.get(this.station_id);
    if (!station || this.recipe_index < 0 || this.recipe_index >= station.def.recipes.length) return;
    if (this.count === 0 || this.count < CraftAction.ALL) return;
    // Server-side validation: the client could claim anything.
    if (!station.isAdjacent(entity.tile)) {
      world.message(entity.id, `You need to be next to the ${station.def.display_name.toLowerCase()}.`);
      return;
    }
    entity.path = [];
    entity.task = new CraftTask(this.station_id, station.def.recipes[this.recipe_index], this.count);
  }
}

/** Clicked an item on the ground: walk onto its tile and pick it up. */
export class TakeAction extends Action {
  static TYPE = 'take';
  static FIELDS = { ground_id: 'int' };
  constructor(groundId) {
    super();
    this.ground_id = groundId;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const ground = world.ground_items.get(this.ground_id);
    if (!ground) return;
    entity.path = [];
    if (entity.tile.x !== ground.tile.x || entity.tile.y !== ground.tile.y) {
      entity.path = world.findPath(entity.tile, ground.tile);
      if (entity.path.length === 0) {
        world.message(entity.id, "I can't reach that.");
        return;
      }
    }
    entity.task = new TakeTask(this.ground_id);
  }
}

/** Toggle between walking (1 tile/tick) and running (2 tiles/tick). */
export class SetRunAction extends Action {
  static TYPE = 'set_run';
  static FIELDS = { run: 'bool' };
  constructor(run) {
    super();
    this.run = run;
  }
  slot() { return 'run'; }
  keepsTrade() { return true; }
  apply(_world, entity) {
    entity.running = this.run;
  }
}

/** Where combat XP goes: the weapon's skill, or Endurance. */
export class SetCombatStyleAction extends Action {
  static TYPE = 'set_combat_style';
  static FIELDS = { train_endurance: 'bool' };
  constructor(trainEndurance) {
    super();
    this.train_endurance = trainEndurance;
  }
  slot() { return 'style'; }
  keepsTrade() { return true; }
  apply(_world, entity) {
    entity.train_endurance = this.train_endurance;
  }
}

/** Swap two inventory slots (dragging). Either may be empty. */
export class SwapItemsAction extends Action {
  static TYPE = 'swap_items';
  static FIELDS = { from_index: 'int', to_index: 'int' };
  constructor(from, to) {
    super();
    this.from_index = from;
    this.to_index = to;
  }
  slot() { return `swap_${this._unique}`; }
  apply(_world, entity) {
    const slots = entity.inventory.slots;
    const { from_index: a, to_index: b } = this;
    if (a < 0 || b < 0 || a >= Inventory.SIZE || b >= Inventory.SIZE) return;
    [slots[a], slots[b]] = [slots[b], slots[a]];
  }
}

/** Drop the item in one slot onto your tile. */
export class DropAction extends Action {
  static TYPE = 'drop';
  static FIELDS = { slot_index: 'int' };
  constructor(slotIndex) {
    super();
    this.slot_index = slotIndex;
  }
  slot() { return `drop_${this._unique}`; }
  apply(world, entity) {
    const stack = entity.inventory.removeAt(this.slot_index);
    if (stack) world.dropItem(stack.item, stack.count, entity.tile);
  }
}

/** Wield the weapon, or wear the armor, in a slot. A straight swap with what was equipped. */
export class EquipAction extends Action {
  static TYPE = 'equip';
  static FIELDS = { slot_index: 'int' };
  constructor(slotIndex) {
    super();
    this.slot_index = slotIndex;
  }
  slot() { return `equip_${this._unique}`; }
  apply(world, entity) {
    if (this.slot_index < 0 || this.slot_index >= Inventory.SIZE) return;
    const stack = entity.inventory.slots[this.slot_index];
    if (!stack) return;
    const item = stack.item;
    const skill = item.equipSkill();
    if (skill !== '' && entity.level(skill) < item.equip_level) {
      world.message(entity.id, `You need ${Skills.withArticle(skill)} level of ${item.equip_level} to ${item.isWeapon ? 'wield' : 'wear'} the ${item.display_name.toLowerCase()}.`);
      return;
    }
    let previous = null;
    if (item.isWeapon) {
      previous = entity.weapon;
      entity.weapon = item;
    } else if (item.isArmor()) {
      previous = entity.armor[item.armor_slot] || null;
      entity.armor[item.armor_slot] = item;
    } else if (item.kind === 'cosmetic' && entity.cosmetics) {
      previous = entity.cosmetics[item.cosmetic_part] || null;
      entity.cosmetics[item.cosmetic_part] = item;
    } else {
      return;
    }
    entity.inventory.slots[this.slot_index] = previous ? new ItemStack(previous) : null;
  }
}

/** Take off the weapon ('weapon') or the armor in one slot. */
export class UnequipAction extends Action {
  static TYPE = 'unequip';
  static FIELDS = { equip_slot: 'id' };
  static WEAPON = 'weapon';
  constructor(equipSlot = 'weapon') {
    super();
    this.equip_slot = equipSlot;
  }
  slot() { return `unequip_${this.equip_slot}`; }
  apply(world, entity) {
    const weapon = this.equip_slot === UnequipAction.WEAPON;
    const cosmetic = entity.cosmetics && Object.hasOwn(entity.cosmetics, this.equip_slot);
    if (!weapon && !cosmetic && !Object.hasOwn(entity.armor, this.equip_slot)) return;
    const item = weapon ? entity.weapon : cosmetic ? entity.cosmetics[this.equip_slot] : entity.armor[this.equip_slot];
    if (!item) return;
    if (!entity.inventory.add(item)) {
      world.message(entity.id, "You don't have enough inventory space to do that.");
      return;
    }
    if (weapon) entity.weapon = null;
    else if (cosmetic) delete entity.cosmetics[this.equip_slot];
    else delete entity.armor[this.equip_slot];
  }
}

/**
 * Use a consumable: inject a healing injector (heals at once) or a boost
 * injector. Like eating in OSRS: pushes the next attack back by the item's
 * use delay, and another can't be used until that delay has passed.
 */
export class UseItemAction extends Action {
  static TYPE = 'use_item';
  static FIELDS = { slot_index: 'int' };
  constructor(slotIndex) {
    super();
    this.slot_index = slotIndex;
  }
  slot() { return `use_${this._unique}`; }
  apply(world, entity) {
    if (entity.isDead() || this.slot_index < 0 || this.slot_index >= Inventory.SIZE) return;
    const stack = entity.inventory.slots[this.slot_index];
    if (!stack || !stack.item.isConsumable()) return;
    if (world.tick < entity.next_use_tick) return; // Still recovering; OSRS ignores the click too.
    const item = stack.item;
    const before = entity.hp;
    entity.hp = Math.min(entity.hp + item.heal, entity.maxHp());
    stack.count--;
    if (stack.count <= 0) entity.inventory.slots[this.slot_index] = item.leaves ? new ItemStack(item.leaves, 1) : null;
    entity.next_use_tick = world.tick + item.use_delay_ticks;
    entity.next_attack_tick = Math.max(entity.next_attack_tick, world.tick) + item.use_delay_ticks;
    const used = `You ${item.use_verb.toLowerCase()} the ${item.display_name.toLowerCase()}.`;
    if (item.heal > 0) {
      world.message(entity.id, `${used} It heals ${entity.hp - before} HP.`);
      world.emitEvent(entity.id, 'heal', { entity: entity.id, amount: entity.hp - before });
    }
    if (item.boost_skill !== '') {
      const amount = item.boostFor(entity.level(item.boost_skill));
      entity.boosts[item.boost_skill] = { amount, until: world.tick + item.boost_ticks };
      world.message(entity.id, `${used} Your ${Skills.displayName(item.boost_skill)} is boosted by ${amount} for ${Math.round(item.boost_ticks * TICK_SECONDS / 60)} minutes.`);
      world.emitEvent(entity.id, 'boost', { entity: entity.id, skill: item.boost_skill, amount });
    }
    world.emitEvent(entity.id, 'use_item', { entity: entity.id, item: item.id });
  }
}

/**
 * Put the item in one slot into storage: [count] of it from across the
 * inventory (ALL for every one). For contained items the count is canisters.
 * Only next to a storage locker.
 */
export class DepositAction extends Action {
  static TYPE = 'deposit';
  static FIELDS = { slot_index: 'int', count: 'int' };
  static ALL = -1;
  constructor(slotIndex, count = -1) {
    super();
    this.slot_index = slotIndex;
    this.count = count;
  }
  slot() { return `deposit_${this._unique}`; }
  apply(world, entity) {
    if (!entity.storage || !world.storageInReach(entity.tile)) return;
    const slots = entity.inventory.slots;
    if (this.slot_index < 0 || this.slot_index >= Inventory.SIZE || !slots[this.slot_index]) return;
    const item = slots[this.slot_index].item;
    let left = this.count !== DepositAction.ALL ? this.count : Inventory.SIZE * 1000000;
    // The clicked slot first, then the rest in order.
    const order = [this.slot_index];
    for (let i = 0; i < Inventory.SIZE; i++) if (i !== this.slot_index) order.push(i);
    for (const i of order) {
      if (left <= 0) break;
      const stack = slots[i];
      if (!stack || stack.item !== item) continue;
      if (item.stackable && !item.container) {
        const put = Math.min(stack.count, left);
        DepositAction.depositFromSlot(entity, i, put);
        left -= put;
      } else {
        DepositAction.depositFromSlot(entity, i, stack.count);
        left -= 1;
      }
    }
  }

  /** Moves [amount] from one slot into storage; a container goes in alongside its contents. */
  static depositFromSlot(entity, index, amount) {
    const stack = entity.inventory.slots[index];
    entity.storage.deposit(stack.item, amount);
    stack.count -= amount;
    if (stack.count > 0) return;
    entity.inventory.slots[index] = null;
    if (stack.item.container) entity.storage.deposit(stack.item.container, 1);
  }
}

/** Put the whole inventory into storage. */
export class DepositAllAction extends Action {
  static TYPE = 'deposit_all';
  static FIELDS = {};
  slot() { return 'deposit_all'; }
  apply(world, entity) {
    if (!entity.storage || !world.storageInReach(entity.tile)) return;
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = entity.inventory.slots[i];
      if (stack) DepositAction.depositFromSlot(entity, i, stack.count);
    }
  }
}

/** Take [count] of a stored item out (ALL for as many as fit). */
export class WithdrawAction extends Action {
  static TYPE = 'withdraw';
  static FIELDS = { item_id: 'id', count: 'int' };
  static ALL = -1;
  constructor(itemId, count = 1) {
    super();
    this.item_id = itemId;
    this.count = count;
  }
  slot() { return `withdraw_${this._unique}`; }
  apply(world, entity) {
    if (!entity.storage || !world.storageInReach(entity.tile)) return;
    const item = entity.storage.find(this.item_id);
    if (!item) return;
    const stored = entity.storage.countOf(item);
    const want = this.count === WithdrawAction.ALL ? stored : Math.min(this.count, stored);
    const take = Math.min(want, WithdrawAction.roomFor(entity.inventory, item));
    if (take <= 0) {
      if (item.container) world.message(entity.id, `You need an empty ${item.container.display_name.toLowerCase()} to carry that.`);
      else world.message(entity.id, "You don't have room for that.");
      return;
    }
    entity.storage.withdraw(item, take);
    entity.inventory.add(item, take);
    if (take < want) world.message(entity.id, "You don't have room for any more.");
  }

  static roomFor(inventory, item) {
    if (item.container) return inventory.containerRoom(item);
    if (item.stackable) return inventory.canAdd(item) ? 1 << 30 : 0;
    return inventory.freeSlots();
  }
}

/**
 * Say something in public chat. Everyone online sees it in their chatbox,
 * and players nearby see it over your head for a few seconds.
 */
export class ChatAction extends Action {
  static TYPE = 'chat';
  static FIELDS = { text: 'text' };
  /** At most this many lines... */
  static BURST = 5;
  /** ...in this many ticks. */
  static BURST_TICKS = 10;
  constructor(text) {
    super();
    this.text = text;
  }
  slot() { return `chat_${this._unique}`; }
  keepsTrade() { return true; }
  apply(world, entity) {
    const text = cleanText(this.text);
    if (entity.isNpc() || !text) return;
    const recent = (entity._chatTicks || []).filter((t) => world.tick - t < ChatAction.BURST_TICKS);
    if (recent.length >= ChatAction.BURST) {
      world.message(entity.id, "You're talking too fast. Wait a moment.");
      entity._chatTicks = recent;
      return;
    }
    recent.push(world.tick);
    entity._chatTicks = recent;
    world.emitEvent(entity.id, 'chat', { entity: entity.id, name: entity.display_name, text });
  }
}

/**
 * Ask another player to trade, or say yes to their asking. A trade opens
 * when both have asked each other.
 */
export class TradeRequestAction extends Action {
  static TYPE = 'trade_request';
  static FIELDS = { target_id: 'int' };
  constructor(targetId) {
    super();
    this.target_id = targetId;
  }
  slot() { return 'trade_request'; }
  apply(world, entity) {
    const target = world.entities.get(this.target_id);
    if (!target || target === entity || !target.isPlayer() || !entity.isPlayer()) return;
    if (Trading.of(world, entity)) return;
    if (chebyshev(target.tile, entity.tile) > TRADE_RANGE || world.areaIdAt(target.tile) !== world.areaIdAt(entity.tile)) {
      world.message(entity.id, `${target.display_name} is too far away to trade with.`);
      return;
    }
    if (Trading.of(world, target)) {
      world.message(entity.id, `${target.display_name} is busy trading.`);
      return;
    }
    const theirs = target.trade_request;
    if (theirs && theirs.target === entity.id && world.tick <= theirs.until) {
      Trading.open(world, target, entity);
      return;
    }
    entity.trade_request = { target: target.id, until: world.tick + REQUEST_TICKS };
    world.message(entity.id, `Sending a trade offer to ${target.display_name}...`);
    world.emitEvent(target.id, 'trade_request', { from: entity.id, name: entity.display_name });
  }
}

/** Offer [count] of the item in inventory slot [slot_index] (-1 = all of it). */
export class TradeOfferAction extends Action {
  static TYPE = 'trade_offer';
  static FIELDS = { slot_index: 'int', count: 'int' };
  constructor(slotIndex, count = -1) {
    super();
    this.slot_index = slotIndex;
    this.count = count;
  }
  slot() { return `trade_offer_${this._unique}`; }
  keepsTrade() { return true; }
  apply(world, entity) {
    Trading.offer(world, entity, this.slot_index, this.count);
  }
}

/** Take back [count] of an item from your offer (-1 = all of it). */
export class TradeRemoveAction extends Action {
  static TYPE = 'trade_remove';
  static FIELDS = { item_id: 'id', count: 'int' };
  constructor(itemId, count = -1) {
    super();
    this.item_id = itemId;
    this.count = count;
  }
  slot() { return `trade_remove_${this._unique}`; }
  keepsTrade() { return true; }
  apply(world, entity) {
    Trading.withdraw(world, entity, this.item_id, this.count);
  }
}

/** Accept the trade as it stands at [stage] (1: the offer, 2: the final check). */
export class TradeAcceptAction extends Action {
  static TYPE = 'trade_accept';
  static FIELDS = { stage: 'int' };
  constructor(stage) {
    super();
    this.stage = stage;
  }
  slot() { return 'trade_accept'; }
  keepsTrade() { return true; }
  apply(world, entity) {
    Trading.accept(world, entity, this.stage);
  }
}

/** Decline: close the trade window for both. */
export class TradeCancelAction extends Action {
  static TYPE = 'trade_cancel';
  static FIELDS = {};
  slot() { return 'trade_cancel'; }
  keepsTrade() { return true; }
  apply(world, entity) {
    const trade = Trading.of(world, entity);
    if (!trade) return;
    world.message(trade.partnerOf(entity.id), `${entity.display_name} declined the trade.`);
    Trading.cancel(world, trade);
  }
}

/** Debug only: grant XP in a skill. */
export class DebugGrantXpAction extends Action {
  static TYPE = 'debug_grant_xp';
  static FIELDS = { skill: 'id', amount: 'int' };
  constructor(skill, amount) {
    super();
    this.skill = skill;
    this.amount = amount;
  }
  slot() { return `debug_xp_${this._unique}`; }
  isDebug() { return true; }
  apply(world, entity) {
    world.grantXp(entity, this.skill, this.amount);
  }
}

/** Debug: jump to a tile (walkable ones only). */
export class DebugTeleportAction extends Action {
  static TYPE = 'debug_teleport';
  static FIELDS = { target: 'tile' };
  constructor(target) {
    super();
    this.target = target;
  }
  slot() { return 'move'; }
  isDebug() { return true; }
  apply(world, entity) {
    if (world.isWalkable(this.target)) world.travel(entity, this.target);
  }
}

/** Debug: conjure items. */
export class DebugGiveAction extends Action {
  static TYPE = 'debug_give';
  static FIELDS = { item_id: 'id', count: 'int' };
  constructor(itemId, count = 1) {
    super();
    this.item_id = itemId;
    this.count = count;
  }
  slot() { return `debug_give_${this._unique}`; }
  isDebug() { return true; }
  apply(world, entity) {
    const item = Content.item(this.item_id);
    if (item) entity.inventory.add(item, Math.max(1, Math.min(this.count, 1000)));
  }
}

export const ACTION_TYPES = Object.fromEntries([
  MoveAction, AttackAction, InteractAction, CraftAction, TakeAction, SetRunAction, SetCombatStyleAction,
  SwapItemsAction, DropAction, EquipAction, UnequipAction, UseItemAction, DepositAction, DepositAllAction,
  WithdrawAction, ChatAction, TradeRequestAction, TradeOfferAction, TradeRemoveAction, TradeAcceptAction,
  TradeCancelAction, DebugGrantXpAction, DebugTeleportAction, DebugGiveAction,
].map((cls) => [cls.TYPE, cls]));

/** Lets a feature module (quests, the mech, the hab...) add its own actions. */
export function registerActions(...classes) {
  for (const cls of classes) ACTION_TYPES[cls.TYPE] = cls;
}
