// Things a player asks for. Queued between ticks, applied by World at the
// start of the next one. In multiplayer these are what clients send, so each
// is plain data: toJSON() gives { type, ...params } and Action.fromJSON()
// rebuilds it on the other side.

import { Inventory, ItemStack } from './inventory.js';
import { Skills } from './skills.js';
import { AttackTask, CraftTask, GatherTask, StationTask, TakeTask, WreckTask } from './tasks.js';
import { GatherNode, Station, Wreck } from './objects.js';
import { TICK_SECONDS } from './constants.js';

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

  /** A cheat for testing. The alpha server will refuse these unless allowed. */
  isDebug() {
    return false;
  }

  apply(_world, _entity) {}

  toJSON() {
    const out = { type: this.constructor.TYPE, seq: this.seq };
    for (const [k, v] of Object.entries(this)) if (!k.startsWith('_') && k !== 'seq') out[k] = v;
    return out;
  }

  static fromJSON(data) {
    const cls = ACTION_TYPES[data.type];
    if (!cls) return null;
    const action = Object.create(cls.prototype);
    Object.assign(action, data);
    delete action.type;
    action._unique = nextUnique++;
    return action;
  }
}

/** Walk (or run) to a tile. */
export class MoveAction extends Action {
  static TYPE = 'move';
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
  constructor(targetId) {
    super();
    this.target_id = targetId;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const target = world.entities.get(this.target_id);
    // No fighting other players (no PvP in the alpha).
    if (!target || target.isDead() || target === entity || !target.isNpc()) return;
    entity.path = [];
    entity.task = new AttackTask(this.target_id);
  }
}

/** Clicked a world object: walk beside it, then gather, open its menu, or salvage your wreck. */
export class InteractAction extends Action {
  static TYPE = 'interact';
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
  constructor(run) {
    super();
    this.run = run;
  }
  slot() { return 'run'; }
  apply(_world, entity) {
    entity.running = this.run;
  }
}

/** Where combat XP goes: the weapon's skill, or Endurance. */
export class SetCombatStyleAction extends Action {
  static TYPE = 'set_combat_style';
  constructor(trainEndurance) {
    super();
    this.train_endurance = trainEndurance;
  }
  slot() { return 'style'; }
  apply(_world, entity) {
    entity.train_endurance = this.train_endurance;
  }
}

/** Swap two inventory slots (dragging). Either may be empty. */
export class SwapItemsAction extends Action {
  static TYPE = 'swap_items';
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
    } else {
      return;
    }
    entity.inventory.slots[this.slot_index] = previous ? new ItemStack(previous) : null;
  }
}

/** Take off the weapon ('weapon') or the armor in one slot. */
export class UnequipAction extends Action {
  static TYPE = 'unequip';
  static WEAPON = 'weapon';
  constructor(equipSlot = 'weapon') {
    super();
    this.equip_slot = equipSlot;
  }
  slot() { return `unequip_${this.equip_slot}`; }
  apply(world, entity) {
    const weapon = this.equip_slot === UnequipAction.WEAPON;
    const item = weapon ? entity.weapon : entity.armor[this.equip_slot];
    if (!item) return;
    if (!entity.inventory.add(item)) {
      world.message(entity.id, "You don't have enough inventory space to do that.");
      return;
    }
    if (weapon) entity.weapon = null;
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

/** Debug only: grant XP in a skill. */
export class DebugGrantXpAction extends Action {
  static TYPE = 'debug_grant_xp';
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

export const ACTION_TYPES = Object.fromEntries([
  MoveAction, AttackAction, InteractAction, CraftAction, TakeAction, SetRunAction, SetCombatStyleAction,
  SwapItemsAction, DropAction, EquipAction, UnequipAction, UseItemAction, DepositAction, DepositAllAction,
  WithdrawAction, DebugGrantXpAction,
].map((cls) => [cls.TYPE, cls]));
