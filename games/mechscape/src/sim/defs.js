// Content definitions: what the data/*.json files hold, with the same
// defaults the Godot resources had, and the registry that looks them up by
// id. Field names match the data files (snake_case) so the JSON reads
// straight across; behaviour is in methods.
//
// Content is plain data, so the same registry loads in the browser (from
// fetched JSON) and in Node (tests, a future headless server).

import { capitalize } from './skills.js';

function assign(target, defaults, raw) {
  Object.assign(target, defaults, raw);
  return target;
}

export class WeaponTypeDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '',
      /** Which skill it trains and uses: melee or firearms. */
      combat_skill: 'melee',
      /** Ticks between attacks. */
      attack_speed: 4,
      /** 1 = melee (must stand on a tile touching the target's side); more = tiles of range. */
      attack_range: 1,
      /** Frames (30 fps) from the start of the player's attack clip to the strike. */
      attack_windup_frames: 0,
    }, raw);
  }

  resolve() {}
}

export class ItemDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '', stackable: false,
      color: [0.5, 0.5, 0.5, 1], abbreviation: '',
      // Weapon: speed, range and skill come from the type.
      weapon_type: null, accuracy: 0, power: 0, ammo: null,
      // Armor: "none", "head", "torso", "legs" or "arms".
      armor_slot: 'none', defence_bonus: 0,
      /** Level needed to wield (weapons: their combat skill) or wear (armor: Endurance). */
      equip_level: 1,
      /** Manufacturing XP for each unit used in a recipe. */
      craft_xp: 0,
      // Consumable.
      heal: 0, use_verb: 'Use', use_delay_ticks: 3, leaves: null,
      boost_skill: '', boost_base: 0, boost_percent: 0, boost_ticks: 500,
      // Container: gas carried in canisters.
      container: null, capacity: 0,
    }, raw);
  }

  resolve(content) {
    this.weapon_type = content.ref('weaponTypes', this.weapon_type);
    this.ammo = content.ref('items', this.ammo);
    this.leaves = content.ref('items', this.leaves);
    this.container = content.ref('items', this.container);
  }

  get isWeapon() { return this.weapon_type != null; }
  get combatSkill() { return this.weapon_type ? this.weapon_type.combat_skill : 'melee'; }
  get attackSpeed() { return this.weapon_type ? this.weapon_type.attack_speed : 4; }
  get attackRange() { return this.weapon_type ? this.weapon_type.attack_range : 1; }

  /** The skill equip_level is checked against, or '' if it can't be equipped. */
  equipSkill() {
    if (this.isWeapon) return this.combatSkill;
    if (this.isArmor()) return 'endurance';
    return '';
  }

  isConsumable() { return this.heal > 0 || this.boost_skill !== ''; }
  isArmor() { return this.armor_slot !== 'none' && this.armor_slot !== ''; }

  /** Levels this item's boost adds on top of [level]. */
  boostFor(level) {
    return this.boost_base + Math.trunc(level * this.boost_percent / 100);
  }
}

export class GatherNodeDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '', skill: 'salvaging', verb: 'salvage',
      level_required: 1, xp: 10, loot: null, rare_loot: null, rare_chance: 0,
      action_ticks: 4, deplete_chance: 0.15, max_successes: 0, respawn_ticks: 10,
      temporary: false, lifetime_ticks: 0,
      chance_low: 64, chance_high: 200,
      blocks_movement: true, blocks_sight: false,
      model: null, depleted_model: null, model_scale: 1,
      look: 'wreck', color: [0.5, 0.5, 0.5, 1], size: 1,
    }, raw);
  }

  resolve(content) {
    this.loot = content.ref('items', this.loot);
    this.rare_loot = content.ref('items', this.rare_loot);
  }

  /** Everything a success can give, common first. */
  possibleLoot() {
    const out = [];
    if (this.loot) out.push(this.loot);
    if (this.rare_loot && this.rare_chance > 0) out.push(this.rare_loot);
    return out;
  }

  /** "scrap metal, sometimes relic circuitry (30%)" */
  lootText() {
    if (!this.loot) return 'nothing';
    let text = this.loot.display_name.toLowerCase();
    if (this.rare_loot && this.rare_chance > 0) {
      text += `, sometimes ${this.rare_loot.display_name.toLowerCase()} (${Math.round(this.rare_chance * 100)}%)`;
    }
    return text;
  }

  /** OSRS-style: a chance out of 256, linear in level from chance_low (1) to chance_high (99). */
  successChance(level) {
    const l = Math.min(Math.max(level, 1), 99);
    return (1 + Math.floor(this.chance_low * (99 - l) / 98 + this.chance_high * (l - 1) / 98 + 0.5)) / 256;
  }
}

export class NpcDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '',
      hitpoints: 10, attack_level: 1, accuracy: 0, max_hit: 1, attack_speed: 5, attack_range: 1,
      defence_level: 1, defence_bonus: 0,
      /** What drives it; null for the standard brain. */
      brain: null,
      /** False for people you talk to (and pets): nobody can attack them, and they never fight. */
      attackable: true,
      /** Dialogue id when you can talk to it (see data/dialogue.json), or ''. */
      talk: '',
      aggressive: false, aggro_radius: 3, wander_radius: 3, leash_radius: 8, respawn_ticks: 30,
      husk: null,
      /** Dropped on the ground on death, each line rolled separately: [{item, min_count, max_count, chance}] */
      drops: [],
      model: null, model_scale: 1, walk_cycle_distance: 2, attack_windup_frames: 0,
      color: [0.5, 0.3, 0.28, 1], size: 1,
    }, raw);
  }

  resolve(content) {
    this.husk = content.ref('nodes', this.husk);
    this.drops = (this.drops || []).map((d) => ({
      min_count: 1, max_count: 1, chance: 1, ...d, item: content.ref('items', d.item),
    }));
  }
}

export class RecipeDef {
  constructor(raw) {
    assign(this, {
      id: '', skill: 'engineering', level_required: 1,
      /** [{ item, count }] */
      inputs: [], output: null, output_count: 1, action_ticks: 4,
    }, raw);
  }

  resolve(content) {
    this.inputs = this.inputs.map((input) => ({ count: 1, ...input, item: content.ref('items', input.item) }));
    this.output = content.ref('items', this.output);
  }

  /** XP per batch: each input's craft_xp times how many are used, rounded. */
  get xp() {
    let total = 0;
    for (const input of this.inputs) if (input.item) total += input.item.craft_xp * input.count;
    return Math.round(total);
  }

  displayName() { return this.output ? this.output.display_name : this.id; }

  hasMaterials(inventory) { return this.maxMakeable(inventory) > 0; }

  maxMakeable(inventory) {
    let most = 1 << 30;
    for (const input of this.inputs) most = Math.min(most, Math.floor(inventory.countOf(input.item) / input.count));
    return most;
  }

  /** Removes one batch of inputs. Returns false (removing nothing) if short. */
  consume(inventory) {
    if (!this.hasMaterials(inventory)) return false;
    for (const input of this.inputs) inventory.remove(input.item, input.count);
    return true;
  }

  /** Puts one batch of inputs back (used when the output doesn't fit). */
  refund(inventory) {
    for (const input of this.inputs) inventory.add(input.item, input.count);
  }
}

export const StationKind = { CRAFT: 'craft', STORAGE: 'storage', RESPAWN: 'respawn', PORTAL: 'portal' };

export class StationDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '', description: '', skill: 'engineering', recipes: [],
      kind: StationKind.CRAFT,
      blocks_movement: true, blocks_sight: false,
      model: null, model_scale: 1, color: [0.45, 0.38, 0.3, 1],
    }, raw);
  }

  resolve(content) {
    this.recipes = this.recipes.map((id) => content.ref('recipes', id));
  }
}

export class TerrainDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '', blocks_movement: true, blocks_sight: true,
      color: [0.45, 0.42, 0.4, 1], height: 1.2,
    }, raw);
  }

  resolve() {}
}

/** A prop drawn on the map that blocks nothing and isn't part of the sim: scrap piles, lamps, cables. */
export class DecorDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '',
      /** Which procedural model draws it (see view/decor_view.js). */
      shape: 'scrap_pile',
      color: [0.4, 0.38, 0.36, 1], accent: [1, 0.6, 0.2, 1], scale: 1,
      /** A light it gives off: { color, intensity, distance }, or null. */
      light: null,
    }, raw);
  }

  resolve() {}
}

/** A kind of ground: what the floor of a tile looks like. */
export class GroundDef {
  constructor(raw) {
    assign(this, {
      id: '', display_name: '', color: [0.36, 0.4, 0.33, 1],
      /** How much each tile's colour wanders from it (0..1). */
      variation: 0.06,
      /** Grid lines drawn on it. */
      lines: true,
      /** Glows a little (fungus), 0..1. */
      glow: 0,
    }, raw);
  }

  resolve() {}
}

const KINDS = {
  weaponTypes: WeaponTypeDef,
  items: ItemDef,
  nodes: GatherNodeDef,
  npcs: NpcDef,
  recipes: RecipeDef,
  stations: StationDef,
  terrain: TerrainDef,
  decor: DecorDef,
  ground: GroundDef,
};

/** The data file each kind lives in (data/<file>.json). */
export const CONTENT_FILES = {
  weaponTypes: 'weapon_types', items: 'items', nodes: 'nodes', npcs: 'npcs',
  recipes: 'recipes', stations: 'stations', terrain: 'terrain', decor: 'decor', ground: 'ground',
};

/** Items whose id changed: old id -> new id, so old saves still find them. */
const RENAMED_ITEMS = Object.assign(Object.create(null), { gas_canister: 'canister' });

/**
 * Looks up game content by id. Saves and maps store ids, never object
 * references, so content can be edited without breaking them.
 */
export const Content = {
  loaded: false,

  /** [bundle]: kind -> { id -> raw data }, kinds as in CONTENT_FILES. */
  load(bundle) {
    for (const [kind, cls] of Object.entries(KINDS)) {
      this[kind] = Object.create(null); // Ids come from saves and clients; no inherited keys.
      for (const [id, raw] of Object.entries(bundle[kind] || {})) this[kind][id] = new cls(raw);
    }
    for (const kind of Object.keys(KINDS)) {
      for (const def of Object.values(this[kind])) def.resolve(this);
    }
    this.loaded = true;
  },

  ref(kind, id) {
    if (id == null || id === '') return null;
    if (typeof id === 'object') return id;
    const def = this[kind][id];
    if (!def) throw new Error(`No ${kind} with id "${id}"`);
    return def;
  },

  item(id) { return this.items[RENAMED_ITEMS[id] || id] || null; },
  nodeDef(id) { return this.nodes[id] || null; },

  /** The definition for a map legend kind ("terrain", "node", "station", "npc"). */
  forMapKind(kind, id) {
    const table = {
      terrain: this.terrain, node: this.nodes, station: this.stations, npc: this.npcs, decor: this.decor, ground: this.ground,
    }[kind];
    return table ? table[id] || null : null;
  },
};

export { capitalize };
