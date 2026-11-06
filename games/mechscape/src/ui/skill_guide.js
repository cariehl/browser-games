// OSRS-style skill guide: click a skill in the Skills tab to see what it
// unlocks at each level. Built from the game data (gather nodes, recipes,
// weapons, armor), so it's always current. Unlocks above your level are
// dimmed.

import { ClientState } from '../client/client_state.js';
import { Skills } from '../sim/skills.js';
import { Content } from '../sim/defs.js';
import { Text } from '../sim/text.js';
import { cssColor } from '../view/tile_math.js';
import { el } from './screen.js';
import { commas, onEscape, capitalize } from './common.js';

const GREEN = [0.2, 0.8, 0.25];

export class SkillGuide {
  constructor(parent) {
    this.el = el('div', 'skill-guide panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    const titles = el('div', 'grow', '', header);
    this._title = el('div', 'title', '', titles);
    this._subtitle = el('div', 'subtitle muted', '', titles);
    el('button', '', 'Close', header).addEventListener('click', () => this.close());
    this._note = el('div', 'note muted', '', this.el);
    this._rows = el('div', 'guide-rows', '', this.el);
    onEscape(40, () => this.isOpen(), () => this.close());
  }

  open(skill) {
    const me = ClientState.me();
    const level = me ? me.level(skill) : 1;
    this._title.textContent = `${Skills.displayName(skill)} guide`;
    this._subtitle.textContent = `You: level ${level} · ${commas(me ? me.xp[skill] || 0 : 0)} XP`;
    this._note.textContent = SkillGuide.note(skill);
    this._rows.innerHTML = '';
    for (const entry of SkillGuide.entries(skill)) {
      const row = el('div', entry.level > level ? 'guide-row locked' : 'guide-row', '', this._rows);
      el('div', 'badge', entry.level > 0 ? String(entry.level) : '—', row);
      el('div', 'swatch', '', row).style.background = cssColor(entry.color || [0.5, 0.5, 0.5]);
      const text = el('div', 'grow', '', row);
      el('div', '', entry.name, text);
      el('div', 'muted small', entry.detail || '', text);
    }
    this.el.style.display = '';
  }

  close() {
    this.el.style.display = 'none';
  }

  isOpen() {
    return this.el.style.display !== 'none';
  }

  /** One line under the title about how the skill works (data/skills.json), and for crafting skills the XP per material. */
  static note(skill) {
    const def = Content.skills[skill];
    let text = def ? Text.fill(def.description) : '';
    const xp = new Map();
    for (const recipe of Object.values(Content.recipes)) {
      if (recipe.skill !== skill) continue;
      for (const input of recipe.inputs) if (input.item && input.item.craft_xp > 0) xp.set(input.item.display_name.toLowerCase(), input.item.craft_xp);
    }
    if (xp.size) text += ` XP per unit: ${[...xp].sort((a, b) => a[1] - b[1]).map(([name, n]) => `${name} ${n}`).join(', ')}.`;
    return text;
  }

  /** Everything the skill unlocks, sorted by level: { level, name, detail, color }. Level 0 means "no requirement". */
  static entries(skill) {
    const out = [];
    for (const def of Object.values(Content.nodes)) {
      if (def.skill !== skill) continue;
      let detail = def.loot ? `Gives ${def.lootText()}; ${def.xp} XP each` : '';
      if (def.temporary) detail += '. Left by destroyed mechs';
      if (def.loot && def.loot.container) detail += `. Needs a ${def.loot.container.display_name.toLowerCase()}`;
      out.push({ level: def.level_required, name: def.display_name, detail, color: def.color });
    }
    for (const recipe of Object.values(Content.recipes)) {
      if (recipe.skill !== skill || !recipe.output) continue;
      const inputs = recipe.inputs.map((i) => `${i.count} ${i.item.display_name.toLowerCase()}`).join(', ');
      const made = recipe.displayName() + (recipe.output_count > 1 ? ` ×${recipe.output_count}` : '');
      out.push({ level: recipe.level_required, name: made, detail: `${inputs} · ${recipe.xp} XP`, color: recipe.output.color });
    }
    const items = Object.values(Content.items);
    if (skill === 'melee' || skill === 'firearms') {
      for (const item of items) {
        if (item.isWeapon && item.combatSkill === skill) {
          out.push({ level: item.equip_level, name: item.display_name, detail: `Wield. ${item.weapon_type.display_name}: +${item.accuracy} accuracy, ${item.power} power`, color: item.color });
        }
      }
    }
    if (skill === 'endurance') {
      for (const item of items) {
        if (item.isArmor()) out.push({ level: item.equip_level, name: item.display_name, detail: `Wear. ${capitalize(item.armor_slot)} armor, +${item.defence_bonus} defence`, color: item.color });
      }
    }
    if (skill === 'toughness') {
      const start = Skills.startingLevel(skill);
      out.push({ level: start, name: 'Starting HP', detail: `Everyone starts at Toughness ${start}: ${start} HP`, color: GREEN });
      for (const level of [20, 40, 60, 80, 99]) out.push({ level, name: `${level} HP`, detail: 'One more HP per level', color: GREEN });
    }
    out.sort((a, b) => (a.level !== b.level ? a.level - b.level : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }
}
