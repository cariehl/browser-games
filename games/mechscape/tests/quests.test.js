// Quests and dialogue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, runUntil, World, Content, DEFAULT_MAP, messages } from './helpers.js';
import { AttackAction, InteractAction } from '../src/sim/actions.js';
import { Quests, TalkAction, DialogueChoiceAction } from '../src/sim/quests.js';
import { SaveGame } from '../src/sim/save_game.js';
import { Skills } from '../src/sim/skills.js';

const item = (id) => Content.item(id);
const npcOf = (world, id) => [...world.entities.values()].find((e) => e.isNpc() && e.def.id === id);
const stationOf = (world, id) => [...world.stations.values()].find((s) => s.def.id === id);
const fresh = () => {
  const world = new World(DEFAULT_MAP);
  world.rng.setSeed(9);
  return world;
};
/** Walks up to [npc], talks, and picks [choice] (a choice's text, or its index). */
function talk(world, player, npc, choice = null) {
  act(world, player, new TalkAction(npc.id));
  runUntil(world, () => player.dialogue != null, 60);
  assert.ok(player.dialogue, `talking to ${npc.def.display_name}`);
  if (choice == null) return player.dialogue;
  const index = typeof choice === 'number' ? choice : player.dialogue.choices.findIndex((c) => c.includes(choice));
  assert.ok(index >= 0, `"${choice}" among ${player.dialogue.choices}`);
  act(world, player, new DialogueChoiceAction(index));
  return player.dialogue;
}

test('nobody can attack the people you talk to', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const foreman = npcOf(world, 'foreman');
  act(world, player, new AttackAction(foreman.id));
  assert.equal(player.task, null);
  assert.ok(messages(world, player.id).some((m) => m.includes("can't attack")));
});

test('Ignition: from the foreman to the vault and back', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const foreman = npcOf(world, 'foreman');
  talk(world, player, foreman, 'blueprint');
  assert.equal(Quests.stageOf(player, 'ignition'), 'find_hatch');
  // Going down the hatch moves it on.
  player.teleport({ x: 5, y: 224 });
  world.runTick();
  assert.equal(Quests.stageOf(player, 'ignition'), 'find_blueprint');
  // The vault won't open while the warden stands.
  const vault = stationOf(world, 'blueprint_cache');
  player.teleport({ x: vault.tile.x, y: vault.tile.y - 1 });
  act(world, player, new InteractAction(vault.id));
  assert.ok(messages(world, player.id).some((m) => m.includes('stands guard')));
  // Kill the warden and the vault gives up the blueprint.
  world.kill(npcOf(world, 'undercroft_warden'), player);
  act(world, player, new InteractAction(vault.id));
  assert.equal(player.inventory.countOf(item('mech_blueprint')), 1);
  world.runTick();
  assert.equal(Quests.stageOf(player, 'ignition'), 'return_blueprint');
  // A second visit doesn't hand out another.
  act(world, player, new InteractAction(vault.id));
  assert.equal(player.inventory.countOf(item('mech_blueprint')), 1);
  // Back to the foreman: she takes it and the gantry has its blueprint.
  player.teleport({ x: foreman.tile.x, y: foreman.tile.y + 1 });
  talk(world, player, foreman, 'Load');
  assert.equal(player.inventory.countOf(item('mech_blueprint')), 0);
  assert.ok(world.flags.blueprint_loaded);
  assert.equal(Quests.stageOf(player, 'ignition'), 'build_mech');
  // The mech being finished (by anyone) moves everyone building it on.
  world.flags.mech_complete = true;
  world.runTick();
  assert.equal(Quests.stageOf(player, 'ignition'), 'power_up');
  talk(world, player, foreman, 'Power');
  assert.ok(Quests.isDone(player, 'ignition'));
  assert.equal(player.inventory.countOf(item('pilot_wings')), 1);
});

test('Found Art: the scrap artist takes the three things only when you have them all', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const juno = npcOf(world, 'scrap_artist');
  talk(world, player, juno, 'Sure');
  assert.equal(Quests.stageOf(player, 'found_art'), 'collect');
  // Sentry husks give an eye while you're looking for one.
  player.xp.salvaging = Skills.xpForLevel(20);
  const husk = world.addNode(Content.nodeDef('sentry_husk'), { x: player.tile.x + 1, y: player.tile.y });
  let tries = 0;
  while (player.inventory.countOf(item('sentry_eye')) === 0 && tries++ < 30) {
    husk.respawn_tick = 0;
    husk.successes = 0;
    act(world, player, new InteractAction(husk.id));
    runUntil(world, () => player.task == null, 100);
    if (!world.nodes.has(husk.id)) world._placeObject(husk), world.nodes.set(husk.id, husk);
  }
  assert.equal(player.inventory.countOf(item('sentry_eye')), 1);
  player.inventory.add(item('loader_horn'));
  world.runTick();
  assert.equal(Quests.stageOf(player, 'found_art'), 'collect');
  player.inventory.add(item('coolant_bloom'));
  world.runTick();
  assert.equal(Quests.stageOf(player, 'found_art'), 'bring_parts');
  // Lose one before handing over: the journal steps back a page, so the quest
  // can never sit on a stage whose items are gone.
  player.inventory.remove(item('loader_horn'), 1);
  world.runTick();
  assert.equal(Quests.stageOf(player, 'found_art'), 'collect');
  assert.ok(messages(world, player.id).some((m) => m.includes('journal flips back')));
  player.inventory.add(item('loader_horn'));
  world.runTick();
  assert.equal(Quests.stageOf(player, 'found_art'), 'bring_parts');
  talk(world, player, juno, 'Hand');
  assert.equal(Quests.stageOf(player, 'found_art'), 'press');
  assert.equal(player.inventory.countOf(item('sentry_eye')), 0);
  assert.ok(player.dialogue && player.dialogue.lines[0].text.includes('paint'));
  player.inventory.add(item('paint_reservoir'));
  world.runTick();
  talk(world, player, juno, 'What');
  assert.ok(Quests.isDone(player, 'found_art'));
  assert.equal(player.inventory.countOf(item('paintball_cannon')), 1);
  assert.ok(player.unlocks.overclocked);
});

test('quest progress survives a save, and walking away closes a dialogue', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const pell = npcOf(world, 'surveyor');
  talk(world, player, pell, 'love');
  assert.equal(Quests.stageOf(player, 'survey'), 'survey');
  assert.equal(player.inventory.countOf(item('survey_drone_pet')), 1);
  const copy = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
  assert.equal(Quests.stageOf(copy.entities.get(player.id), 'survey'), 'survey');
  talk(world, player, pell);
  player.teleport({ x: pell.tile.x + 6, y: pell.tile.y });
  world.runTick();
  assert.equal(player.dialogue, null);
});

test('dialogue trees: sub-menus, going back, and the three flag scopes', async () => {
  const { DialogueDef } = await import('../src/sim/defs.js');
  const saved = Content.dialogue.foreman;
  Content.dialogue.foreman = new DialogueDef({
    id: 'foreman',
    entries: [{
      lines: [{ who: 'npc', text: 'Hello.' }],
      choices: [
        {
          text: 'Tell me things.',
          lines: [{ who: 'npc', text: 'About what?' }],
          choices: [
            { text: 'The yard.', lines: [{ who: 'npc', text: 'It holds.' }], do: [{ flag: 'asked_yard', scope: 'dialogue' }], after: 'menu' },
            { text: 'Secret.', if: { flags: [{ flag: 'asked_yard', scope: 'dialogue' }] }, do: [{ flag: 'knows_secret', scope: 'player' }, { flag: 'heard', scope: 'quest', quest: 'ignition' }], after: 'top' },
            { text: 'Never mind.', after: 'parent' },
          ],
        },
        { text: 'Bye.', if: { flags: [{ flag: 'knows_secret', scope: 'player', not: true }] } },
      ],
    }],
  });
  try {
    const world = fresh();
    const player = world.spawnPlayer('Ann');
    const foreman = npcOf(world, 'foreman');
    let d = talk(world, player, foreman, 'Tell me');
    assert.deepEqual(d.lines.map((l) => l.text), ['About what?']);
    assert.deepEqual(d.choices, ['The yard.', 'Never mind.'], 'the secret is hidden until the yard is asked about');
    d = talk(world, player, foreman, 'Tell me');
    act(world, player, new DialogueChoiceAction(0));
    d = player.dialogue;
    assert.deepEqual(d.lines.map((l) => l.text), ['It holds.']);
    assert.deepEqual(d.choices, ['The yard.', 'Secret.', 'Never mind.'], 'back at the same menu, with the dialogue flag set');
    act(world, player, new DialogueChoiceAction(1));
    d = player.dialogue;
    assert.equal(d.lines.length, 0);
    assert.deepEqual(d.choices, ['Tell me things.'], 'at the first menu; the player flag hides Bye');
    assert.equal(player.flags.knows_secret, true);
    assert.equal(player.quest_flags.ignition.heard, true);
    // Closing clears dialogue flags: the secret is hidden again next time.
    act(world, player, new (await import('../src/sim/quests.js')).DialogueCloseAction());
    d = talk(world, player, foreman, 'Tell me');
    assert.deepEqual(d.choices, ['The yard.', 'Never mind.']);
    act(world, player, new DialogueChoiceAction(1));
    assert.deepEqual(player.dialogue.choices, ['Tell me things.'], 'Never mind goes up a menu');
    // Player and quest flags are saved.
    const loaded = SaveGame.fromJSON(SaveGame.toJSON(world), DEFAULT_MAP);
    const again = [...loaded.entities.values()].find((e) => e.isPlayer());
    assert.equal(again.flags.knows_secret, true);
    assert.equal(again.quest_flags.ignition.heard, true);
  } finally {
    Content.dialogue.foreman = saved;
  }
});

test('an NPC stays put while someone talks to it', () => {
  const world = fresh();
  const player = world.spawnPlayer('Ann');
  const foreman = npcOf(world, 'foreman');
  talk(world, player, foreman);
  const at = { ...foreman.tile };
  for (let i = 0; i < 200; i++) {
    world.runTick();
    assert.ok(player.dialogue, 'still talking');
    assert.deepEqual(foreman.tile, at);
  }
});
