// Checks that a player can reach everything they need to: from spawn, over
// every path and through every link (hatches, gates, the lift), each station,
// gather node and NPC must have a walkable tile beside it. Run it after
// changing a map or making props solid.
//
//   node tools/check_reach.js      (or npm run check-reach)
//
// Checked with every survey puzzle solved (what's behind a puzzle is meant
// to be out of reach until then). Bosses are skipped: they wait behind their
// arena's sealed door. Exits with code 1 (and lists each one) if anything can't be reached.

import { pathToFileURL } from 'node:url';
import { loadContentFromDisk } from '../src/sim/load_node.js';
import { World } from '../src/sim/world.js';
import { Content } from '../src/sim/defs.js';
import { Survey } from '../src/sim/survey.js';
import { MAX_STEP } from '../src/sim/grid.js';
import '../src/sim/all_features.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Every tile a player can stand on, starting from spawn. A Set of y * width + x. */
export function reachableTiles(world) {
  const grid = world._grid;
  const w = grid.width;
  const open = (x, y) => grid._open(x, y);
  const step = (ax, ay, bx, by) => Math.abs(grid.heights[ay * w + ax] - grid.heights[by * w + bx]) <= MAX_STEP;
  const seen = new Set();
  const queue = [];
  const push = (x, y) => {
    const k = y * w + x;
    if (seen.has(k) || !open(x, y)) return;
    seen.add(k);
    queue.push(k);
  };
  push(world.spawn_point.x, world.spawn_point.y);
  while (queue.length) {
    const k = queue.pop();
    const x = k % w;
    const y = (k - x) / w;
    // A link starts on its station (a hatch, a gate): using it from beside it takes you through.
    for (const [dx, dy] of [[0, 0], ...DIRS]) {
      const link = world.links.get(`${x + dx},${y + dy}`);
      if (link) push(link.to.x, link.to.y);
    }
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny) || !step(x, y, nx, ny)) continue;
      // Same corner rule as the path search.
      if (dx && dy && (!open(x + dx, y) || !open(x, y + dy) || !step(x, y, x + dx, y) || !step(x, y, x, y + dy))) continue;
      push(nx, ny);
    }
  }
  return seen;
}

/** Stations, gather nodes and NPCs with no reachable tile on or beside them: [{ what, tile }]. */
export function unreachable(world) {
  const tiles = reachableTiles(world);
  const w = world._grid.width;
  const near = (t) => DIRS.concat([[0, 0]]).some(([dx, dy]) => tiles.has((t.y + dy) * w + t.x + dx));
  const things = [];
  for (const s of world.stations.values()) things.push({ what: `station ${s.def.id}`, tile: s.tile });
  for (const n of world.nodes.values()) things.push({ what: `node ${n.def.id}`, tile: n.tile });
  for (const e of world.entities.values()) if (e.isNpc() && e.size <= 1 && !e.def.boss) things.push({ what: `npc ${e.def.id}`, tile: e.spawn_tile });
  return things.filter((t) => !near(t.tile));
}

export function checkReach() {
  loadContentFromDisk();
  const report = [];
  const world = new World();
  for (const def of Object.values(Content.stations)) if (def.opens) Survey.open(world, def.opens);
  for (const t of unreachable(world)) report.push(`${t.what} at ${t.tile.x},${t.tile.y}`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = checkReach();
  for (const line of report) console.log(line);
  console.log(report.length ? `${report.length} unreachable.` : 'OK: everything can be reached.');
  process.exit(report.length ? 1 : 0);
}
