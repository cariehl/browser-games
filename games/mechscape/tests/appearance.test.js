// Looks, cosmetics, pets and fun weapons: none of them change the rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, runUntil, World, Content, DEFAULT_MAP } from './helpers.js';
import { AttackAction, EquipAction } from '../src/sim/actions.js';
import { cleanLook, SetLookAction, CallPetAction, DismissPetAction, Pets } from '../src/sim/appearance.js';
import { StationKind } from '../src/sim/defs.js';
import { SaveGame } from '../src/sim/save_game.js';
import { chebyshev } from '../src/sim/grid.js';

const item = (id) => Content.item(id);
const fresh = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(5);
  return world;
};
const manufactory = (world) => [...world.stations.values()].find((s) => s.def.kind === StationKind.RESPAWN);

test('a look from the client is cleaned of anything unusable', () => {
  const look = cleanLook({ head: 'dome', chassis: 'tank', primary: '#ABCDEF', visor: 'red', extra: 1 }, 1);
  assert.equal(look.head, 'dome');
  assert.equal(look.chassis, 'standard');
  assert.equal(look.primary, '#abcdef');
  assert.match(look.visor, /^#[0-9a-f]{6}$/);
  assert.equal(look.extra, undefined);
});

test('you can only be reconfigured at the manufactory', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const station = manufactory(world);
  player.teleport({ x: station.tile.x + 8, y: station.tile.y });
  act(world, player, new SetLookAction({ head: 'crest' }));
  assert.notEqual(player.look.head, 'crest');
  player.teleport(world.freeTileNear(station.tile, 1));
  assert.ok(chebyshev(player.tile, station.tile) <= 2);
  act(world, player, new SetLookAction({ head: 'crest', primary: '#112233' }));
  assert.equal(player.look.head, 'crest');
  assert.equal(player.look.primary, '#112233');
});

test('cosmetics are worn over the look, and dropped in the wreck on death', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  player.inventory.add(item('traffic_cone'));
  act(world, player, new EquipAction(player.inventory.slots.findIndex((s) => s && s.item.id === 'traffic_cone')));
  assert.equal(player.cosmetics.hat.id, 'traffic_cone');
  assert.equal(player.inventory.countOf(item('traffic_cone')), 0);
  world.kill(player, null);
  assert.deepEqual(player.cosmetics, {});
  const wreck = [...world.wrecks.values()].find((w) => w.owner_id === player.id);
  assert.ok(wreck.items.some((s) => s.item.id === 'traffic_cone'));
});

test('a pet follows you, through hatches too, and goes back in your pack', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  player.inventory.add(item('loader_pup_pet'));
  act(world, player, new CallPetAction(player.inventory.slots.findIndex((s) => s && s.item.kind === 'pet')));
  world.runTick();
  const pet = Pets.of(world, player);
  assert.ok(pet, 'the pet is out');
  assert.equal(pet.def.attackable, false);
  // Somewhere else entirely: it catches up.
  player.teleport({ x: 5, y: 224 });
  runUntil(world, () => world.areaIdAt(pet.tile) === world.areaIdAt(player.tile), 5);
  assert.equal(world.areaIdAt(pet.tile), world.areaIdAt(player.tile));
  // Nobody can fight it.
  const other = world.spawnPlayer('Bob');
  other.teleport(world.freeTileNear(pet.tile, 2));
  act(world, other, new AttackAction(pet.id));
  assert.equal(other.task, null);
  act(world, player, new DismissPetAction());
  assert.equal(player.pet, null);
  assert.equal(Pets.of(world, player), null);
  assert.equal(player.inventory.countOf(item('loader_pup_pet')), 1);
});

test('a paintball cannon paints people without hurting them or training anything', () => {
  const world = fresh();
  const ann = world.spawnPlayer('Ann');
  const bob = world.spawnPlayer('Bob');
  ann.inventory.add(item('paintball_cannon'));
  ann.inventory.add(item('paint_pellets'), 50);
  act(world, ann, new EquipAction(ann.inventory.slots.findIndex((s) => s && s.item.id === 'paintball_cannon')));
  bob.teleport({ x: ann.tile.x + 3, y: ann.tile.y });
  const xp = JSON.stringify(ann.xp);
  const hp = bob.hp;
  act(world, ann, new AttackAction(bob.id));
  runUntil(world, () => bob.paint != null, 20);
  assert.ok(bob.paint, 'Bob is painted');
  assert.equal(bob.hp, hp);
  assert.equal(JSON.stringify(ann.xp), xp);
  // Without a fun weapon you can't attack a player at all.
  act(world, bob, new AttackAction(ann.id));
  assert.equal(bob.task, null);
});

test('look, cosmetics and pet are saved', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  player.look = cleanLook({ head: 'mono', primary: '#123456' });
  player.cosmetics.hat = item('crown_of_bolts');
  player.pet = item('mini_press_pet');
  world.runTick();
  const loaded = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  const again = loaded.players().find((p) => p.display_name === 'Ann');
  assert.equal(again.look.head, 'mono');
  assert.equal(again.cosmetics.hat.id, 'crown_of_bolts');
  assert.equal(again.pet.id, 'mini_press_pet');
});
