// The hab: placing pieces, fittings, grow beds, comfort, trophies and the commission board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, World, Content, DEFAULT_MAP, messages } from './helpers.js';
import { InteractAction, CraftAction } from '../src/sim/actions.js';
import { Hab, PlacePieceAction, EditPieceAction, CommissionAction, RESTED_AFTER } from '../src/sim/hab.js';
import { StationKind } from '../src/sim/defs.js';
import { SaveGame } from '../src/sim/save_game.js';
import { Mechs, InstallComponentAction } from '../src/sim/mech.js';
import { key } from '../src/sim/grid.js';

const item = (id) => Content.item(id);
const fresh = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(8);
  return world;
};
const stationOf = (world, id) => [...world.stations.values()].find((s) => s.def.id === id);
const slotOf = (p, id) => p.inventory.slots.findIndex((s) => s && s.item.id === id);
/** Puts [id] in [player]'s pack and places it on [tile]. */
function place(world, player, id, tile) {
  player.inventory.add(item(id));
  act(world, player, new PlacePieceAction(slotOf(player, id), tile));
  return world.objectAt(tile);
}
const floor = (world) => {
  const tiles = [];
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (world.inZone({ x, y }, 'build') && world.isWalkable({ x, y }) && !world.objectAt({ x, y })) tiles.push({ x, y });
  return tiles;
};
function beside(world, player, object) {
  player.teleport(object.interactionTiles().find((t) => world.isWalkable(t) && !world.objectAt(t)));
}

test('pieces go only on the hab floor, on free tiles', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  assert.equal(place(world, ann, 'bunk', world.spawn_point), null);
  assert.ok(messages(world, ann.id).some((m) => m.includes('hab floor')));
  const t = floor(world)[0];
  const piece = place(world, ann, 'bunk', t);
  assert.equal(piece.item.id, 'bunk');
  assert.equal(piece.owner, 'Ann');
  assert.ok(!world.isWalkable(t), 'a bunk blocks');
  assert.equal(place(world, ann, 'crate_stack', t), piece, 'the tile is taken');
});

test('nothing may cut off part of the hab', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const before = Hab.reachable(world);
  // Fill a whole row across the floor: refused before it closes.
  const tiles = floor(world);
  const row = tiles.filter((x) => x.y === 10);
  let refused = false;
  for (const tile of row) {
    const p = place(world, ann, 'crate_stack', tile);
    if (!p || p.item.id !== 'crate_stack') refused = true;
  }
  assert.ok(refused, 'the last crate that would split the hab is refused');
  const after = Hab.reachable(world);
  for (const k of before) {
    const [x, y] = k.split(',').map(Number);
    const blockedByPiece = world.objectAt({ x, y });
    if (!blockedByPiece) assert.ok(after.has(k), `${k} still reachable`);
  }
});

test('only the placer can move, recolour or pick up a piece', () => {
  const world = fresh();
  const [ann, bob] = [world.spawnPlayer('Ann'), world.spawnPlayer('Bob')];
  const [t, u] = floor(world);
  const piece = place(world, ann, 'lounge_chair', t);
  act(world, bob, new EditPieceAction(piece.id, 'pick_up'));
  assert.ok(world.pieces.has(piece.id));
  act(world, ann, new EditPieceAction(piece.id, 'color', { color: piece.def.colors[2] }));
  assert.equal(piece.color, piece.def.colors[2]);
  act(world, ann, new EditPieceAction(piece.id, 'move', { tile: u, rotation: 1 }));
  assert.deepEqual(piece.tile, u);
  assert.equal(world.objectAt(u), piece);
  assert.equal(world.objectAt(t), null);
  act(world, ann, new EditPieceAction(piece.id, 'pick_up'));
  assert.ok(!world.pieces.has(piece.id));
  assert.equal(ann.inventory.countOf(item('lounge_chair')), 1);
});

test('a tool wall speeds up Engineering at the hab workbench only while it hangs there', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bench = stationOf(world, 'hab_workbench');
  const recipe = Content.recipes.canister;
  const ticks = () => {
    beside(world, ann, bench);
    ann.inventory.add(item('scrap_metal'), 1);
    ann.inventory.add(item('scrap_metal'), 1);
    const start = world.tick;
    act(world, ann, new CraftAction(bench.id, bench.def.recipes.indexOf(recipe), 1));
    let n = 0;
    while (ann.inventory.countOf(item('canister')) === 0 && n++ < 50) world.runTick();
    ann.inventory.remove(item('canister'), 1);
    return world.tick - start;
  };
  const slow = ticks();
  const wall = place(world, ann, 'tool_wall', floor(world).at(-1));
  const fast = ticks();
  assert.ok(fast < slow, `${fast} < ${slow}`);
  act(world, ann, new EditPieceAction(wall.id, 'pick_up'));
  assert.equal(ticks(), slow);
});

test('a grow bed grows from a seed only once watered, then harvests', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bed = place(world, ann, 'grow_bed', floor(world)[3]);
  beside(world, ann, bed);
  ann.inventory.add(item('ventbloom_seed'), 2);
  act(world, ann, new InteractAction(bed.id));
  world.runTick();
  assert.equal(bed.bed.seed, 'ventbloom_seed');
  // Unwatered, nothing happens however long you wait.
  for (let i = 0; i < 300; i++) world.runTick();
  act(world, ann, new InteractAction(bed.id));
  world.runTick();
  assert.ok(!bed.bed.fed);
  assert.equal(ann.inventory.countOf(item('ventbloom')), 0);
  ann.inventory.add(item('canister'));
  ann.inventory.add(item('ichor'), 20);
  act(world, ann, new InteractAction(bed.id));
  world.runTick();
  assert.ok(bed.bed.fed);
  while (world.tick < bed.bed.ready) world.runTick();
  const xp = ann.xp.xenobiology || 0;
  act(world, ann, new InteractAction(bed.id));
  world.runTick();
  assert.ok(ann.inventory.countOf(item('ventbloom')) >= 3);
  assert.ok((ann.xp.xenobiology || 0) > xp);
  assert.equal(bed.bed.seed, null);
});

test('a comfortable hab leaves you rested (bonus XP); a bare one does not', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const inside = floor(world)[10];
  ann.teleport(inside);
  for (let i = 0; i < RESTED_AFTER + 20; i++) world.runTick();
  assert.ok(ann.rested_until < world.tick);
  const tiles = floor(world).filter((t) => t.y <= 8);
  for (const [i, id] of ['bunk', 'lounge_chair', 'moss_rug', 'work_lamp', 'potted_glowroot', 'hab_banner', 'lounge_chair'].entries()) place(world, ann, id, tiles[i]);
  ann.teleport(inside);
  ann.hab_ticks = 0;
  for (let i = 0; i < RESTED_AFTER + 20; i++) world.runTick();
  assert.ok(ann.rested_until > world.tick, `comfort ${Hab.comfort(world)}`);
  const before = ann.xp.melee || 0;
  world.grantXp(ann, 'melee', 100);
  assert.equal(ann.xp.melee - before, 110);
});

test('trophies on the wall give everyone a little more XP in their skill', () => {
  const world = fresh();
  const [ann, bob] = [world.spawnPlayer('Ann'), world.spawnPlayer('Bob')];
  const wall = stationOf(world, 'trophy_wall');
  beside(world, ann, wall);
  ann.inventory.add(item('loader_horn'));
  act(world, ann, new InteractAction(wall.id));
  world.runTick();
  assert.equal(world.trophies.length, 1);
  const before = bob.xp.melee || 0;
  world.grantXp(bob, 'melee', 100);
  assert.equal(bob.xp.melee - before, 102);
});

test('commissions: the offer is held, filling swaps at once, and the poster collects', () => {
  const world = fresh();
  const [ann, bob] = [world.spawnPlayer('Ann'), world.spawnPlayer('Bob')];
  const board = stationOf(world, 'commission_board');
  beside(world, ann, board);
  beside(world, bob, board);
  for (let i = 0; i < 3; i++) ann.inventory.add(item('canister'));
  act(world, ann, new CommissionAction(board.id, 'post', { want: 'alloy_plating', wantCount: 1, offer: 'canister', offerCount: 3 }));
  assert.equal(world.commissions.length, 1);
  assert.equal(ann.inventory.countOf(item('canister')), 0, 'held by the board');
  const c = world.commissions[0];
  // Bob can't fill it without the goods.
  act(world, bob, new CommissionAction(board.id, 'fill', { id: c.id }));
  assert.equal(c.filled_by, '');
  bob.inventory.add(item('alloy_plating'));
  // ...or without room for the payment (three canisters, one free slot).
  for (let i = 0; i < 27; i++) bob.inventory.add(item('glowroot'));
  act(world, bob, new CommissionAction(board.id, 'fill', { id: c.id }));
  assert.equal(c.filled_by, '');
  for (let i = 0; i < 2; i++) bob.inventory.remove(item('glowroot'), 1);
  act(world, bob, new CommissionAction(board.id, 'fill', { id: c.id }));
  assert.equal(c.filled_by, 'Bob');
  assert.equal(bob.inventory.countOf(item('canister')), 3);
  assert.equal(bob.inventory.countOf(item('alloy_plating')), 0);
  act(world, ann, new CommissionAction(board.id, 'collect', { id: c.id }));
  assert.equal(ann.inventory.countOf(item('alloy_plating')), 1);
  assert.equal(world.commissions.length, 0);
});

test('the cockpit interior made in the hab installs at the gantry like any component', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bench = stationOf(world, 'hab_workbench');
  assert.ok(bench.def.recipes.some((r) => r.output === item('cockpit_interior')));
  world.flags.blueprint_loaded = true;
  const gantry = [...world.stations.values()].find((s) => s.def.kind === StationKind.GANTRY);
  beside(world, ann, gantry);
  ann.inventory.add(item('cockpit_interior'));
  act(world, ann, new InstallComponentAction(gantry.id, 'cockpit_interior'));
  assert.equal(Mechs.build(world, Mechs.defaultDef()).installed.cockpit_interior, 1);
});

test('pieces, beds, trophies and commissions survive a save', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bed = place(world, ann, 'grow_bed', floor(world)[2]);
  bed.bed = { seed: 'glowroot_seed', fed: true, ready: 500 };
  world.trophies.push({ item: 'sentry_eye', by: 'Ann' });
  world.commissions.push({ id: 7, by: 'Ann', want: 'ichor', want_count: 5, offer: 'scrap_metal', offer_count: 3, filled_by: '', posted: 1 });
  const loaded = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  const again = loaded.objectAt(bed.tile);
  assert.equal(again.item.id, 'grow_bed');
  assert.deepEqual(again.bed, bed.bed);
  assert.equal(again.owner, 'Ann');
  assert.ok(!loaded.isWalkable(bed.tile));
  assert.equal(loaded.trophies.length, 1);
  assert.equal(loaded.commissions[0].want, 'ichor');
  assert.ok(key(again.tile));
});
