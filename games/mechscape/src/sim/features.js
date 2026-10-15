// Features: self-contained parts of the game (quests, appearance, the mech,
// the hab, the pilot boss, the survey) that hook into the World at fixed
// points instead of growing world.js, snapshot.js and save_game.js.
//
// A feature is an object with any of these hooks, all optional:
//
//   init(world)                    world-level state, once the map is loaded
//   initPlayer(world, player)      per-player state, when a player is spawned
//   beforeAction(world, entity, action)  before each player action is applied
//   tick(world)                    once per tick, after tasks (step 4 of runTick)
//   onKill(world, victim, killer)  an entity died (NPC or player), before it's reset
//   onGather(world, entity, node)  a gather attempt succeeded
//   onQuestEvent(world, player, name)  a dialogue choice fired a named event
//   save(world) / load(world, data)              world-level state in saves
//   savePlayer(player) / loadPlayer(world, player, data)  per-player state in saves
//   snapshot(world, viewer) / apply(world, data)  world-level state sent to
//       every client in the viewer's snapshot (viewer may be null)
//   publicPlayer(player) / applyPlayer(world, player, data)  per-player state
//       everyone sees, and the client side of it
//   privatePlayer(world, player) / applyMine(world, player, data)  per-player
//       state only that player is sent
//
// Hooks run in registration order. Features register themselves when their
// module is imported (see all_features.js).

export const Features = {
  list: [],

  register(feature) {
    if (!feature.id) throw new Error('A feature needs an id.');
    if (this.list.some((f) => f.id === feature.id)) return;
    this.list.push(feature);
  },

  /** Calls [hook] on every feature that has it. */
  call(hook, ...args) {
    for (const f of this.list) if (f[hook]) f[hook](...args);
  },

  /** { id: result } from every feature with [hook], leaving out undefined results. */
  collect(hook, ...args) {
    const out = {};
    for (const f of this.list) {
      if (!f[hook]) continue;
      const value = f[hook](...args);
      if (value !== undefined) out[f.id] = value;
    }
    return out;
  },

  /** Feeds each feature its part of [data] (from collect()) through [hook]. */
  feed(hook, data, ...args) {
    if (!data) return;
    for (const f of this.list) if (f[hook] && f.id in data) f[hook](...args, data[f.id]);
  },
};
