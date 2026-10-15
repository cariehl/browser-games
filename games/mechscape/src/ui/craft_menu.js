// OSRS-style "make" menu for a crafting station.
//
// Opens when the sim reports the player has reached a station
// (open_station event). Each recipe shows its level and materials, red where
// you fall short. Picking 1, 5 or All sends a CraftAction and closes the
// menu. Esc or the close button closes it too, and so does walking away.
//
// A station that makes more than one kind of thing gets tabs (Weapons,
// Armor, Supplies), and the list scrolls once it's taller than
// MAX_LIST_SCREEN of the screen. Each station remembers its last tab.
// Right-click a recipe to make some, or to Inspect or Examine what it makes.

import { ClientState } from '../client/client_state.js';
import { Skills } from '../sim/skills.js';
import { CraftAction } from '../sim/actions.js';
import { cssColor } from '../view/tile_math.js';
import { el } from './screen.js';
import { onEscape, ITEM_COLOR, withIds } from './common.js';
import { InspectInfo } from './inspect_info.js';
import { lookOptions } from './examine.js';

const MAX_LIST_SCREEN = 0.55;
const TAB_ORDER = ['Weapons', 'Armor', 'Supplies'];

export class CraftMenu {
  constructor(parent, link, { menu = null, inspector = null } = {}) {
    this.link = link;
    this.menu = menu;
    this.inspector = inspector;
    this.el = el('div', 'craft-menu panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    this._title = el('div', 'title grow', '', header);
    el('button', '', 'Close', header).addEventListener('click', () => this.close());
    el('div', 'muted', 'What would you like to make? Right-click one to inspect it.', this.el);
    this._tabs = el('div', 'tabs', '', this.el);
    this._list = el('div', 'craft-list', '', this.el);
    this._station = null;
    /** station def id -> last tab name */
    this._lastTab = {};
    /** Per recipe: { row, level, inputs, tab } */
    this._rows = [];
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_station') {
          const station = ClientState.world.stations.get(event.data.station);
          if (station) this.open(station);
        }
      }
    });
    onEscape(30, () => this.isOpen(), () => this.close());
  }

  /** Which tab a recipe goes under, from what it makes. */
  static tabFor(recipe) {
    if (recipe.output && recipe.output.isWeapon) return 'Weapons';
    if (recipe.output && recipe.output.isArmor()) return 'Armor';
    return 'Supplies';
  }

  open(station) {
    this._station = station;
    this._title.textContent = `${station.def.display_name}  ·  ${Skills.displayName(station.def.skill)}`;
    this._list.innerHTML = '';
    this._rows = [];
    const names = [];
    station.def.recipes.forEach((recipe, index) => {
      const tab = CraftMenu.tabFor(recipe);
      if (!names.includes(tab)) names.push(tab);
      this._rows.push({ ...this._makeRow(recipe, index), tab });
    });
    names.sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b));
    this._tabNames = names;
    this._tabs.innerHTML = '';
    this._tabButtons = names.map((name, i) => {
      const button = el('button', 'tab', name, this._tabs);
      button.addEventListener('click', () => this._showTab(i));
      return button;
    });
    this._tabs.style.display = names.length > 1 ? '' : 'none';
    this._showTab(Math.max(names.indexOf(this._lastTab[station.def.id] || ''), 0));
    this.el.style.display = '';
    this._list.style.maxHeight = `${window.innerHeight * MAX_LIST_SCREEN}px`;
    this._refresh();
  }

  _showTab(index) {
    const name = this._tabNames[index] || '';
    if (this._station) this._lastTab[this._station.def.id] = name;
    this._tabButtons.forEach((b, i) => b.classList.toggle('active', i === index));
    for (const row of this._rows) row.row.style.display = this._tabNames.length <= 1 || row.tab === name ? '' : 'none';
    this._list.scrollTop = 0;
  }

  close() {
    this.el.style.display = 'none';
    this._station = null;
  }

  isOpen() {
    return this._station != null;
  }

  update() {
    if (!this._station) return;
    const me = ClientState.me();
    if (!me || !this._station.isAdjacent(me.tile)) {
      this.close();
      return;
    }
    this._refresh();
  }

  _makeRow(recipe, index) {
    const row = el('div', 'craft-row', '', this._list);
    el('div', 'swatch big', '', row).style.background = cssColor(recipe.output.color);
    const text = el('div', 'grow', '', row);
    el('div', '', recipe.displayName() + (recipe.output_count > 1 ? `  ×${recipe.output_count}` : ''), text);
    const level = el('div', 'small', '', text);
    const inputs = el('div', 'small', '', text);
    const counts = [['1', 1], ['5', 5], ['All', CraftAction.ALL]];
    for (const [label, count] of counts) {
      el('button', 'count', label, row).addEventListener('click', () => this._choose(index, count));
    }
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 || !this.menu) return;
      e.preventDefault();
      e.stopPropagation();
      const name = recipe.output.display_name;
      const options = counts.map(([label, count]) => ({ verb: `Make ${label}`, target: name, color: ITEM_COLOR, action: () => this._choose(index, count) }));
      options.push(...lookOptions({
        link: this.link, inspector: this.inspector, target: name, color: ITEM_COLOR, x: e.clientX, y: e.clientY,
        source: () => InspectInfo.item(recipe.output, ClientState.me()), live: false, kind: 'item', defId: recipe.output.id,
      }));
      options.push({ verb: 'Cancel', action: null });
      this.menu.open(withIds(options, recipe.output.id), e.clientX, e.clientY);
    });
    return { row, level, inputs };
  }

  /** Level and materials, red where the player falls short. */
  _refresh() {
    const me = ClientState.me();
    this._station.def.recipes.forEach((recipe, i) => {
      const parts = this._rows[i];
      const levelOk = me.level(recipe.skill) >= recipe.level_required;
      setText(parts.level, `Level ${recipe.level_required} ${Skills.displayName(recipe.skill)}  ·  ${recipe.xp} XP`);
      parts.level.className = levelOk ? 'small muted' : 'small short';
      let haveAll = true;
      const bits = recipe.inputs.map((input) => {
        const have = me.inventory.countOf(input.item);
        haveAll = haveAll && have >= input.count;
        return `${input.count} ${input.item.display_name.toLowerCase()} (${have})`;
      });
      setText(parts.inputs, bits.join(', '));
      parts.inputs.className = haveAll ? 'small muted' : 'small short';
      parts.row.style.opacity = levelOk && haveAll ? '1' : '0.6';
    });
  }

  _choose(index, count) {
    if (!this._station) return;
    this.link.send(ClientState.localPlayerId, new CraftAction(this._station.id, index, count));
    this.close();
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
