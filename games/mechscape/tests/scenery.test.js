// The land beyond the maps' edges (data/scenery.json, view/backdrop_terrain.js):
// it meets every area without a seam, never covers anything walkable, and
// the Quiet Reach stands on its hill above the Commons.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, Content, DEFAULT_MAP } from './helpers.js';
import { buildRegions } from '../src/view/backdrop_terrain.js';
import { key } from '../src/sim/grid.js';

const LEVEL_HEIGHT = 0.9;
const world = new World(DEFAULT_MAP);
const regions = buildRegions(world, Content.scenery, LEVEL_HEIGHT);

test('every region surrounds daylight areas of the world, with props that exist', () => {
  assert.ok(regions.length >= 2);
  for (const [id, data] of Object.entries(Content.scenery.regions)) {
    for (const areaId of data.areas) {
      const area = world.areas.find((a) => a.id === areaId);
      assert.ok(area, `${id}: area ${areaId}`);
      assert.ok(!area.dark, `${id}: ${areaId} is underground`);
    }
    for (const p of [...(data.scatter || []), ...(data.props || [])]) assert.ok(Content.decor[p.decor], `${id}: decor ${p.decor}`);
  }
  // No area is in two regions.
  const seen = regions.flatMap((r) => r.areas.map((a) => a.area.id));
  assert.equal(new Set(seen).size, seen.length);
});

test('the land meets each area at its edge height, with no gap', () => {
  for (const region of regions) {
    for (const { area } of region.areas) {
      const { x: ox, y: oy } = area.offset;
      const { x: w, y: h } = area.size;
      const edge = [];
      for (let x = ox; x <= ox + w; x++) edge.push([x, oy], [x, oy + h]);
      for (let y = oy; y <= oy + h; y++) edge.push([ox, y], [ox + w, y]);
      for (const [cx, cy] of edge) {
        const tile = { x: Math.min(cx, ox + w - 1), y: Math.min(cy, oy + h - 1) };
        const inside = (t) => world.areaAt(t) === area;
        // Corners shared with another area's edge belong to whichever is nearer; only check plain edges.
        if (!inside(tile)) continue;
        const h0 = region.heights[region.corner(cx, cy)];
        const expected = world.heightAt(tile) * LEVEL_HEIGHT;
        const near = [tile, { x: tile.x - 1, y: tile.y }, { x: tile.x, y: tile.y - 1 }, { x: tile.x - 1, y: tile.y - 1 }]
          .filter(inside).map((t) => world.heightAt(t) * LEVEL_HEIGHT);
        assert.ok(near.some((v) => Math.abs(v - h0) < 1e-6), `${region.id} ${cx},${cy}: ${h0} vs ${expected}`);
        assert.deepEqual(region.offsetAt(cx, cy), [0, 0]);
      }
    }
  }
});

test('the floor under the fog is below all the land', () => {
  for (const region of regions) {
    let lowest = Infinity;
    for (const v of region.heights) lowest = Math.min(lowest, v);
    assert.ok(lowest >= region.floorY - 1e-6, `${region.id}: ${lowest} < ${region.floorY}`);
  }
});

test('no prop or fence post stands on a walkable tile', () => {
  for (const region of regions) {
    const props = region.props();
    assert.ok(props.length > 100, `${region.id} has scenery`);
    for (const p of props) {
      const tile = { x: Math.floor(p.x), y: Math.floor(p.y) };
      assert.ok(world.areaIdAt(tile) < 0, `${region.id}: ${p.decor} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    for (const fence of region.fences()) {
      for (const post of fence.posts) assert.ok(world.areaIdAt({ x: Math.floor(post.x), y: Math.floor(post.y) }) < 0);
    }
  }
  // The same every time: it's drawn on every client.
  assert.deepEqual(buildRegions(world, Content.scenery, LEVEL_HEIGHT)[0].props().slice(0, 20), regions[0].props().slice(0, 20));
});

test('the Quiet Reach is on a hill beside the Commons, up the elevator', () => {
  const yard = world.areas.find((a) => a.id === 'scrapyard');
  const reach = world.areas.find((a) => a.id === 'quiet_reach');
  // Close enough to see, not touching: the cliff is between.
  assert.ok(reach.offset.y > yard.offset.y + yard.size.y && reach.offset.y - (yard.offset.y + yard.size.y) <= 10);
  const lift = [...world.stations.values()].find((s) => s.def.id === 'reach_lift');
  const link = world.links.get(key(lift.tile));
  assert.equal(world.areaAt(link.to), reach);
  assert.ok(world.heightAt(link.to) - world.heightAt(lift.tile) >= 8, 'a good climb');
  // The land rises from the fence to the Reach's rim.
  const region = regions.find((r) => r.areas.some((a) => a.area === reach));
  const x = lift.tile.x + 0.5;
  const foot = region.heightAt(x, yard.offset.y + yard.size.y + 0.5);
  const top = region.heightAt(x, reach.offset.y - 0.5);
  assert.ok(top - foot > 5, `${foot} -> ${top}`);
});
