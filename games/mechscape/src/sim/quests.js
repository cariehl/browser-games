// Quests and dialogue.
//
// A quest (data/quests.json) is a list of stages. Each stage has journal
// text and a goal; when the goal is met the player moves on to the stage's
// "next", and talking to someone moves "talk" stages on (dialogue effects).
// Goals:
//   { type: 'talk' }                       moved on by a dialogue choice
//   { type: 'visit', area }                be in that area
//   { type: 'have', items: [ids] }         carry one of each
//   { type: 'flag', flag }                 a world flag is set (the mech is done)
//   { type: 'kill', npc, count }           help kill that many (any damage counts)
//   { type: 'scan', count }                landmarks in your survey log
//   { type: 'all', goals: [...] }          every one of them
//
// Dialogue (data/dialogue.json) is per NPC: entries tried in order, the
// first whose "if" holds is what they say. An entry has lines and, at the
// end, choices; each choice has a list of effects ("do"):
//   { start: quest } { stage: [quest, stage] } { complete: quest }
//   { take: item, unless_flag } { give: item } { flag: id } { event: name } { say: text }
// Takes are checked first, so a choice either happens whole or not at all.
// Conditions ("if"): { quest, stage } (stage may be "none" or "done"), { has: item },
// { flag }, { not_flag }.
//
// Progress is per player (player.quests), saved, and sent only to them.
// Everything is decided on the server; the client shows what it's sent.

import { Features } from './features.js';
import { Action, registerActions } from './actions.js';
import { Task, StationHandlers, a } from './tasks.js';
import { Content, StationKind } from './defs.js';
import { chebyshev } from './grid.js';

/** Dialogue closes when you're further than this from who you're talking to. */
const TALK_RANGE = 2;

export const Quests = {
  /** 'none', a stage id, or 'done'. */
  stageOf(player, questId) {
    const q = player.quests && player.quests[questId];
    return q ? q.stage : 'none';
  },

  isDone(player, questId) {
    return Quests.stageOf(player, questId) === 'done';
  },

  start(world, player, questId) {
    const quest = Content.quests[questId];
    if (!quest || Quests.stageOf(player, questId) !== 'none') return;
    world.message(player.id, `You've started a new quest: ${quest.display_name}.`);
    Quests.setStage(world, player, questId, quest.stages[0].id);
  },

  setStage(world, player, questId, stageId) {
    const quest = Content.quests[questId];
    const stage = quest && quest.stage(stageId);
    if (!stage) return;
    player.quests[questId] = { stage: stageId, counts: {} };
    world.emitEvent(player.id, 'quest', { quest: questId, stage: stageId });
    world.message(player.id, `Quest journal (${quest.display_name}): ${stage.journal}`);
    Quests._advance(world, player, questId);
  },

  complete(world, player, questId) {
    const quest = Content.quests[questId];
    if (!quest || Quests.isDone(player, questId)) return;
    player.quests[questId] = { stage: 'done', counts: {} };
    const rewards = quest.rewards || {};
    for (const [skill, amount] of Object.entries(rewards.xp || {})) world.grantXp(player, skill, amount);
    for (const r of rewards.items || []) give(world, player, Content.item(r.item), r.count || 1);
    if (rewards.unlock) player.unlocks[rewards.unlock] = true;
    world.emitEvent(player.id, 'quest_complete', { quest: questId });
    world.message(player.id, `Congratulations, you've completed ${quest.display_name}! You're given ${rewards.text || 'your reward'}.`);
    world.announce(`${player.display_name} has completed the quest ${quest.display_name}!`);
  },

  /** Something happened that a goal might count: kind 'kill' with an NPC def id. */
  notify(world, player, kind, id) {
    for (const [questId, progress] of Object.entries(player.quests)) {
      if (progress.stage === 'done') continue;
      const stage = Content.quests[questId] && Content.quests[questId].stage(progress.stage);
      if (!stage) continue;
      for (const goal of goalsOf(stage.goal)) {
        if (goal.type === kind && goal.npc === id) progress.counts[`${kind}:${id}`] = (progress.counts[`${kind}:${id}`] || 0) + 1;
      }
      Quests._advance(world, player, questId);
    }
  },

  /** Moves a quest on while its stage's goal is met (stages can chain). */
  _advance(world, player, questId) {
    for (let guard = 0; guard < 10; guard++) {
      const progress = player.quests[questId];
      if (!progress || progress.stage === 'done') return;
      const quest = Content.quests[questId];
      const stage = quest.stage(progress.stage);
      if (!stage || !stage.next || !goalMet(world, player, stage.goal, progress)) return;
      Quests.setStage(world, player, questId, stage.next);
      return;
    }
  },

  /** The dialogue entry index NPC [def] would use with [player] now, or -1. */
  entryFor(world, player, talkId) {
    const dialogue = Content.dialogue[talkId];
    if (!dialogue) return -1;
    return dialogue.entries.findIndex((entry) => conditionsHold(world, player, entry.if));
  },

  /** Opens dialogue with [npc]. */
  talk(world, player, npc) {
    const index = Quests.entryFor(world, player, npc.def.talk);
    if (index < 0) {
      world.message(player.id, `The ${npc.def.display_name} doesn't have anything to say.`);
      return;
    }
    const entry = Content.dialogue[npc.def.talk].entries[index];
    player.dialogue = { npc_id: npc.id, talk: npc.def.talk, entry: index, lines: entry.lines, choices: (entry.choices || []).map((c) => c.text), serial: ++player.dialogue_serial };
    npc.path = [];
    npc.face_target = { ...player.tile };
  },

  /** Picks choice [index] of the open dialogue. */
  choose(world, player, index) {
    const open = player.dialogue;
    if (!open) return;
    const npc = world.entities.get(open.npc_id);
    if (!npc || chebyshev(npc.tile, player.tile) > TALK_RANGE) {
      player.dialogue = null;
      return;
    }
    const dialogue = Content.dialogue[open.talk];
    // If things changed since it opened (someone else finished a stage), start over.
    if (Quests.entryFor(world, player, open.talk) !== open.entry) {
      Quests.talk(world, player, npc);
      return;
    }
    const choice = (dialogue.entries[open.entry].choices || [])[index];
    player.dialogue = null;
    if (!choice) return;
    const effects = choice.do || [];
    const takes = effects.filter((e) => e.take && !(e.unless_flag && world.flags[e.unless_flag]));
    for (const e of takes) {
      const item = Content.item(e.take);
      if (!item || player.inventory.countOf(item) < (e.count || 1)) {
        world.message(player.id, `You don't have ${a(item ? item.display_name : e.take)} with you.`);
        return;
      }
    }
    for (const e of takes) player.inventory.remove(Content.item(e.take), e.count || 1);
    let say = null;
    for (const e of effects) {
      if (e.start) Quests.start(world, player, e.start);
      if (e.stage) Quests.setStage(world, player, e.stage[0], e.stage[1]);
      if (e.complete) Quests.complete(world, player, e.complete);
      if (e.give) give(world, player, Content.item(e.give), e.count || 1);
      if (e.flag) world.flags[e.flag] = true;
      if (e.event) Features.call('onQuestEvent', world, player, e.event);
      if (e.say) say = e.say;
    }
    if (say) {
      player.dialogue = { npc_id: npc.id, talk: open.talk, entry: -1, lines: [{ who: 'npc', text: say }], choices: [], serial: ++player.dialogue_serial };
    }
  },
};

function goalsOf(goal) {
  return goal.type === 'all' ? goal.goals : [goal];
}

function goalMet(world, player, goal, progress) {
  switch (goal.type) {
    case 'all': return goal.goals.every((g) => goalMet(world, player, g, progress));
    case 'visit': { const area = world.areaAt(player.tile); return !!area && area.id === goal.area; }
    case 'have': return goal.items.every((id) => player.inventory.countOf(Content.item(id)) > 0);
    case 'flag': return !!world.flags[goal.flag];
    case 'kill': return (progress.counts[`kill:${goal.npc}`] || 0) >= (goal.count || 1);
    case 'scan': return player.survey_log.length >= goal.count;
    default: return false;
  }
}

function conditionsHold(world, player, cond) {
  if (!cond) return true;
  if (cond.quest && Quests.stageOf(player, cond.quest) !== cond.stage) return false;
  if (cond.has && player.inventory.countOf(Content.item(cond.has)) === 0) return false;
  if (cond.flag && !world.flags[cond.flag]) return false;
  if (cond.not_flag && world.flags[cond.not_flag]) return false;
  return true;
}

/** Into the pack, or onto the ground at your feet. */
export function give(world, player, item, count = 1) {
  if (!item) return;
  if (!player.inventory.add(item, count)) {
    world.dropItem(item, count, player.tile);
    world.message(player.id, `Your pack is full, so the ${item.display_name.toLowerCase()} goes on the ground.`);
  }
}

// --- Talking --------------------------------------------------------------

/** Walk up to someone and talk to them. */
export class TalkAction extends Action {
  static TYPE = 'talk';
  static FIELDS = { target_id: 'int' };
  constructor(targetId) {
    super();
    this.target_id = targetId;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, entity) {
    const npc = world.entities.get(this.target_id);
    if (!npc || !npc.isNpc() || !npc.def.talk || npc.isDead()) return;
    entity.path = [];
    if (chebyshev(npc.tile, entity.tile) > 1) {
      entity.path = world.pathToAdjacentTile(entity.tile, npc.tile, entity);
      if (entity.path.length === 0) {
        world.message(entity.id, "I can't reach them.");
        return;
      }
    }
    entity.task = new TalkTask(npc.id);
  }
}

class TalkTask extends Task {
  constructor(npcId) {
    super();
    this.npc_id = npcId;
  }

  process(world, entity) {
    const npc = world.entities.get(this.npc_id);
    if (!npc) return false;
    if (chebyshev(npc.tile, entity.tile) > 1) {
      if (!entity.isMoving()) entity.path = world.pathToAdjacentTile(entity.tile, npc.tile, entity);
      return entity.isMoving();
    }
    entity.path = [];
    entity.face_target = { ...npc.tile };
    Quests.talk(world, entity, npc);
    return false;
  }
}

/** Picks an answer in the dialogue box. */
export class DialogueChoiceAction extends Action {
  static TYPE = 'dialogue_choice';
  static FIELDS = { choice: 'int' };
  constructor(choice) {
    super();
    this.choice = choice;
  }
  slot() { return 'dialogue'; }
  keepsDialogue() { return true; }
  apply(world, entity) {
    Quests.choose(world, entity, this.choice);
  }
}

/** Closes the dialogue box (or it ran out of lines). */
export class DialogueCloseAction extends Action {
  static TYPE = 'dialogue_close';
  slot() { return 'dialogue'; }
  apply(_world, entity) {
    entity.dialogue = null;
  }
}

/** Debug: set (or clear) a world flag, to test what comes after a quest step. */
export class DebugFlagAction extends Action {
  static TYPE = 'debug_flag';
  static FIELDS = { flag: 'id', value: 'bool' };
  constructor(flag, value = true) {
    super();
    this.flag = flag;
    this.value = value;
  }
  slot() { return `debug_flag_${this._unique}`; }
  isDebug() { return true; }
  apply(world) {
    if (this.value) world.flags[this.flag] = true;
    else delete world.flags[this.flag];
  }
}

registerActions(TalkAction, DialogueChoiceAction, DialogueCloseAction, DebugFlagAction);

// --- Stations: vaults and landmarks --------------------------------------

StationHandlers[StationKind.CACHE] = (world, player, station) => {
  const def = station.def;
  const area = world.areaIdAt(station.tile);
  const guard = def.guard && [...world.entities.values()].find((e) => e.isNpc() && e.def.id === def.guard && !e.isDead() && world.areaIdAt(e.tile) === area);
  if (guard) {
    world.message(player.id, `The ${def.display_name.toLowerCase()} won't open while the ${guard.def.display_name.toLowerCase()} stands guard.`);
    return;
  }
  if (!def.gives) return;
  if (player.inventory.countOf(def.gives) > 0) {
    world.message(player.id, `You already have the ${def.gives.display_name.toLowerCase()}.`);
    return;
  }
  if (def.quest && Quests.stageOf(player, def.quest) !== def.quest_stage) {
    world.message(player.id, `The ${def.display_name.toLowerCase()} is open, but there's nothing in it you need.`);
    return;
  }
  give(world, player, def.gives);
  world.message(player.id, `The ${def.display_name.toLowerCase()} hisses open. Inside is ${a(def.gives.display_name)}.`);
  Quests._advance(world, player, def.quest);
};

StationHandlers[StationKind.LANDMARK] = (world, player, station) => {
  const def = station.def;
  const first = !player.survey_log.includes(def.id);
  if (first) player.survey_log.push(def.id);
  world.emitEvent(player.id, 'scan', { station: station.id, landmark: def.id, first });
  world.message(player.id, `${first ? 'Survey log updated' : 'Survey log'}: ${def.display_name}. ${def.lore}`);
  if (first) {
    world.grantXp(player, 'xenobiology', 40);
    for (const questId of Object.keys(player.quests)) Quests._advance(world, player, questId);
  }
};

// --- The feature ----------------------------------------------------------

Features.register({
  id: 'quests',

  init(world) {
    /** World flags quests and dialogue check: blueprint_loaded, mech_complete... Saved and public. */
    world.flags = {};
  },

  initPlayer(_world, player) {
    /** quest id -> { stage, counts } */
    player.quests = {};
    /** Landmark station ids scanned, in order. */
    player.survey_log = [];
    /** Things quests unlocked: { overclocked: true }. */
    player.unlocks = {};
    /** The open dialogue: { npc_id, talk, entry, lines, choices, serial }, or null. Not saved. */
    player.dialogue = null;
    player.dialogue_serial = 0;
  },

  beforeAction(_world, entity, action) {
    if (entity.dialogue && !(action.keepsDialogue && action.keepsDialogue())) entity.dialogue = null;
  },

  tick(world) {
    for (const player of world.players()) {
      for (const questId of Object.keys(player.quests)) Quests._advance(world, player, questId);
      if (player.dialogue) {
        const npc = world.entities.get(player.dialogue.npc_id);
        if (!npc || npc.isDead() || chebyshev(npc.tile, player.tile) > TALK_RANGE) player.dialogue = null;
      }
    }
  },

  onKill(world, victim, killer) {
    if (!victim.isNpc()) return;
    const credited = new Set(Object.keys(victim.damage_by || {}).map(Number));
    if (killer && !killer.isNpc()) credited.add(killer.id);
    for (const id of credited) {
      const player = world.entities.get(id);
      if (player && !player.isNpc()) Quests.notify(world, player, 'kill', victim.def.id);
    }
  },

  onGather(world, player, node) {
    for (const drop of node.def.quest_drops) {
      if (Quests.stageOf(player, drop.quest) !== drop.stage || player.inventory.countOf(drop.item) > 0) continue;
      if (world.rng.randf() < drop.chance) {
        give(world, player, drop.item);
        world.message(player.id, `You find ${a(drop.item.display_name)}! That's just what you were after.`);
      }
    }
  },

  save(world) {
    return { flags: world.flags };
  },

  load(world, data) {
    world.flags = { ...(data.flags || {}) };
  },

  savePlayer(player) {
    return { quests: player.quests, survey_log: player.survey_log, unlocks: player.unlocks };
  },

  loadPlayer(_world, player, data) {
    player.quests = JSON.parse(JSON.stringify(data.quests || {}));
    player.survey_log = [...(data.survey_log || [])];
    player.unlocks = { ...(data.unlocks || {}) };
  },

  snapshot(world) {
    return world.flags;
  },

  apply(world, data) {
    world.flags = data;
  },

  privatePlayer(_world, player) {
    return { quests: player.quests, survey_log: player.survey_log, unlocks: player.unlocks, dialogue: player.dialogue };
  },

  applyMine(_world, player, data) {
    player.quests = data.quests;
    player.survey_log = data.survey_log;
    player.unlocks = data.unlocks;
    player.dialogue = data.dialogue;
  },
});
