// The pilot boss: the Splatterpress, in its sealed hall in the Undercroft.
//
// A fight on foot built on tick-timed tile mechanics. Everything is
// scripted from the boss's def (npcs.json "boss"): its arena zone, door,
// add, loot table, and per mode the timings and damage of each mechanic.
//
//   dodge  tiles light up (a ring, a cross, rows, a checkerboard); whoever
//          is on one when it resolves takes a big hit
//   adds   patch drones crawl out of the corners and walk to the boss;
//          each that reaches it repairs it, so kill them on the way
//   soak   marked tiles each need someone standing on them when they
//          resolve (damage split between them), or everyone gets hurt
//   shield the boss can't be hurt until a run of floor panels is stepped
//          on in order; a wrong panel shocks you and resets the run
//
// The easy mode (the end of Found Art) uses dodge and adds only, slowly.
// Overclocked (unlocked by finishing Found Art) is faster and goes through
// three phases by HP. HP and adds scale with the players inside at the
// start. The door seals for the fight, and a death inside leaves the wreck
// outside the door.
//
// Hazards are public world state (world.hazards), sent in every snapshot so
// the view can draw the warnings. Patterns come from world.rng, so the same
// seed gives the same fight.

import { Features } from './features.js';
import { Action, registerActions } from './actions.js';
import { NpcBrain } from './npc_brain.js';
import { NpcState } from './entity.js';
import { Content, StationKind } from './defs.js';
import { AttackTask, StationHandlers } from './tasks.js';
import { eq, key, chebyshev, add, UP, DOWN } from './grid.js';
import { Text } from './text.js';

/** A boss: an NPC whose max HP is set per fight, with a shield. */
export class BossState extends NpcState {
  constructor(id, def, tile) {
    super(id, def, tile);
    /** This fight's max HP (scaled by players), or 0 for its def's. */
    this.max_hp = 0;
    /** While true, hits do nothing (the panel run drops it). */
    this.shield = false;
    /** The mode being fought: its script, or null between fights. */
    this.mode = null;
  }

  stats() {
    if (!this.mode) return this.def;
    return Object.assign(Object.create(this.def), { hitpoints: this.maxHp(), max_hit: this.mode.max_hit, display_name: this.mode.display_name });
  }

  maxHp() {
    return this.max_hp || this.def.hitpoints;
  }

  regenerates() {
    return !this.mode;
  }
}
NpcState.kinds.boss = BossState;

let nextHazardId = 1;

/** [boss]'s line [key] from its script's "text" (npcs.json), filled in; {boss} is the mode's name. */
export function bossText(boss, key, vars = {}) {
  const template = (boss.def.boss.text || {})[key];
  return template == null ? key : Text.fill(template, { boss: (boss.mode || boss.def).display_name, ...vars });
}

export const Arena = {
  /** Every tile of [zone] in [area] (cached per world). */
  tiles(world, zone, area) {
    world._arenaTiles = world._arenaTiles || {};
    const cacheKey = `${zone}@${area}`;
    if (!world._arenaTiles[cacheKey]) {
      const out = [];
      const a = world.areas[area];
      for (let y = a.offset.y; y < a.offset.y + a.size.y; y++) {
        for (let x = a.offset.x; x < a.offset.x + a.size.x; x++) {
          const t = { x, y };
          if (world.inZone(t, zone) && world.isWalkable(t)) out.push(t);
        }
      }
      world._arenaTiles[cacheKey] = out;
    }
    return world._arenaTiles[cacheKey];
  },

  /** The boss NPCs in the world. */
  bosses(world) {
    return [...world.entities.values()].filter((e) => e instanceof BossState);
  },

  /** The boss whose arena [tile] is in, or null. */
  bossFor(world, tile) {
    return Arena.bosses(world).find((b) => world.inZone(tile, b.def.boss.zone) && world.areaIdAt(tile) === world.areaIdAt(b.spawn_tile)) || null;
  },

  /** The boss's door station. */
  door(world, boss) {
    let best = null;
    for (const s of world.stations.values()) {
      if (s.def.id !== boss.def.boss.door) continue;
      if (!best || chebyshev(s.tile, boss.spawn_tile) < chebyshev(best.tile, boss.spawn_tile)) best = s;
    }
    return best;
  },

  /** The tiles either side of a door: [outside, inside]. */
  doorSides(world, door, boss) {
    const sides = [add(door.tile, UP), add(door.tile, DOWN), { x: door.tile.x - 1, y: door.tile.y }, { x: door.tile.x + 1, y: door.tile.y }]
      .filter((t) => world.isWalkable(t));
    const inside = sides.find((t) => world.inZone(t, boss.def.boss.zone));
    const outside = sides.find((t) => !world.inZone(t, boss.def.boss.zone));
    return [outside, inside];
  },

  /** Players alive and on foot inside [boss]'s arena. */
  playersInside(world, boss) {
    return world.players().filter((p) => !p.isDead() && !p.riding && world.inZone(p.tile, boss.def.boss.zone) && world.areaIdAt(p.tile) === world.areaIdAt(boss.spawn_tile));
  },

  /** Starts a fight against [boss] in [modeId] with whoever is inside. */
  start(world, boss, modeId, starter) {
    const mode = boss.def.boss.modes[modeId];
    if (!mode || boss.mode || boss.isDead()) return false;
    const players = Arena.playersInside(world, boss);
    if (!players.length) return false;
    boss.mode = mode;
    boss.mode_id = modeId;
    boss.max_hp = mode.hp + mode.hp_per_player * (players.length - 1);
    boss.hp = boss.max_hp;
    boss.shield = false;
    boss.damage_by = {};
    boss.fight = {
      players: players.map((p) => p.id),
      started: world.tick,
      phase: 0,
      next: { dodge: world.tick + 4, adds: world.tick + Math.round(mode.adds_every / 2), soak: world.tick + 8, run: world.tick },
      run: null,
      shield_until: -1,
      adds: [],
    };
    const names = players.map((p) => p.display_name).join(', ');
    for (const p of players) world.message(p.id, bossText(boss, 'start'));
    world.announce(bossText(boss, 'start_announce', { players: names, take: players.length === 1 ? 'takes' : 'take' }));
    world.emitEvent(boss.id, 'boss_start', { boss: boss.id, mode: modeId, by: starter ? starter.id : -1 });
    return true;
  },

  /** Ends the fight: the door opens, hazards and adds go. */
  end(world, boss, won) {
    const fight = boss.fight;
    if (!fight) return;
    world.hazards = world.hazards.filter((h) => h.boss !== boss.id);
    for (const id of fight.adds) world.removeNpc(id);
    const modeId = boss.mode_id;
    const mode = boss.mode;
    boss.fight = null;
    boss.mode = null;
    boss.mode_id = '';
    boss.shield = false;
    if (won) {
      world.announce(bossText(boss, 'won', { boss: mode.display_name }));
      // Overclocked pays every survivor a roll on the boss's table, on top of its husk.
      const table = Content.lootTables[boss.def.boss.loot];
      if (modeId === 'overclocked' && table) {
        for (const id of fight.players) {
          const p = world.entities.get(id);
          if (!p) continue;
          p.unlocks.overclocked_kills = (p.unlocks.overclocked_kills || 0) + 1;
          const found = table.roll(world.rng);
          if (found && found.item) {
            if (!p.inventory.add(found.item, found.count)) world.dropItem(found.item, found.count, p.tile);
            const loot = `${found.count > 1 ? `${found.count} × ` : 'a '}${found.item.display_name.toLowerCase()}`;
            world.message(p.id, bossText(boss, 'loot', { boss: mode.display_name, loot }));
            if (['cosmetic', 'pet'].includes(found.item.kind)) world.announce(bossText(boss, 'rare_loot', { boss: mode.display_name, player: p.display_name, loot }));
          }
        }
      }
    } else {
      boss.max_hp = 0;
      boss.hp = boss.maxHp();
      boss.path = [];
      boss.clearTask();
      boss.teleport(boss.spawn_tile);
      world.emitEvent(boss.id, 'heal', { entity: boss.id });
      world.announce(bossText(boss, 'reset', { boss: mode.display_name }));
    }
    world.emitEvent(boss.id, 'boss_end', { boss: boss.id, won });
  },

  /** Hurts [player] by [damage] from [boss]'s hazards (a hitsplat, maybe a death). */
  hurt(world, boss, player, damage) {
    const dealt = Math.min(damage, player.hp);
    player.hp -= dealt;
    player.last_combat_tick = world.tick;
    world.emitEvent(player.id, 'hit', { attacker: boss.id, target: player.id, damage: dealt });
    if (player.hp <= 0) world.kill(player, boss);
  },

  /** One tick of [boss]'s fight: phases, new hazards, resolving due ones, adds, the shield. */
  run(world, boss) {
    const fight = boss.fight;
    const mode = boss.mode;
    const inside = Arena.playersInside(world, boss).filter((p) => fight.players.includes(p.id));
    if (!inside.length) {
      Arena.end(world, boss, false);
      return;
    }
    const mechanics = Arena.mechanics(boss);
    const tiles = Arena.tiles(world, boss.def.boss.zone, world.areaIdAt(boss.spawn_tile));
    const rng = world.rng;
    const now = world.tick;

    if (mechanics.includes('dodge') && now >= fight.next.dodge) {
      fight.next.dodge = now + mode.dodge_every;
      const pattern = mode.dodge_patterns[rng.randiRange(0, mode.dodge_patterns.length - 1)];
      const around = inside[rng.randiRange(0, inside.length - 1)].tile;
      const marked = Arena.pattern(pattern, boss.tile, around, tiles, rng);
      if (marked.length) Arena.addHazard(world, boss, 'dodge', marked, now + mode.dodge_warn, mode.dodge_damage);
    }
    if (mechanics.includes('soak') && now >= fight.next.soak) {
      fight.next.soak = now + mode.soak_every;
      const count = Math.max(1, fight.players.length - 1);
      const near = tiles.filter((t) => chebyshev(t, boss.tile) >= 2 && chebyshev(t, boss.tile) <= 4 && !world.objectAt(t));
      const marked = [];
      for (let i = 0; i < count && near.length; i++) marked.push(near.splice(rng.randiRange(0, near.length - 1), 1)[0]);
      Arena.addHazard(world, boss, 'soak', marked, now + mode.soak_warn, mode.soak_damage);
    }
    if (mechanics.includes('adds') && now >= fight.next.adds) {
      fight.next.adds = now + mode.adds_every;
      const def = Content.npcs[boss.def.boss.add];
      const count = mode.adds + mode.adds_per_player * (fight.players.length - 1);
      const corners = Arena.corners(tiles);
      for (let i = 0; i < count && def; i++) {
        const add = world.addNpc(def, corners[(i + rng.randiRange(0, 3)) % corners.length]);
        add.owner_id = boss.id;
        fight.adds.push(add.id);
      }
      for (const p of inside) world.message(p.id, bossText(boss, 'adds'));
    }
    // The shield: up for the whole phase, dropped for a while by a finished panel run.
    if (mechanics.includes('shield')) {
      if (fight.shield_until > now) boss.shield = false;
      else {
        if (!boss.shield) for (const p of inside) world.message(p.id, bossText(boss, 'shield_up'));
        boss.shield = true;
        Arena.runPanels(world, boss, inside, tiles);
      }
    } else boss.shield = false;

    Arena.resolve(world, boss, inside);
    fight.adds = fight.adds.filter((id) => world.entities.has(id));
  },

  /** The mechanics in play now: all of a mode's, or its phase's. */
  mechanics(boss) {
    const mode = boss.mode;
    if (!mode.phases) return mode.adds ? ['dodge', 'adds'] : ['dodge'];
    const frac = boss.hp / boss.maxHp();
    const index = mode.phases.findIndex((p) => frac > p.above);
    const phase = index < 0 ? mode.phases.length - 1 : index;
    if (boss.fight.phase !== phase) {
      boss.fight.phase = phase;
      boss.fight.run = null;
      boss.fight.shield_until = -1;
    }
    return mode.phases[phase].mechanics;
  },

  /** Tiles for a dodge pattern (only arena tiles). */
  pattern(kind, bossTile, around, tiles, rng) {
    const inArena = new Set(tiles.map(key));
    const out = [];
    const push = (t) => { if (inArena.has(key(t))) out.push(t); };
    switch (kind) {
      case 'ring': {
        const r = rng.randiRange(2, 3);
        for (const t of tiles) if (chebyshev(t, bossTile) === r) push(t);
        break;
      }
      case 'cross':
        for (const t of tiles) if (t.x === around.x || t.y === around.y) push(t);
        break;
      case 'rows': {
        const odd = rng.randiRange(0, 1);
        for (const t of tiles) if ((t.y + odd) % 3 === 0) push(t);
        break;
      }
      case 'checker': {
        const odd = rng.randiRange(0, 1);
        for (const t of tiles) if ((t.x + t.y + odd) % 2 === 0 && chebyshev(t, bossTile) > 1) push(t);
        break;
      }
    }
    return out;
  },

  /** The arena's four corner tiles, for adds to crawl out of. */
  corners(tiles) {
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const nearest = (x, y) => tiles.reduce((best, t) => (Math.abs(t.x - x) + Math.abs(t.y - y) < Math.abs(best.x - x) + Math.abs(best.y - y) ? t : best));
    return [nearest(x0, y0), nearest(x1, y0), nearest(x0, y1), nearest(x1, y1)];
  },

  addHazard(world, boss, kind, tiles, resolveTick, damage) {
    const hazard = { id: nextHazardId++, boss: boss.id, kind, tiles, start: world.tick, resolve: resolveTick, damage };
    world.hazards.push(hazard);
    world.emitEvent(boss.id, 'hazard', { boss: boss.id, kind, id: hazard.id });
    return hazard;
  },

  /** Dodge and soak hazards whose time has come. */
  resolve(world, boss, inside) {
    const due = world.hazards.filter((h) => h.boss === boss.id && h.resolve <= world.tick && h.kind !== 'panel');
    if (!due.length) return;
    world.hazards = world.hazards.filter((h) => !due.includes(h));
    const on = (tile) => inside.filter((p) => eq(p.tile, tile));
    for (const h of due) {
      world.emitEvent(boss.id, 'hazard_resolve', { boss: boss.id, id: h.id, kind: h.kind });
      if (h.kind === 'dodge') {
        const marked = new Set(h.tiles.map(key));
        for (const p of inside) if (marked.has(key(p.tile)) && !p.isDead()) Arena.hurt(world, boss, p, h.damage);
      } else if (h.kind === 'soak') {
        for (const t of h.tiles) {
          const soakers = on(t).filter((p) => !p.isDead());
          if (soakers.length) {
            const share = Math.ceil(h.damage / soakers.length);
            for (const p of soakers) Arena.hurt(world, boss, p, share);
          } else {
            for (const p of inside) {
              if (p.isDead()) continue;
              world.message(p.id, bossText(boss, 'soak_missed'));
              Arena.hurt(world, boss, p, boss.mode.wipe_damage);
            }
          }
        }
      }
    }
  },

  /** The panel run that drops the shield. */
  runPanels(world, boss, inside, tiles) {
    const fight = boss.fight;
    const mode = boss.mode;
    const now = world.tick;
    let run = fight.run && world.hazards.find((h) => h.id === fight.run);
    if (run && now > run.resolve) {
      world.hazards = world.hazards.filter((h) => h !== run);
      for (const p of inside) world.message(p.id, bossText(boss, 'run_too_slow'));
      run = null;
    }
    if (!run) {
      const length = mode.run_length + mode.run_per_player * (fight.players.length - 1);
      const free = tiles.filter((t) => chebyshev(t, boss.tile) >= 2 && !world.objectAt(t));
      const panels = [];
      for (let i = 0; i < length && free.length; i++) panels.push(free.splice(world.rng.randiRange(0, free.length - 1), 1)[0]);
      run = Arena.addHazard(world, boss, 'panel', panels, now + mode.run_ticks, mode.shock_damage);
      run.progress = 0;
      fight.run = run.id;
      return;
    }
    for (const p of inside) {
      const at = run.tiles.findIndex((t) => eq(t, p.tile));
      if (at < 0 || at < run.progress) continue;
      if (at === run.progress) {
        run.progress++;
        world.emitEvent(boss.id, 'panel', { boss: boss.id, id: run.id, progress: run.progress });
        if (run.progress >= run.tiles.length) {
          world.hazards = world.hazards.filter((h) => h !== run);
          fight.run = null;
          fight.shield_until = now + mode.shield_down_ticks;
          boss.shield = false;
          for (const q of inside) world.message(q.id, bossText(boss, 'shield_down'));
          world.emitEvent(boss.id, 'shield_down', { boss: boss.id });
          return;
        }
      } else {
        world.message(p.id, bossText(boss, 'wrong_panel'));
        Arena.hurt(world, boss, p, run.damage);
        run.progress = 0;
      }
    }
  },
};

/** Using the hall door: go in or out (not while a fight is on), and wake the boss from inside. */
export class ArenaAction extends Action {
  static TYPE = 'arena';
  static FIELDS = { station_id: 'int', command: 'id' };
  constructor(stationId, command) {
    super();
    this.station_id = stationId;
    this.command = command;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, player) {
    const door = world.stations.get(this.station_id);
    if (!door || door.def.kind !== StationKind.ARENA_DOOR || chebyshev(door.tile, player.tile) > 1) return;
    const boss = Arena.bosses(world).find((b) => Arena.door(world, b) === door);
    if (!boss) return;
    const [outside, inside] = Arena.doorSides(world, door, boss);
    const isInside = world.inZone(player.tile, boss.def.boss.zone);
    if (this.command === 'enter' || this.command === 'leave') {
      if (boss.fight) {
        world.message(player.id, bossText(boss, isInside ? 'sealed_inside' : 'sealed_outside'));
        return;
      }
      const to = this.command === 'enter' ? inside : outside;
      if (!to) return;
      player.teleport(to);
      world.emitEvent(player.id, 'teleport', { entity: player.id, tile: to });
      return;
    }
    if (this.command === 'easy' || this.command === 'overclocked') {
      if (!isInside) {
        world.message(player.id, bossText(boss, 'enter_first'));
        return;
      }
      if (boss.isDead()) {
        world.message(player.id, bossText(boss, 'rebuilding'));
        return;
      }
      if (this.command === 'overclocked' && !player.unlocks.overclocked) {
        world.message(player.id, bossText(boss, 'locked'));
        return;
      }
      Arena.start(world, boss, this.command, player);
    }
  }
}
registerActions(ArenaAction);

StationHandlers[StationKind.ARENA_DOOR] = (world, player, station) => {
  world.emitEvent(player.id, 'open_arena', { station: station.id });
};

/** The boss: still between fights; in one, it goes for whoever's nearest inside. */
class BossBrain extends NpcBrain {
  think(world, npc) {
    if (npc.isDead()) {
      super.think(world, npc);
      return;
    }
    if (!npc.fight) {
      if (!npc.isMoving() && !eq(npc.tile, npc.spawn_tile) && npc.task == null) npc.path = world.findPath(npc.tile, npc.spawn_tile, npc);
      return;
    }
    if (npc.task == null) {
      const inside = Arena.playersInside(world, npc).filter((p) => npc.fight.players.includes(p.id));
      let best = null;
      for (const p of inside) if (!best || chebyshev(p.tile, npc.tile) < chebyshev(best.tile, npc.tile)) best = p;
      if (best) npc.task = new AttackTask(best.id);
    }
  }

  beforeTask(world, npc) {
    if (!(npc.task instanceof AttackTask)) return true;
    const target = world.entities.get(npc.task.target_id);
    return !!target && !target.isDead() && world.inZone(target.tile, npc.def.boss.zone);
  }

  cannotReach() {}

  /** Hit between fights: that starts one, in easy mode. */
  retaliate(npc, attacker) {
    npc._provoked = attacker.id;
  }
}
NpcBrain.register('boss', new BossBrain());

/** Patch drones walk to their boss and repair it if they get there. */
class AddBrain extends NpcBrain {
  think(world, npc) {
    if (npc.isDead()) return;
    const boss = world.entities.get(npc.owner_id);
    if (!boss || boss.isDead() || !boss.fight) {
      world.removeNpc(npc.id);
      return;
    }
    if (chebyshev(npc.tile, boss.tile) <= 1) {
      const heal = boss.mode.add_heal;
      boss.hp = Math.min(boss.maxHp(), boss.hp + heal);
      world.emitEvent(boss.id, 'heal', { entity: boss.id, amount: heal });
      world.emitEvent(npc.id, 'say', { entity: npc.id, text: '*whirr* Patched!' });
      world.removeNpc(npc.id);
      return;
    }
    if (!npc.isMoving()) npc.path = world.pathToAdjacentTile(npc.tile, boss.tile, npc);
  }

  beforeTask() { return false; }
  retaliate() {}
}
NpcBrain.register('press_add', new AddBrain());

Features.register({
  id: 'arena',

  init(world) {
    /** Tile warnings in play: { id, boss, kind: dodge|soak|panel, tiles, start, resolve, damage, progress? }. Public. */
    world.hazards = [];
  },

  tick(world) {
    for (const boss of Arena.bosses(world)) {
      if (boss.isDead()) continue;
      // Someone hit it between fights: it wakes up in easy mode.
      if (!boss.fight && boss._provoked !== undefined) {
        const by = world.entities.get(boss._provoked);
        boss._provoked = undefined;
        Arena.start(world, boss, 'easy', by);
      }
      if (boss.fight) Arena.run(world, boss);
    }
    // Drones that died stay dead.
    for (const e of [...world.entities.values()]) {
      if (e.isNpc() && e.dynamic && e.isDead() && e.def.brain === 'press_add') world.removeNpc(e.id);
    }
  },

  onKill(world, victim) {
    if (victim instanceof BossState && victim.fight) Arena.end(world, victim, true);
  },

  wreckTile(tile, world, player) {
    const boss = Arena.bossFor(world, tile);
    if (!boss) return tile;
    const door = Arena.door(world, boss);
    const [outside] = door ? Arena.doorSides(world, door, boss) : [];
    return outside || tile;
  },

  hitDamage(damage, world, attacker, target) {
    if (target instanceof BossState && target.shield) {
      world.emitEvent(target.id, 'no_effect', { attacker: attacker ? attacker.id : -1, target: target.id });
      return 0;
    }
    // Only the people who started the fight can hurt the boss (anyone else is outside anyway).
    return damage;
  },

  snapshot(world) {
    const bosses = Arena.bosses(world).filter((b) => b.fight).map((b) => ({
      id: b.id, mode: b.mode_id, name: b.mode.display_name, max_hp: b.max_hp, shield: b.shield,
      phase: b.fight.phase, players: b.fight.players,
    }));
    return { hazards: world.hazards, bosses };
  },

  apply(world, data) {
    world.hazards = data.hazards;
    world.boss_fights = data.bosses;
    for (const boss of Arena.bosses(world)) {
      const fight = data.bosses.find((b) => b.id === boss.id);
      boss.max_hp = fight ? fight.max_hp : 0;
      boss.shield = fight ? fight.shield : false;
      boss.fight_view = fight || null;
    }
  },

  save(world) {
    // Fights aren't saved: a restart ends them, and the boss is back at full.
    return {};
  },
});
