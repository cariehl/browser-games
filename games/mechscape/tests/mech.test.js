// The mech project: building at the gantry, the 2 × 2 footprint, the crew,
// running costs, the Deadfields, the colossus, destruction and saves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, runUntil, World, Content, DEFAULT_MAP, messages } from './helpers.js';
import { AttackAction, InteractAction, MoveAction } from '../src/sim/actions.js';
import { Mechs, MechState, BoardAction, LeaveMechAction, InstallComponentAction, MechCommandAction } from '../src/sim/mech.js';
import { Combat } from '../src/sim/combat.js';
import { SaveGame } from '../src/sim/save_game.js';
import { StationKind } from '../src/sim/defs.js';

const item = (id) => Content.item(id);
const def = () => Mechs.defaultDef();
const stationOf = (world, kind) => [...world.stations.values()].find((s) => s.def.kind === kind);
const npcOf = (world, id) => [...world.entities.values()].find((e) => e.isNpc() && e.def.id === id);
const fresh = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(3);
  return world;
};
/** Stands [player] beside [station]. */
function beside(world, player, station) {
  const t = station.interactionTiles().find((t) => world.isWalkable(t) && !world.objectAt(t));
  player.teleport(t);
}
/** Installs every component the build still needs, as [player]. */
function installAll(world, player) {
  const gantry = stationOf(world, StationKind.GANTRY);
  beside(world, player, gantry);
  for (const { item: it, count } of Mechs.missing(def(), Mechs.build(world, def()))) {
    for (let i = 0; i < count; i++) {
      player.inventory.add(it);
      act(world, player, new InstallComponentAction(gantry.id, it.id));
    }
  }
  return gantry;
}
/** A finished, powered and deployed mech, fuelled and loaded. */
function deployed(world, player) {
  world.flags.blueprint_loaded = true;
  const gantry = installAll(world, player);
  world.flags.mech_powered = true;
  act(world, player, new MechCommandAction(gantry.id, 'deploy'));
  const mech = Mechs.of(world, Mechs.build(world, def()));
  mech.fuel = def().tank;
  mech.ammo = def().magazine;
  return mech;
}

test('components are made from the existing skills, all at level 15', () => {
  const recipes = Object.values(Content.recipes);
  for (const { item: it } of def().components) {
    const recipe = recipes.find((r) => r.output === it);
    assert.ok(recipe, `a recipe for ${it.id}`);
    assert.equal(recipe.level_required, 15, `${it.id} at level ${recipe.level_required}`);
    const stations = Object.values(Content.stations).filter((s) => (s.recipes || []).includes(recipe));
    assert.ok(stations.length, `${it.id} is made somewhere`);
  }
});

test('components need refined sub-parts, and refined metal takes ten scrap', () => {
  const recipes = Object.values(Content.recipes);
  const made = (id) => recipes.find((r) => r.output === item(id));
  assert.deepEqual(made('refined_metal').inputs.map((i) => [i.item.id, i.count]), [['scrap_metal', 10]]);
  for (const { item: it } of def().components) {
    assert.ok(made(it.id).inputs.some((i) => i.item.id === 'refined_metal'), `${it.id} uses refined metal`);
  }
  for (const id of ['refined_metal', 'control_board', 'servo_assembly']) {
    assert.ok(made(id).level_required < 15, `${id} comes before the parts`);
    assert.ok(Object.values(Content.stations).some((s) => (s.recipes || []).includes(made(id))), `${id} is made somewhere`);
  }
});

test('the gantry needs the blueprint, then every component, and stands the mech up on the pad', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const gantry = stationOf(world, StationKind.GANTRY);
  beside(world, ann, gantry);
  ann.inventory.add(item('mech_frame'));
  act(world, ann, new InstallComponentAction(gantry.id, 'mech_frame'));
  assert.ok(messages(world, ann.id).some((m) => m.includes('no blueprint')));
  world.flags.blueprint_loaded = true;
  act(world, ann, new InstallComponentAction(gantry.id, 'mech_frame'));
  const build = Mechs.build(world, def());
  assert.equal(build.installed.mech_frame, 1);
  assert.deepEqual(build.contributors, [{ name: 'Ann', item: 'mech_frame' }]);
  assert.ok(ann.xp.engineering > 0);
  // A second frame isn't needed.
  ann.inventory.add(item('mech_frame'));
  act(world, ann, new InstallComponentAction(gantry.id, 'mech_frame'));
  assert.equal(ann.inventory.countOf(item('mech_frame')), 1);
  installAll(world, ann);
  const mech = Mechs.of(world, build);
  assert.ok(mech instanceof MechState);
  assert.ok(world.flags.mech_complete);
  assert.ok(Mechs.parked(world, def(), mech));
  assert.equal(mech.maxHp(), mech.def.hitpoints + 4 * def().plate_hp);
});

test('a 2 × 2 mech cannot squeeze through a one-tile gap that a player can', () => {
  const world = new World('');
  const mech = world.addNpc(Content.npcs.walker_mech, { x: 2, y: 10 });
  // A wall across the field with a one-tile gap at x 16.
  for (let y = 0; y < 32; y++) if (y !== 16) world.setTerrain({ x: 10, y }, Content.terrain.wall || Object.values(Content.terrain).find((t) => t.blocks_movement));
  const player = world.spawn(1, { x: 2, y: 20 });
  assert.ok(world.findPath(player.tile, { x: 20, y: 20 }, player).length > 0, 'the player gets through');
  // Mechs keep to mech zones; give it a field with no zones by clearing its mask.
  world._mechMask.fill(0);
  assert.equal(world.findPath(mech.tile, { x: 20, y: 10 }, mech).length, 0, 'the mech does not');
  assert.ok(world.findPath(mech.tile, { x: 5, y: 2 }, mech).length > 0, 'but it walks on its own side');
});

test('reach is measured from the footprint: a mech beside an NPC on any side can hit it', () => {
  const world = new World('');
  const mech = world.addNpc(Content.npcs.walker_mech, { x: 10, y: 10 });
  const npc = world.spawnNpc(Content.npcs.scrap_colossus, { x: 0, y: 0 });
  for (const t of [{ x: 9, y: 10 }, { x: 12, y: 11 }, { x: 10, y: 12 }, { x: 11, y: 9 }]) {
    npc.teleport(t);
    assert.ok(Combat.canHitEntity(world, npc, mech, 1), `from ${t.x},${t.y}`);
    assert.ok(Combat.canHitEntity(world, mech, npc, 1), `to ${t.x},${t.y}`);
  }
  npc.teleport({ x: 13, y: 10 });
  assert.ok(!Combat.canHitEntity(world, npc, mech, 1));
});

test('deploy, two crew board, the pilot drives (burning fuel) and the gunner fires (using cartridges)', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bob = world.spawnPlayer('Bob');
  const mech = deployed(world, ann);
  assert.ok(world.inZone(mech.tile, 'mech'), 'it stands in the Deadfields');
  for (const [p, seat] of [[ann, 'pilot'], [bob, 'gunner']]) {
    p.teleport(Mechs.tileBeside(world, mech));
    act(world, p, new BoardAction(mech.id, seat));
    runUntil(world, () => p.riding != null, 10);
    assert.deepEqual(p.riding, { mech: mech.id, seat, def: 'walker' });
  }
  // The pilot drives; the gunner can't.
  const start = { ...mech.tile };
  const fuel = mech.fuel;
  act(world, bob, new MoveAction({ x: start.x + 6, y: start.y }));
  assert.equal(mech.path.length, 0);
  act(world, ann, new MoveAction({ x: start.x + 6, y: start.y }));
  runUntil(world, () => !mech.isMoving(), 20);
  assert.equal(mech.tile.x, start.x + 6);
  assert.deepEqual(ann.tile, mech.tile, 'the crew ride along');
  assert.ok(mech.fuel < fuel, 'walking burnt fuel');
  // It can't leave the Deadfields.
  act(world, ann, new MoveAction({ x: 10, y: 24 }));
  assert.ok(messages(world, ann.id).some((m) => m.includes("can't leave")));
  // The gunner fires at something in reach; each shot costs a cartridge.
  const target = world.addNpc(Content.npcs.scrap_loader || Object.values(Content.npcs).find((n) => n.attackable && n.hitpoints > 20), { x: mech.tile.x + 4, y: mech.tile.y });
  const ammo = mech.ammo;
  act(world, bob, new AttackAction(target.id));
  runUntil(world, () => mech.ammo < ammo, 10);
  assert.ok(mech.ammo < ammo);
  assert.ok(target.hp < target.maxHp() || runUntil(world, () => target.hp < target.maxHp(), 40) > 0);
  // Nobody can hurt you in your seat, and NPCs don't pick on you.
  assert.equal(ann.canBeAttacked(), false);
  // Climbing out puts you beside it.
  act(world, bob, new LeaveMechAction());
  assert.equal(bob.riding, null);
  assert.equal(mech.distanceTo(bob.tile), 1);
});

test('the colossus takes nothing from players on foot and full damage from the mech', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const colossus = npcOf(world, 'scrap_colossus');
  ann.weapon = item('relic_pistol');
  ann.inventory.add(item('gas_cartridge'), 50);
  ann.xp.firearms = 1e6;
  ann.teleport({ x: colossus.tile.x - 4, y: colossus.tile.y });
  act(world, ann, new AttackAction(colossus.id));
  runUntil(world, () => world.events.some((e) => e.type === 'no_effect'), 30);
  assert.equal(colossus.hp, colossus.maxHp());
  // The mech hurts it.
  const mech = deployed(world, ann);
  mech.teleport({ x: colossus.tile.x - 4, y: colossus.tile.y - 1 });
  ann.teleport(Mechs.tileBeside(world, mech));
  act(world, ann, new BoardAction(mech.id, 'pilot'));
  act(world, ann, new AttackAction(colossus.id));
  runUntil(world, () => colossus.hp < colossus.maxHp(), 60);
  assert.ok(colossus.hp < colossus.maxHp());
});

test('salvage that needs a mech can only be worked from one', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const hulk = [...world.nodes.values()].find((n) => n.def.requires_mech);
  ann.teleport(hulk.interactionTiles().find((t) => world.isWalkable(t)));
  act(world, ann, new InteractAction(hulk.id));
  assert.ok(messages(world, ann.id).some((m) => m.includes('need a mech')));
  assert.equal(ann.inventory.countOf(hulk.def.loot), 0);
  const mech = deployed(world, ann);
  ann.teleport(Mechs.tileBeside(world, mech));
  act(world, ann, new BoardAction(mech.id, 'pilot'));
  ann.xp.salvaging = 1e6;
  act(world, ann, new InteractAction(hulk.id));
  runUntil(world, () => ann.inventory.countOf(hulk.def.loot) + ann.inventory.countOf(hulk.def.rare_loot) > 0, 300);
  assert.ok(ann.inventory.countOf(hulk.def.loot) + ann.inventory.countOf(hulk.def.rare_loot) > 0);
});

test('a destroyed mech throws its crew clear, leaves wreckage and keeps its frame', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const mech = deployed(world, ann);
  ann.teleport(Mechs.tileBeside(world, mech));
  act(world, ann, new BoardAction(mech.id, 'pilot'));
  const hp = ann.hp;
  world.kill(mech, npcOf(world, 'scrap_colossus'));
  world.runTick();
  assert.equal(ann.riding, null);
  assert.equal(ann.hp, hp, 'thrown clear, not killed');
  assert.ok(!world.entities.has(mech.id));
  assert.ok([...world.nodes.values()].some((n) => n.def.id === 'mech_wreckage'));
  const build = Mechs.build(world, def());
  assert.equal(build.installed.mech_frame, 1);
  assert.equal(build.installed.armor_plate || 0, 0);
  assert.equal(Mechs.of(world, build), null);
});

test('repairs, fuel and ammo at the repair rig', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const mech = deployed(world, ann);
  mech.hp = 50;
  mech.fuel = 0;
  mech.ammo = 0;
  const rig = stationOf(world, StationKind.REPAIR);
  beside(world, ann, rig);
  ann.inventory.add(item('alloy_plating'));
  ann.inventory.add(item('alloy_plating'));
  ann.inventory.add(item('canister'));
  ann.inventory.add(item('vent_gas'), 30);
  ann.inventory.add(item('gas_cartridge'), 40);
  act(world, ann, new MechCommandAction(rig.id, 'service'));
  assert.equal(mech.hp, 50 + 2 * def().repair_hp);
  assert.equal(mech.fuel, 30);
  assert.equal(mech.ammo, 40);
  assert.equal(ann.inventory.countOf(item('alloy_plating')), 0);
});

test('the build and a standing mech survive a save; the crew come back in their seats', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const mech = deployed(world, ann);
  ann.teleport(Mechs.tileBeside(world, mech));
  act(world, ann, new BoardAction(mech.id, 'pilot'));
  mech.hp = 77;
  const loaded = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  const build = Mechs.build(loaded, def());
  const again = Mechs.of(loaded, build);
  assert.ok(again, 'the mech is back');
  assert.deepEqual(again.tile, mech.tile);
  assert.equal(again.hp, 77);
  assert.equal(again.fuel, mech.fuel);
  assert.equal(Object.values(build.installed).reduce((a, b) => a + b, 0), 11);
  const annAgain = loaded.players().find((p) => p.display_name === 'Ann');
  assert.equal(annAgain.riding && annAgain.riding.seat, 'pilot');
  assert.equal(again.crew.pilot, annAgain.id);
  assert.deepEqual(annAgain.tile, again.tile);
});

test('Ignition: the finished mech moves the quest on, and powering it up lets it deploy', async () => {
  const { Quests, TalkAction, DialogueChoiceAction } = await import('../src/sim/quests.js');
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  Quests.start(world, ann, 'ignition');
  Quests.setStage(world, ann, 'ignition', 'build_mech');
  world.flags.blueprint_loaded = true;
  const gantry = installAll(world, ann);
  world.runTick();
  assert.equal(Quests.stageOf(ann, 'ignition'), 'power_up');
  act(world, ann, new MechCommandAction(gantry.id, 'deploy'));
  assert.ok(messages(world, ann.id).some((m) => m.includes("hasn't been powered up")));
  const foreman = npcOf(world, 'foreman');
  act(world, ann, new TalkAction(foreman.id));
  runUntil(world, () => ann.dialogue != null, 80);
  const choice = ann.dialogue.choices.findIndex((c) => c.includes('Power'));
  act(world, ann, new DialogueChoiceAction(choice));
  assert.ok(world.flags.mech_powered);
  assert.ok(Quests.isDone(ann, 'ignition'));
  beside(world, ann, gantry);
  act(world, ann, new MechCommandAction(gantry.id, 'deploy'));
  const mech = Mechs.of(world, Mechs.build(world, def()));
  assert.ok(world.inZone(mech.tile, 'mech'));
});
