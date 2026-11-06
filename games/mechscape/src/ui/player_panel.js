// OSRS-style side panel (bottom-right, tabs along its bottom) with three tabs:
//   Inventory: HP and the 28 slots. Click a weapon or armor to equip it, an
//     injector to inject it; drag to move; shift-click or right-click an
//     item to drop it.
//   Gear: the wielded weapon, worn armor (click to take off), where combat
//     XP goes, and the resulting attack and defence numbers.
//   Skills: every skill in the design, grouped by economy slice. Skills the
//     game implements are lit; planned ones are dimmed. Hover a skill for
//     its XP; click it for the skill guide.

import { ClientState } from '../client/client_state.js';
import { Inventory, ItemStack } from '../sim/inventory.js';
import { Skills, MELEE, ENDURANCE } from '../sim/skills.js';
import { Combat } from '../sim/combat.js';
import {
  SwapItemsAction, DropAction, EquipAction, UseItemAction, UnequipAction, SetCombatStyleAction,
} from '../sim/actions.js';
import { cssColor } from '../view/tile_math.js';
import { el } from './screen.js';
import { ITEM_COLOR, commas, short, capitalize, withIds } from './common.js';
import { InspectInfo } from './inspect_info.js';
import { lookOptions } from './examine.js';
import { COSMETIC_PARTS, CallPetAction, DismissPetAction } from '../sim/appearance.js';

/**
 * The full skill list from the design doc, so the menu shows its eventual
 * shape. Only Skills.ALL are trainable for now.
 */
const ROSTER = [
  ['Combat', ['melee', 'unarmed', 'firearms', 'explosives', 'toughness', 'endurance']],
  ['Combat support', ['hunting']],
  ['Gathering', ['salvaging', 'drilling', 'siphoning', 'xenobiology', 'decryption']],
  ['Manufacturing', ['engineering', 'splicing', 'implants', 'limbs']],
];
const ARMOR_SLOTS = ['head', 'torso', 'legs', 'arms'];
/** A press becomes a drag once the mouse moves this far. */
const DRAG_THRESHOLD = 6;
/** Pending predictions give up after this long, as a safety net. */
const PREDICTION_MS = 5000;

export class PlayerPanel {
  constructor(parent, { link, menu, inspector, hover, guide, build, extraTabs = [] }) {
    this.link = link;
    this.menu = menu;
    this.inspector = inspector;
    this.hover = hover;
    this.guide = guide;
    this.build = build;
    this.el = el('div', 'player-panel panel', '', parent);

    const tabs = el('div', 'tabs', '', this.el);
    /** More tabs from elsewhere (quests): { name, build(page), update(me) }. */
    this._extraTabs = extraTabs;
    this._tabButtons = ['Inventory', 'Gear', 'Skills', ...extraTabs.map((t) => t.name)].map((name, i) => {
      const button = el('button', 'tab', name, tabs);
      button.addEventListener('click', () => this._showTab(i));
      return button;
    });
    this._pages = this._tabButtons.map(() => el('div', 'page', '', this.el));

    /** Inventory slot under the mouse, or -1. */
    this._hoveredSlot = -1;
    this._pressSlot = -1;
    this._pressPos = [0, 0];
    this._dragging = false;
    this._grab = [0, 0];
    /**
     * Inventory actions sent but not yet applied by the sim (swap, drop,
     * equip, use), shown straight away so the inventory reacts on the click,
     * not the tick. Each: { seq, kind, a, b, until }. One is done once the
     * sim has applied that seq (EntityState.last_action_seq).
     */
    this._pending = [];
    /** The inventory as shown: the sim's slots with pending actions applied. */
    this._shown = [];
    /** The style the player just picked, until the sim confirms it (or 3s pass). */
    this._stylePending = -1;
    this._stylePendingUntil = 0;
    this._shiftHeld = false;

    this._buildInventory(this._pages[0]);
    this._buildGear(this._pages[1]);
    this._buildSkills(this._pages[2]);
    extraTabs.forEach((tab, i) => tab.build(this._pages[3 + i]));
    this._showTab(0);

    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this._shiftHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this._shiftHeld = false;
    });
    window.addEventListener('blur', () => {
      this._shiftHeld = false;
    });
  }

  get me() {
    return ClientState.me();
  }

  _showTab(index) {
    this._tab = index;
    this._pages.forEach((page, i) => {
      page.style.display = i === index ? '' : 'none';
    });
    this._tabButtons.forEach((button, i) => button.classList.toggle('active', i === index));
  }

  // --- Inventory ----------------------------------------------------------

  _buildInventory(page) {
    const hpRow = el('div', 'hp-row', '', page);
    this._hpLabel = el('span', 'hp-label', '', hpRow);
    const bar = el('div', 'bar', '', hpRow);
    this._hpFill = el('div', 'fill', '', bar);

    const grid = el('div', 'inventory-grid', '', page);
    this._slots = [];
    for (let i = 0; i < Inventory.SIZE; i++) {
      const slot = el('div', 'slot', '', grid);
      const icon = el('div', 'icon', '', slot);
      const name = el('div', 'name', '', slot);
      slot.addEventListener('pointerdown', (e) => this._onSlotDown(e, i));
      slot.addEventListener('pointerenter', () => {
        this._hoveredSlot = i;
      });
      slot.addEventListener('pointerleave', () => {
        if (this._hoveredSlot === i) {
          this._hoveredSlot = -1;
          this.hover.setUiOption(null);
        }
      });
      this._slots.push({ slot, icon, name });
    }
    el('div', 'hint muted', 'Click to equip, inject or place · drag to move\nRight-click for options, shift-click to drop', page);

    // Follows the mouse while dragging an item.
    this._dragIcon = el('div', 'drag-icon', '', document.body);
    this._dragLabel = el('div', 'name', '', this._dragIcon);
    this._dragIcon.style.display = 'none';
  }

  _updateInventory(me) {
    this._hpLabel.textContent = `HP ${me.hp} / ${me.maxHp()}`;
    this._hpFill.style.width = `${(100 * me.hp) / me.maxHp()}%`;
    this._updateShown(me);
    const target = this._dragging ? this._slotAt(this._mouse) : -1;
    for (let i = 0; i < Inventory.SIZE; i++) {
      const stack = this._shown[i];
      const { slot, icon, name } = this._slots[i];
      // Light up where a dragged item would land.
      slot.classList.toggle('target', this._dragging && i !== this._pressSlot && i === target);
      // The slot being dragged from shows faintly, like OSRS.
      const faded = this._dragging && i === this._pressSlot;
      icon.style.opacity = name.style.opacity = faded ? '0.3' : '1';
      icon.style.display = stack ? '' : 'none';
      if (!stack) {
        name.textContent = '';
        continue;
      }
      icon.style.background = cssColor(stack.item.color);
      name.textContent = slotText(stack);
    }
    this._updateItemHover();
  }

  /**
   * Hover text for the inventory slot under the mouse, in the same style as
   * the world's: the left-click action, how many more options a right click
   * has, and a line of stats.
   */
  _updateItemHover() {
    if (this._hoveredSlot < 0 || this._tab !== 0) return;
    const stack = this._shown[this._hoveredSlot];
    if (!stack || this._dragging) {
      this.hover.setUiOption(null);
      return;
    }
    const item = stack.item;
    const options = this._itemOptions(this._hoveredSlot, item, 0, 0);
    if (this._shiftHeld) {
      // Shift-click drops, so say so while shift is held.
      const drop = options.find((o) => o.verb === 'Drop');
      this.hover.setUiOption(drop, options.length - 2, itemDetail(stack));
      return;
    }
    if (item.isWeapon || item.isArmor() || item.isConsumable() || ['piece', 'pet', 'cosmetic'].includes(item.kind)) {
      // Left click injects, wields, wears, places or calls a pet; the rest (minus Cancel) are "more".
      this.hover.setUiOption(options[0], options.length - 2, itemDetail(stack));
    } else {
      // Nothing happens on a left click, so just name it.
      this.hover.setUiOption(withIds([{ verb: '', target: item.display_name, color: ITEM_COLOR }], item.id)[0], options.length - 1, itemDetail(stack));
    }
  }

  /** Slot indexes sent to the sim are the slots as shown (pending swaps were sent first, so they land first). */
  _onSlotDown(e, index) {
    const stack = this._shown[index];
    if (e.button === 2) {
      e.preventDefault();
      if (stack) this.menu.open(this._itemOptions(index, stack.item, e.clientX, e.clientY), e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0 || !stack) return;
    e.preventDefault();
    if (e.shiftKey) {
      this._drop(index);
      return;
    }
    // Wait for the release: it's a click, or the end of a drag.
    this._pressSlot = index;
    this._pressPos = [e.clientX, e.clientY];
    this._dragging = false;
  }

  _onPointerMove(e) {
    this._mouse = [e.clientX, e.clientY];
    if (this._pressSlot < 0) return;
    if (!this._dragging && Math.hypot(e.clientX - this._pressPos[0], e.clientY - this._pressPos[1]) > DRAG_THRESHOLD) this._startDrag();
    if (this._dragging) {
      this._dragIcon.style.left = `${e.clientX - this._grab[0]}px`;
      this._dragIcon.style.top = `${e.clientY - this._grab[1]}px`;
    }
  }

  _onPointerUp(e) {
    if (e.button !== 0 || this._pressSlot < 0) return;
    const from = this._pressSlot;
    this._pressSlot = -1;
    if (this._dragging) {
      this._dragging = false;
      this._dragIcon.style.display = 'none';
      const to = this._slotAt([e.clientX, e.clientY]);
      if (to >= 0 && to !== from) this._swap(from, to);
    } else {
      this._clickItem(from);
    }
  }

  _startDrag() {
    const stack = this._shown[this._pressSlot];
    if (!stack) {
      this._pressSlot = -1;
      return;
    }
    this._dragging = true;
    const rect = this._slots[this._pressSlot].icon.getBoundingClientRect();
    this._grab = [
      Math.min(Math.max(this._pressPos[0] - rect.left, 0), rect.width),
      Math.min(Math.max(this._pressPos[1] - rect.top, 0), rect.height),
    ];
    this._dragIcon.style.left = `${this._pressPos[0] - this._grab[0]}px`;
    this._dragIcon.style.top = `${this._pressPos[1] - this._grab[1]}px`;
    this._dragIcon.style.background = cssColor(stack.item.color);
    this._dragLabel.textContent = slotText(stack);
    this._dragIcon.style.display = '';
    this.hover.setUiOption(null);
  }

  /** The inventory slot under a screen position, or -1. */
  _slotAt(at) {
    if (!at || this._tab !== 0) return -1;
    for (let i = 0; i < this._slots.length; i++) {
      const r = this._slots[i].slot.getBoundingClientRect();
      if (at[0] >= r.left && at[0] <= r.right && at[1] >= r.top && at[1] <= r.bottom) return i;
    }
    return -1;
  }

  _swap(a, b) {
    if (!this._shown[a] && !this._shown[b]) return;
    this._sendPredicted(new SwapItemsAction(a, b), { kind: 'swap', a, b });
  }

  _drop(index) {
    this._sendPredicted(new DropAction(index), { kind: 'drop', a: index });
  }

  _equip(index) {
    this._sendPredicted(new EquipAction(index), { kind: 'equip', a: index });
  }

  _use(index) {
    this._sendPredicted(new UseItemAction(index), { kind: 'use', a: index });
  }

  /** Left-click: inject a consumable, otherwise wield or wear. */
  _clickItem(index) {
    const stack = this._shown[index];
    if (stack && stack.item.isConsumable()) this._use(index);
    else if (stack && stack.item.kind === 'piece' && this.build) this.build.place(index);
    else if (stack && stack.item.kind === 'pet') this.link.send(ClientState.localPlayerId, new CallPetAction(index));
    else this._equip(index);
  }

  /** Sends an inventory action and shows its effect at once. */
  _sendPredicted(action, op) {
    this.link.send(ClientState.localPlayerId, action);
    op.seq = action.seq;
    op.until = performance.now() + PREDICTION_MS;
    this._pending.push(op);
  }

  /** The sim's slots, replayed with every pending action on top. */
  _updateShown(me) {
    this._shown = [...me.inventory.slots];
    const now = performance.now();
    this._pending = this._pending.filter((op) => op.seq > me.last_action_seq && now <= op.until);
    let weapon = me.weapon;
    const armor = { ...me.armor };
    for (const op of this._pending) {
      const a = op.a;
      if (op.kind === 'swap') {
        [this._shown[a], this._shown[op.b]] = [this._shown[op.b], this._shown[a]];
      } else if (op.kind === 'drop') {
        this._shown[a] = null;
      } else if (op.kind === 'use') {
        // Shown at once; if the sim refuses (still recovering from the last
        // one) the slot snaps back when this op drops off.
        const used = this._shown[a];
        if (!used || !used.item.isConsumable()) continue;
        this._shown[a] = used.item.leaves ? new ItemStack(used.item.leaves, 1) : null;
      } else if (op.kind === 'equip') {
        const stack = this._shown[a];
        if (!stack) continue;
        const item = stack.item;
        const skill = item.equipSkill();
        if (!skill || me.level(skill) < item.equip_level) continue; // The sim will refuse it.
        let previous;
        if (item.isWeapon) {
          previous = weapon;
          weapon = item;
        } else {
          previous = armor[item.armor_slot];
          armor[item.armor_slot] = item;
        }
        this._shown[a] = previous ? new ItemStack(previous) : null;
      }
    }
  }

  /** An item's options, the left-click one first. */
  _itemOptions(index, item, x, y) {
    const options = [];
    if (item.isConsumable()) options.push({ verb: item.use_verb, target: item.display_name, color: ITEM_COLOR, action: () => this._use(index) });
    else if (item.isWeapon) options.push({ verb: 'Wield', target: item.display_name, color: ITEM_COLOR, action: () => this._equip(index) });
    else if (item.isArmor()) options.push({ verb: 'Wear', target: item.display_name, color: ITEM_COLOR, action: () => this._equip(index) });
    else if (item.kind === 'cosmetic') options.push({ verb: 'Wear', target: item.display_name, color: ITEM_COLOR, action: () => this.link.send(ClientState.localPlayerId, new EquipAction(index)) });
    else if (item.kind === 'piece' && this.build) options.push({ verb: 'Place', target: item.display_name, color: ITEM_COLOR, action: () => this.build.place(index) });
    else if (item.kind === 'pet') options.push({ verb: 'Call', target: item.display_name, color: ITEM_COLOR, action: () => this.link.send(ClientState.localPlayerId, new CallPetAction(index)) });
    else if (item.lore) options.push({ verb: 'Read', target: item.display_name, color: ITEM_COLOR, action: () => this.inspector.open(() => InspectInfo.lore(item), x, y, false) });
    options.push({ verb: 'Drop', target: item.display_name, color: ITEM_COLOR, action: () => this._drop(index) });
    options.push(...lookOptions({
      link: this.link, inspector: this.inspector, target: item.display_name, color: ITEM_COLOR, x, y,
      source: () => InspectInfo.item(item, ClientState.me()), live: false, kind: 'item', defId: item.id,
    }));
    options.push({ verb: 'Cancel', action: null });
    return withIds(options, item.id);
  }

  // --- Gear ---------------------------------------------------------------

  _buildGear(page) {
    page.classList.add('gear');
    el('div', 'muted small', 'Weapon', page);
    this._weaponButton = el('button', 'gear-button', '', page);
    this._weaponButton.addEventListener('click', () => this.link.send(ClientState.localPlayerId, new UnequipAction()));
    this._stylePicker = el('select', 'style-picker', '', page);
    for (const text of ['Combat XP: weapon skill', 'Combat XP: Endurance']) el('option', '', text, this._stylePicker);
    this._stylePicker.addEventListener('change', () => {
      const index = this._stylePicker.selectedIndex;
      this._stylePending = index;
      this._stylePendingUntil = performance.now() + 3000;
      this.link.send(ClientState.localPlayerId, new SetCombatStyleAction(index === 1));
      this._stylePicker.blur();
    });
    el('div', 'muted small', 'Armor', page);
    this._armorButtons = {};
    for (const slot of ARMOR_SLOTS) {
      const button = el('button', 'gear-button', '', page);
      button.addEventListener('click', () => this.link.send(ClientState.localPlayerId, new UnequipAction(slot)));
      this._armorButtons[slot] = button;
    }
    el('div', 'muted small', 'Cosmetics', page);
    this._cosmeticButtons = {};
    for (const part of COSMETIC_PARTS) {
      const button = el('button', 'gear-button', '', page);
      button.addEventListener('click', () => this.link.send(ClientState.localPlayerId, new UnequipAction(part)));
      this._cosmeticButtons[part] = button;
    }
    this._petButton = el('button', 'gear-button', '', page);
    this._petButton.addEventListener('click', () => this.link.send(ClientState.localPlayerId, new DismissPetAction()));
    el('hr', '', '', page);
    this._statsLabel = el('div', 'muted small pre', '', page);
  }

  _updateGear(me) {
    for (const part of COSMETIC_PARTS) {
      const item = me.cosmetics && me.cosmetics[part];
      setText(this._cosmeticButtons[part], `${capitalize(part)}: ${item ? item.display_name : 'nothing'}`);
      this._cosmeticButtons[part].title = item ? 'Click to take off' : '';
    }
    setText(this._petButton, `Pet: ${me.pet ? me.pet.display_name : 'none'}`);
    this._petButton.title = me.pet ? 'Click to put it back in your pack' : 'Pets are very rare finds. Use one from your pack to call it out.';
    for (const slot of ARMOR_SLOTS) {
      const button = this._armorButtons[slot];
      const item = me.armor[slot];
      setText(button, `${capitalize(slot)}: ${item ? item.display_name : 'nothing'}`);
      button.title = item ? `+${item.defence_bonus} defence\nClick to take off` : '';
    }
    const p = Combat.profile(me);
    setText(this._statsLabel, `Combat level: ${Combat.level(me)}\n`
      + `Attack: ${Skills.displayName(p.skill)} ${p.attack_level}, +${p.accuracy} accuracy\n`
      + `Max hit ${p.max_hit}, every ${p.speed} ticks, range ${p.reach}\n`
      + `Defence: Endurance ${me.level(ENDURANCE)}, +${me.armorBonus()} from armor`);
    if (me.weapon) {
      setText(this._weaponButton, `Wielding: ${me.weapon.display_name}`);
      this._weaponButton.title = `${Skills.displayName(me.weapon.combatSkill)} · speed ${me.weapon.attackSpeed} ticks · range ${me.weapon.attackRange}\nClick to unwield`;
    } else {
      setText(this._weaponButton, 'Wielding: nothing (fists)');
      this._weaponButton.title = '';
    }
    setText(this._stylePicker.options[0], `Combat XP: ${Skills.displayName(me.weapon ? me.weapon.combatSkill : MELEE)}`);
    const confirmed = me.train_endurance ? 1 : 0;
    if (this._stylePending >= 0) {
      if (confirmed === this._stylePending || performance.now() > this._stylePendingUntil) this._stylePending = -1;
      else return; // Leave the player's pick showing until the sim catches up.
    }
    if (this._stylePicker.selectedIndex !== confirmed) this._stylePicker.selectedIndex = confirmed;
  }

  // --- Skills -------------------------------------------------------------

  _buildSkills(page) {
    page.classList.add('skills');
    /** skill id -> { tile, level, fill } */
    this._skillTiles = {};
    for (const [group, skills] of ROSTER) {
      el('div', 'muted small', group, page);
      const grid = el('div', 'skill-grid', '', page);
      for (const skill of skills) {
        const live = Skills.ALL.includes(skill);
        const tile = el('div', live ? 'skill-tile live' : 'skill-tile planned', '', grid);
        const row = el('div', 'skill-row', '', tile);
        el('span', 'skill-name', Skills.displayName(skill), row);
        const level = el('span', 'skill-level', '1', row);
        const bar = el('div', 'bar', '', tile);
        const fill = el('div', 'fill', '', bar);
        if (live) tile.addEventListener('click', () => this.guide.open(skill));
        else tile.title = `${Skills.displayName(skill)}\nPlanned, not in the game yet.`;
        this._skillTiles[skill] = { tile, level, fill };
      }
    }
    el('hr', '', '', page);
    this._totalLabel = el('div', '', '', page);
  }

  _updateSkills(me) {
    let total = 0;
    for (const [, skills] of ROSTER) {
      for (const skill of skills) {
        const level = me.level(skill);
        total += level;
        if (!Skills.ALL.includes(skill)) continue;
        const parts = this._skillTiles[skill];
        const xp = me.xp[skill] || 0;
        // Boosted skills show their boosted level in green, like OSRS.
        const boost = me.boostOf(skill);
        setText(parts.level, String(level + boost));
        parts.level.classList.toggle('boosted', boost > 0);
        if (level >= Skills.MAX_LEVEL) {
          parts.fill.style.width = '100%';
          parts.tile.title = `${Skills.displayName(skill)}\nXP: ${commas(xp)}`;
          continue;
        }
        const floor = Skills.xpForLevel(level);
        const next = Skills.xpForLevel(level + 1);
        parts.fill.style.width = `${(100 * (xp - floor)) / (next - floor)}%`;
        parts.tile.title = `${Skills.displayName(skill)}\nXP: ${commas(xp)}\nNext level at: ${commas(next)}\nRemaining: ${commas(next - xp)}\nClick for the skill guide`;
      }
    }
    setText(this._totalLabel, `Total level: ${total}   ·   Combat level: ${Combat.level(me)}`);
  }

  // --- Shared -------------------------------------------------------------

  update() {
    const me = this.me;
    if (!me) return;
    if (this._tab === 0) this._updateInventory(me);
    else if (this._tab === 1) this._updateGear(me);
    else if (this._tab === 2) this._updateSkills(me);
    else this._extraTabs[this._tab - 3].update(me);
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function slotText(stack) {
  const item = stack.item;
  // A canister: show how full it is.
  if (item.container) return `${item.abbreviation}\n${stack.count}/${item.capacity}`;
  return item.abbreviation + (stack.count > 1 ? `\n${short(stack.count)}` : '');
}

function itemDetail(stack) {
  let detail = itemStats(stack);
  const item = stack.item;
  const skill = item.equipSkill();
  if (skill && item.equip_level > 1) detail += ` · needs ${Skills.displayName(skill)} ${item.equip_level}`;
  return detail;
}

function itemStats(stack) {
  const item = stack.item;
  if (item.container) return `${stack.count}/${item.capacity} in a ${item.container.display_name.toLowerCase()}`;
  if (item.isWeapon) return `${item.weapon_type.display_name} · +${item.accuracy} accuracy · ${item.power} power · every ${item.attackSpeed} ticks`;
  if (item.isArmor()) return `${capitalize(item.armor_slot)} armor · +${item.defence_bonus} defence`;
  if (item.isConsumable()) return `Heals ${item.heal} HP · delays your next attack ${item.use_delay_ticks} ticks`;
  if (stack.count > 1) return `${commas(stack.count)} in this stack`;
  return '';
}
