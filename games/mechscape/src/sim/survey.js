// The survey expedition in the Quiet Reach: no enemies, three gentle
// puzzles, and specimens to sample.
//
//   puzzles     a station of kind "puzzle" opens every tile of the terrain
//               named by its def's "opens": feed it what it needs (scrap for
//               the bridge winch, vent gas for the door valve), or just use
//               it (the veil projector, which "scans" off). Opened terrain
//               becomes its def's "opens_to" (the mended bridge) or nothing.
//               Puzzles are shared: once someone mends the bridge, it's
//               mended for everyone, and the world remembers it.
//   specimens   sampling a specimen plant (verb "sample") emits "sampled",
//               which the survey drone comments on. The survey quest's
//               "have" goal picks the specimens up on its own.
//
// Opened puzzles are public, and saved.

import { Features } from './features.js';
import { Content, StationKind } from './defs.js';
import { StationHandlers } from './tasks.js';
import { fromKey } from './grid.js';
import { XENOBIOLOGY } from './skills.js';
import { Text } from './text.js';

export const Survey = {
  /** Opens every tile of terrain [id] (once), and remembers it. */
  open(world, id) {
    if (!world.opened.includes(id)) world.opened.push(id);
    const def = Content.terrain[id];
    const after = def && def.opens_to ? Content.terrain[def.opens_to] : null;
    for (const [k, t] of [...world.terrainTiles()]) {
      if (t.id === id) world.setTerrain(fromKey(k), after);
    }
  },

  isOpen(world, id) {
    return world.opened.includes(id);
  },
};

StationHandlers[StationKind.PUZZLE] = (world, player, station) => {
  const def = station.def;
  if (Survey.isOpen(world, def.opens)) {
    world.message(player.id, `The ${def.display_name.toLowerCase()} has done its job. The way is open.`);
    return;
  }
  if (def.needs) {
    const { item, count } = def.needs;
    if (player.inventory.countOf(item) < count) {
      world.message(player.id, `${def.description}: ${count} ${item.display_name.toLowerCase()}. You have ${player.inventory.countOf(item)}.`);
      return;
    }
    player.inventory.remove(item, count);
  }
  Survey.open(world, def.opens);
  world.message(player.id, def.done_text);
  world.grantXp(player, XENOBIOLOGY, Content.rules.survey.puzzle_xp);
  world.announce(Text.get('survey.puzzle_solved', { player: player.display_name, puzzle: def.display_name, area: world.areaAt(station.tile)?.name || '' }));
  world.emitEvent(player.id, 'puzzle_solved', { station: station.id, opens: def.opens });
};

Features.register({
  id: 'survey',

  init(world) {
    /** Terrain ids opened by puzzles, in order. */
    world.opened = [];
  },

  onGather(world, player, node) {
    if (node.def.verb === 'sample') world.emitEvent(player.id, 'sampled', { node: node.id, item: node.def.loot.id });
  },

  save(world) {
    return { opened: world.opened };
  },

  load(world, data) {
    for (const id of data.opened || []) if (Content.terrain[id]) Survey.open(world, id);
  },

  snapshot(world) {
    return world.opened;
  },

  apply(world, data) {
    for (const id of data) if (!world.opened.includes(id)) Survey.open(world, id);
  },
});
