// What "Inspect" shows for each kind of thing: the stats a player could
// reasonably see or work out, plus odds worked out against their own stats.
// Read-only: it only looks at the World and the data.
//
// Each function returns { title, subtitle, rows: [[label, value, warn?], ...] },
// or null when the thing is gone.

import { Combat } from '../sim/combat.js';
import { Skills } from '../sim/skills.js';
import { Content } from '../sim/defs.js';
import { ticks, capitalize } from './common.js';

const pct = (x) => Math.round(x * 100);

export const InspectInfo = {
  npc(world, npc, me) {
    if (!npc || !world.entities.has(npc.id)) return null;
    const def = npc.def;
    const rows = [];
    if (npc.isDead()) {
      if (npc.waitingForHusk()) rows.push(['Status', `Destroyed; back ${ticks(def.respawn_ticks)} after its husk is gone`]);
      else rows.push(['Status', `Destroyed, back in ${ticks(npc.dead_until - world.tick)}`]);
    } else {
      rows.push(['Hitpoints', `${npc.hp} / ${npc.maxHp()}`]);
    }
    rows.push(['Attack', `level ${def.attack_level}, +${def.accuracy} accuracy, max hit ${def.max_hit}`]);
    rows.push(['Attack speed', `every ${ticks(def.attack_speed)}`]);
    rows.push(['Range', def.attack_range <= 1 ? 'melee' : `${def.attack_range} tiles`]);
    rows.push(['Defence', `level ${def.defence_level}, +${def.defence_bonus}`]);
    rows.push(['Behaviour', def.aggressive ? `aggressive within ${def.aggro_radius} tiles` : 'fights back when attacked']);
    if (def.husk) rows.push(['Leaves', `${def.husk.display_name} (${Skills.displayName(def.husk.skill)} ${def.husk.level_required})`]);
    if (me) {
      const mine = Combat.profile(me);
      const [defLevel, defBonus] = Combat.defence(me);
      const myChance = Combat.hitChance(mine.attack_level, mine.accuracy, def.defence_level, def.defence_bonus);
      const itsChance = Combat.hitChance(def.attack_level, def.accuracy, defLevel, defBonus);
      rows.push(['You hit it', `${pct(myChance)}% of the time, up to ${mine.max_hit}`]);
      rows.push(['It hits you', `${pct(itsChance)}% of the time, up to ${def.max_hit}`, def.max_hit >= me.hp]);
    }
    return { title: def.display_name, subtitle: 'Hostile mech', rows };
  },

  gatherNode(world, node, me) {
    if (!node || !world.nodes.has(node.id)) return null;
    const def = node.def;
    const rows = [];
    const level = me ? me.level(def.skill) : 1;
    rows.push(['Requires', `${Skills.displayName(def.skill)} ${def.level_required} (you: ${level})`, level < def.level_required]);
    rows.push(['Gives', def.loot ? `${sentence(def.lootText())}; ${def.xp} XP each` : 'nothing']);
    if (def.loot && def.loot.container) {
      rows.push(['Needs', `an empty ${def.loot.container.display_name.toLowerCase()}`, !!me && me.inventory.containerRoom(def.loot) === 0]);
    }
    rows.push(['Attempts', `every ${ticks(def.action_ticks)}`]);
    rows.push(['Your success', level >= def.level_required ? `${pct(def.successChance(level))}% per attempt` : 'too low a level']);
    if (def.temporary) {
      const haul = def.max_successes > 0 ? `1 to ${def.max_successes} salvages` : `until stripped (${pct(def.deplete_chance)}% per success)`;
      rows.push(['Lasts', `${haul}, or ${node.expire_tick >= 0 ? ticks(node.expire_tick - world.tick) : 'a while'}`]);
    } else if (def.deplete_chance <= 0) {
      rows.push(['Depletes', 'never']);
    } else {
      rows.push(['Depletes', `${pct(def.deplete_chance)}% per success, back in ${ticks(def.respawn_ticks)}`]);
    }
    if (node.isDepleted(world.tick) && !def.temporary) {
      rows.push(['Status', `stripped bare, back in ${ticks(node.respawn_tick - world.tick)}`, true]);
    }
    return { title: def.display_name, subtitle: `${Skills.displayName(def.skill)} node`, rows };
  },

  /** People, pets and mechs: who they are (hostiles show their stats instead, see npc()). */
  person(world, npc) {
    if (!npc || !world.entities.has(npc.id)) return null;
    return { title: npc.def.display_name, subtitle: npc.def.description || '', rows: [] };
  },

  /** Scenery (decor props, rocks): a name and a line about it. */
  scenery(def) {
    return { title: def.display_name, subtitle: def.description || '', rows: [] };
  },

  station(world, station) {
    if (!station || !world.stations.has(station.id)) return null;
    const def = station.def;
    return { title: def.display_name, subtitle: def.description || 'Crafting station', rows: [] };
  },

  wreck(world, wreck) {
    if (!wreck || !world.wrecks.has(wreck.id)) return null;
    const rows = [];
    for (const stack of wreck.items) {
      let amount = '';
      if (stack.item.container) amount = `${stack.count}/${stack.item.capacity}`;
      else if (stack.count > 1) amount = `×${stack.count}`;
      rows.push([stack.item.display_name, amount]);
    }
    rows.push(['Crumbles in', ticks(wreck.expire_tick - world.tick), true]);
    return { title: 'Your wreck', subtitle: 'Everything you had when you died. Only you can salvage it.', rows };
  },

  item(item, me = null) {
    if (!item) return null;
    const rows = [];
    const skill = item.equipSkill();
    if (skill) {
      const have = me ? me.level(skill) : 1;
      rows.push(['Requires', `${Skills.displayName(skill)} ${item.equip_level} (you: ${have})`, have < item.equip_level]);
    }
    let subtitle = 'Item';
    if (item.isWeapon) {
      subtitle = `${item.weapon_type.display_name} (${Skills.displayName(item.combatSkill)})`;
      rows.push(['Attack speed', `every ${ticks(item.attackSpeed)}`]);
      rows.push(['Range', item.attackRange <= 1 ? 'melee' : `${item.attackRange} tiles`]);
      rows.push(['Accuracy', `+${item.accuracy}`]);
      rows.push(['Power', String(item.power)]);
      if (item.ammo) rows.push(['Ammo', `1 ${item.ammo.display_name.toLowerCase()} per attack`]);
    } else if (item.isArmor()) {
      subtitle = `${capitalize(item.armor_slot)} armor`;
      rows.push(['Defence', `+${item.defence_bonus}`]);
    } else if (item.isConsumable()) {
      subtitle = 'Consumable';
      rows.push(['Heals', `${item.heal} HP`]);
      rows.push(['Delay', `next attack +${ticks(item.use_delay_ticks)}; one every ${ticks(item.use_delay_ticks)}`]);
      if (item.leaves) {
        const name = item.leaves.display_name.toLowerCase();
        rows.push(['Leaves', `${'aeiou'.includes(name[0]) ? 'an' : 'a'} ${name}`]);
      }
    }
    const KIND = { junk: 'Junk (recycle it at a metal press)', trinket: 'Trinket', lore: 'Lore', cosmetic: 'Cosmetic', pet: 'Pet', trophy: 'Trophy (mount it on the hab\'s trophy wall)', quest: 'Quest item', component: 'Mech component', piece: 'Hab piece', seed: 'Seed' };
    if (item.kind && KIND[item.kind]) subtitle = KIND[item.kind];
    if (item.description) rows.unshift(['', item.description]);
    if (item.container) rows.push(['Carried in', `a ${item.container.display_name.toLowerCase()}, ${item.capacity} per canister`]);
    else if (item.stackable) rows.push(['Stacks', 'yes']);
    if (item.craft_xp > 0) rows.push(['Crafting XP', `${item.craft_xp.toFixed(1)} per one used`]);
    for (const recipe of Object.values(Content.recipes)) {
      if (recipe.output === item) rows.push(['Made with', `${Skills.displayName(recipe.skill)} ${recipe.level_required}`]);
    }
    return { title: item.display_name, subtitle, rows };
  },

  /** A lore item's text. */
  lore(item) {
    return { title: item.display_name, subtitle: 'Lore', rows: [['', item.lore]] };
  },
};

function sentence(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
