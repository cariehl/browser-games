// What players carry (28 slots) and keep (storage).

/** What sits in one inventory slot. */
export class ItemStack {
  constructor(item, count = 1) {
    this.item = item;
    this.count = count;
  }
}

/**
 * 28 slots, OSRS-style. Non-stackable items take a slot each; stackable
 * items share one slot per item type.
 *
 * Contained items (vent gas, carried in canisters) are the exception: each
 * slot holds one container's worth, up to the item's capacity. Adding more
 * tops up partly filled slots, then fills empty containers in the inventory;
 * with no container, nothing can be added. Using up a slot's last unit
 * leaves the empty container behind.
 */
export class Inventory {
  static SIZE = 28;

  constructor() {
    /** ItemStack or null per slot. */
    this.slots = new Array(Inventory.SIZE).fill(null);
  }

  freeSlots() {
    let count = 0;
    for (const stack of this.slots) if (stack == null) count++;
    return count;
  }

  canAdd(item, count = 1) {
    if (item.container) return this.containerRoom(item) >= count;
    if (item.stackable) return this._findStack(item) >= 0 || this.freeSlots() > 0;
    return this.freeSlots() >= count;
  }

  /** Adds all or nothing. Returns false if there isn't room. */
  add(item, count = 1) {
    if (!this.canAdd(item, count)) return false;
    if (item.container) {
      this._fillContainers(item, count);
      return true;
    }
    if (item.stackable) {
      const index = this._findStack(item);
      if (index >= 0) this.slots[index].count += count;
      else this.slots[this._firstFree()] = new ItemStack(item, count);
      return true;
    }
    for (let i = 0; i < count; i++) this.slots[this._firstFree()] = new ItemStack(item, 1);
    return true;
  }

  /**
   * Puts a whole stack in as it is, e.g. picking up a gas canister: a
   * contained item brings its container with it, so it takes a free slot
   * instead of needing an empty canister. All or nothing.
   */
  putStack(item, count) {
    if (item.container) {
      if (this.freeSlots() === 0) return false;
      this.slots[this._firstFree()] = new ItemStack(item, count);
      return true;
    }
    return this.add(item, count);
  }

  removeAt(index) {
    if (index < 0 || index >= Inventory.SIZE) return null;
    const stack = this.slots[index];
    this.slots[index] = null;
    return stack;
  }

  /**
   * Removes [count] of an item, from the first slots first. All or nothing:
   * returns false (removing nothing) if there aren't enough.
   */
  remove(item, count = 1) {
    if (this.countOf(item) < count) return false;
    let left = count;
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = this.slots[i];
      if (left === 0) break;
      if (stack == null || stack.item !== item) continue;
      const take = Math.min(stack.count, left);
      stack.count -= take;
      left -= take;
      if (stack.count === 0) {
        // An emptied canister stays in the inventory.
        this.slots[i] = item.container ? new ItemStack(item.container, 1) : null;
      }
    }
    return true;
  }

  countOf(item) {
    let total = 0;
    for (const stack of this.slots) if (stack != null && stack.item === item) total += stack.count;
    return total;
  }

  /** How many more units of a contained item fit. */
  containerRoom(item) {
    let room = 0;
    for (const stack of this.slots) {
      if (stack == null) continue;
      if (stack.item === item) room += Math.max(item.capacity - stack.count, 0);
      else if (stack.item === item.container) room += item.capacity;
    }
    return room;
  }

  _fillContainers(item, count) {
    let left = count;
    // Top up partly filled containers first, so they fill one at a time.
    for (const stack of this.slots) {
      if (left === 0) return;
      if (stack != null && stack.item === item && stack.count < item.capacity) {
        const put = Math.min(item.capacity - stack.count, left);
        stack.count += put;
        left -= put;
      }
    }
    for (let i = 0; i < Inventory.SIZE; i++) {
      if (left === 0) return;
      if (this.slots[i] != null && this.slots[i].item === item.container) {
        const put = Math.min(item.capacity, left);
        this.slots[i] = new ItemStack(item, put);
        left -= put;
      }
    }
  }

  _findStack(item) {
    return this.slots.findIndex((s) => s != null && s.item === item);
  }

  _firstFree() {
    return this.slots.findIndex((s) => s == null);
  }
}

/**
 * A player's storage, reachable from any storage locker. No slot limit, and
 * everything stacks. Items keep the order they were first deposited in.
 * Contained items are stored apart from their containers: a canister holding
 * 37 vent gas is 37 vent gas and 1 canister.
 */
export class Storage {
  constructor() {
    /** ItemDef -> count, in deposit order. */
    this._counts = new Map();
  }

  deposit(item, count) {
    if (count <= 0) return;
    this._counts.set(item, (this._counts.get(item) || 0) + count);
  }

  /** Takes up to [count]; returns how many were taken. */
  withdraw(item, count) {
    const have = this.countOf(item);
    const take = Math.min(have, count);
    if (take <= 0) return 0;
    if (take === have) this._counts.delete(item);
    else this._counts.set(item, have - take);
    return take;
  }

  countOf(item) {
    return this._counts.get(item) || 0;
  }

  /** Everything stored, in deposit order. */
  items() {
    return [...this._counts.keys()];
  }

  find(id) {
    for (const item of this._counts.keys()) if (item.id === id) return item;
    return null;
  }

  isEmpty() {
    return this._counts.size === 0;
  }
}
