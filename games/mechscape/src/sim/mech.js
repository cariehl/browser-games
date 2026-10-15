// The mech project: a walker the whole group builds at the gantry, then
// pilots (and guns) together in the Deadfields.
//
// Building: once the blueprint is loaded (Ignition), anyone can install a
// component at the gantry console. The build state is one shared record per
// mech def (world.mech_builds): what's installed and who installed it. When
// the last part goes in, the mech stands up on the gantry pad.
//
// The mech is an NPC (MechState) with a 2 × 2 footprint and the 'mech'
// brain, which does nothing on its own: its crew drive it. Boarding puts a
// player in the pilot's or gunner's seat; while seated, their clicks are
// routed here (routeAction): the pilot's walk clicks drive it, and either
// seat's attack clicks fire its cannon. The pilot alone can do both.
//
// Running it: moving burns fuel (vent gas), every shot a gas cartridge, and
// HP only comes back through repairs (alloy plating). All three are loaded
// at the repair rig by the drop point, or at the gantry while it's parked.
//
// Mechs can only walk in mech zones (the Deadfields): deploying moves it
// from the pad to the drop point, recalling brings it home. Destroyed, it
// throws its crew clear, leaves wreckage to salvage, and keeps its frame,
// legs and cockpit, so the rebuild is cheaper.

import { Features } from './features.js';
import { Action, registerActions } from './actions.js';
import { NpcBrain } from './npc_brain.js';
import { NpcState } from './entity.js';
import { Content, StationKind } from './defs.js';
import { Combat } from './combat.js';
import { Task, AttackTask, StationHandlers, findBonus } from './tasks.js';
import { GatherNode } from './objects.js';
import { NO_TARGET, eq, chebyshev } from './grid.js';
import { FIREARMS, ENGINEERING } from './skills.js';
import { Text } from './text.js';

export const SEATS = ['pilot', 'gunner'];

/** A walker mech: an NPC with a footprint, a crew, a fuel tank and a magazine. */
export class MechState extends NpcState {
  constructor(id, def, tile) {
    super(id, def, tile);
    this.size = 2;
    this.dynamic = true;
    /** Its MechDef. */
    this.mech = Object.values(Content.mechs || {}).find((m) => m.npc === def) || null;
    /** Seat -> player id, or -1. */
    this.crew = { pilot: -1, gunner: -1 };
    this.fuel = 0;
    this.ammo = 0;
    /** Armor plates installed; each adds HP and defence. */
    this.plates = 0;
    /** Tiles walked since fuel was last burnt. */
    this._walked = 0;
  }

  stats() {
    const def = this.def;
    const m = this.mech;
    if (!m) return def;
    return Object.assign(Object.create(def), {
      hitpoints: def.hitpoints + this.plates * m.plate_hp,
      defence_bonus: def.defence_bonus + this.plates * m.plate_defence,
    });
  }

  maxHp() {
    return this.stats().hitpoints;
  }

  regenerates() {
    return false;
  }

  /** The player in [seat], if they're still aboard. */
  seated(world, seat) {
    const player = world.entities.get(this.crew[seat]);
    return player && player.riding && player.riding.mech === this.id ? player : null;
  }

  crewMembers(world) {
    return SEATS.map((seat) => this.seated(world, seat)).filter(Boolean);
  }

  /** Every tile it stands on. */
  tiles() {
    const out = [];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) out.push({ x: this.tile.x + x, y: this.tile.y + y });
    return out;
  }

  /** Chebyshev distance from the nearest tile of its footprint to [tile]. */
  distanceTo(tile) {
    const [near] = Combat.nearestTiles(this, { tile, size: 1 });
    return chebyshev(near, tile);
  }
}
NpcState.kinds.mech = MechState;

export const Mechs = {
  /** The build record for [def] (a MechDef). */
  build(world, def) {
    return world.mech_builds[def.id];
  },

  /** The mech standing for [build], or null. */
  of(world, build) {
    const mech = world.entities.get(build.mech_id);
    return mech instanceof MechState && !mech.isDead() ? mech : null;
  },

  /** The first (for the alpha, only) mech def. */
  defaultDef() {
    return Object.values(Content.mechs || {})[0] || null;
  },

  /** The name of the area [def] deploys to ("Deadfields"). */
  fieldName(def) {
    return (def && def.drop && Text.areas[def.drop[0]]) || 'field';
  },

  /** Template vars for [def]'s messages: its name and its field's. */
  vars(def, more = {}) {
    return { mech: def ? def.display_name : 'mech', area: Mechs.fieldName(def), ...more };
  },

  /** The mech def a station is for. */
  defFor(station) {
    return (station.def.mech && Content.mechs[station.def.mech]) || Mechs.defaultDef();
  },

  /** What's still missing: [{ item, count }]. */
  missing(def, build) {
    return def.components.map((c) => ({ item: c.item, count: c.count - (build.installed[c.item.id] || 0) })).filter((c) => c.count > 0);
  },

  isComplete(def, build) {
    return Mechs.missing(def, build).length === 0;
  },

  /** A world tile from an [area, x, y] spec. */
  spot(world, spec) {
    const area = world.areas.find((a) => a.id === spec[0]);
    return area ? { x: area.offset.x + spec[1], y: area.offset.y + spec[2] } : null;
  },

  /** Stands a finished mech up on the pad. */
  assemble(world, def, build) {
    const pad = Mechs.spot(world, def.pad) || world.spawn_point;
    const mech = world.addNpc(def.npc, pad);
    mech.plates = build.installed[def.plate_item ? def.plate_item.id : ''] || 0;
    mech.hp = mech.maxHp();
    mech.fuel = Math.round(def.tank / 2);
    mech.ammo = 0;
    build.mech_id = mech.id;
    build.deployed = false;
    return mech;
  },

  /** Is the mech on its pad in camp? */
  parked(world, def, mech) {
    const pad = Mechs.spot(world, def.pad);
    return pad != null && eq(mech.tile, pad);
  },

  /** Puts [player] in [seat] of [mech]. */
  board(world, player, mech, seat) {
    if (player.riding) Mechs.leaveSeat(world, player);
    mech.crew[seat] = player.id;
    player.riding = { mech: mech.id, seat };
    player.clearTask();
    player.path = [];
    player.teleport(mech.tile);
    // Anything fighting you now has to fight the mech.
    for (const other of world.entities.values()) {
      if (other.task instanceof AttackTask && other.task.target_id === player.id) {
        if (other.isNpc() && other.def.attackable) other.task.target_id = mech.id;
        else other.clearTask();
      }
    }
    world.pending_hits = world.pending_hits.filter((h) => h.target_id !== player.id);
    world.message(player.id, seat === 'pilot'
      ? "You climb into the pilot's seat. Click to walk the mech, click an enemy to fire."
      : "You climb into the gunner's seat. Click an enemy to fire; the pilot drives.");
    world.emitEvent(mech.id, 'board', { mech: mech.id, player: player.id, seat });
  },

  /** Takes [player] out of their seat (they stay where they are). */
  leaveSeat(world, player) {
    const riding = player.riding;
    if (!riding) return;
    const mech = world.entities.get(riding.mech);
    if (mech instanceof MechState && mech.crew[riding.seat] === player.id) mech.crew[riding.seat] = -1;
    player.riding = null;
  },

  /** Out of the mech, onto a free tile beside it. */
  climbOut(world, player, text = 'You climb down out of the mech.') {
    const mech = world.entities.get(player.riding ? player.riding.mech : -1);
    Mechs.leaveSeat(world, player);
    if (mech) {
      const tile = Mechs.tileBeside(world, mech);
      player.teleport(tile);
      world.emitEvent(player.id, 'teleport', { entity: player.id, tile });
    }
    world.message(player.id, text);
  },

  /** A free tile touching the mech's footprint (or the nearest free one). */
  tileBeside(world, mech) {
    for (let r = 1; r <= 4; r++) {
      for (let y = mech.tile.y - r; y <= mech.tile.y + 1 + r; y++) {
        for (let x = mech.tile.x - r; x <= mech.tile.x + 1 + r; x++) {
          const t = { x, y };
          if (mech.distanceTo(t) !== r) continue;
          if (world.isWalkable(t) && !world.objectAt(t)) return t;
        }
      }
    }
    const t = world.freeTileNear(mech.tile, 8);
    return eq(t, NO_TARGET) ? { ...mech.tile } : t;
  },

  /** Tells everyone aboard. */
  tellCrew(world, mech, text) {
    for (const p of mech.crewMembers(world)) world.message(p.id, text);
  },

  /**
   * Loads [player]'s repair plating, fuel and ammo into [mech], as much as
   * fits. Returns what went in, or null if nothing did.
   */
  service(world, player, mech) {
    const def = mech.mech;
    const done = [];
    const inv = player.inventory;
    if (def.repair_item && mech.hp < mech.maxHp()) {
      let used = 0;
      while (mech.hp < mech.maxHp() && inv.remove(def.repair_item, 1)) {
        mech.hp = Math.min(mech.maxHp(), mech.hp + def.repair_hp);
        used++;
      }
      if (used) done.push(`${used} ${def.repair_item.display_name.toLowerCase()} on repairs (HP ${mech.hp}/${mech.maxHp()})`);
    }
    if (def.fuel_item && mech.fuel < def.tank) {
      const have = inv.countOf(def.fuel_item);
      const take = Math.min(have, def.tank - mech.fuel);
      if (take > 0 && inv.remove(def.fuel_item, take)) {
        mech.fuel += take;
        done.push(`${take} ${def.fuel_item.display_name.toLowerCase()} in the tank (${mech.fuel}/${def.tank})`);
      }
    }
    if (def.ammo_item && mech.ammo < def.magazine) {
      const have = inv.countOf(def.ammo_item);
      const take = Math.min(have, def.magazine - mech.ammo);
      if (take > 0 && inv.remove(def.ammo_item, take)) {
        mech.ammo += take;
        done.push(`${take} ${def.ammo_item.display_name.toLowerCase()}s in the magazine (${mech.ammo}/${def.magazine})`);
      }
    }
    if (!done.length) return null;
    world.grantXp(player, ENGINEERING, 5 * done.length);
    world.emitEvent(mech.id, 'mech_serviced', { mech: mech.id });
    return done;
  },
};

// --- The crew's orders ------------------------------------------------------

/**
 * The mech fights [target]: fires its cannon (one cartridge a shot) when in
 * reach. Pilot's orders also chase; a gunner's only shoot from where it is.
 */
export class MechAttackTask extends AttackTask {
  constructor(targetId, chase, orderedBy) {
    super(targetId);
    this.chase = chase;
    this.ordered_by = orderedBy;
  }

  process(world, mech) {
    const target = world.entities.get(this.target_id);
    if (!target || target.isDead() || !target.isNpc() || !target.def.attackable) return false;
    const p = Combat.profile(mech);
    mech.face_target = { ...target.tile };
    if (!Combat.canHitEntity(world, mech, target, p.reach)) {
      if (!this.chase) {
        world.message(this.ordered_by, "It's out of the cannon's reach. The pilot has to get closer.");
        return false;
      }
      if (!mech.isMoving() || !this._chasingTile || !eq(this._chasingTile, target.tile)) {
        this._chasingTile = { ...target.tile };
        mech.path = world.pathToReach(mech, target);
        if (mech.path.length === 0) {
          Mechs.tellCrew(world, mech, "The mech can't get there.");
          return false;
        }
      }
      return true;
    }
    if (this.chase) mech.path = [];
    const strike = world.tick + Combat.WINDUP_TICKS;
    if (strike < mech.next_attack_tick) return true;
    if (mech.ammo <= 0) {
      Mechs.tellCrew(world, mech, 'Click. The magazine is empty. Load gas cartridges at the repair rig.');
      return false;
    }
    mech.ammo--;
    mech.next_attack_tick = strike + p.speed;
    Combat.commit(world, mech, target, p, strike);
    return true;
  }
}

/** The crew salvage something too big to do by hand, from the cockpit. Loot goes to whoever asked. */
export class MechSalvageTask extends Task {
  constructor(nodeId, playerId) {
    super();
    this.node_id = nodeId;
    this.player_id = playerId;
    this._next = -1;
  }

  process(world, mech) {
    const node = world.nodes.get(this.node_id);
    const player = world.entities.get(this.player_id);
    if (!node || !player || !player.riding || player.riding.mech !== mech.id) return false;
    const def = node.def;
    if (mech.distanceTo(node.tile) !== 1) {
      if (mech.isMoving()) return true;
      mech.path = world.pathToReach(mech, node);
      if (!mech.path.length) {
        world.message(player.id, "The mech can't get there.");
        return false;
      }
      return true;
    }
    mech.face_target = { ...node.tile };
    if (node.isDepleted(world.tick)) {
      if (this._next < 0) world.message(player.id, `There's nothing left to ${def.verb} here.`);
      return false;
    }
    if (this._next < 0) {
      if (player.level(def.skill) < def.level_required) {
        world.message(player.id, `You need ${def.level_required} ${def.skill} to ${def.verb} this.`);
        return false;
      }
      this._next = world.tick + def.action_ticks;
      mech.activity = def.skill;
      world.message(player.id, `The mech's arms bite into the ${def.display_name.toLowerCase()}.`);
      return true;
    }
    if (world.tick < this._next) return true;
    this._next = world.tick + def.action_ticks;
    world.emitEvent(mech.id, 'gather_attempt', { node: node.id });
    if (!def.possibleLoot().every((item) => player.inventory.canAdd(item))) {
      world.message(player.id, 'Your inventory is too full to hold any more.');
      return false;
    }
    if (world.rng.randf() >= def.successChance(player.level(def.skill))) return true;
    const got = def.rare_loot && world.rng.randf() < def.rare_chance ? def.rare_loot : def.loot;
    player.inventory.add(got);
    world.message(player.id, `The mech tears loose some ${got.display_name.toLowerCase()}.`);
    world.grantXp(player, def.skill, def.xp);
    if (def.bonus_table && world.rng.randf() < def.bonus_chance) findBonus(world, player, def.bonus_table);
    Features.call('onGather', world, player, node);
    node.successes++;
    if ((def.max_successes > 0 && node.successes >= def.max_successes) || world.rng.randf() < def.deplete_chance) {
      node.successes = 0;
      node.respawn_tick = world.tick + Math.max(def.respawn_ticks, 1);
      world.message(player.id, `The ${def.display_name.toLowerCase()} has been stripped bare.`);
      return false;
    }
    return true;
  }
}

/** Walk up to a mech and climb into a seat. */
export class BoardTask extends Task {
  constructor(mechId, seat) {
    super();
    this.mech_id = mechId;
    this.seat = seat;
  }

  process(world, player) {
    const mech = world.entities.get(this.mech_id);
    if (!(mech instanceof MechState) || mech.isDead()) return false;
    if (mech.distanceTo(player.tile) > 1) {
      if (player.isMoving()) return true;
      player.path = world.pathToReach(player, mech);
      if (!player.path.length) {
        world.message(player.id, "I can't reach that.");
        return false;
      }
      return true;
    }
    const taken = mech.seated(world, this.seat);
    if (taken && taken !== player) {
      world.message(player.id, `${taken.display_name} is already in the ${this.seat}'s seat.`);
      return false;
    }
    Mechs.board(world, player, mech, this.seat);
    return false;
  }
}

export class BoardAction extends Action {
  static TYPE = 'board_mech';
  static FIELDS = { mech_id: 'int', seat: 'id' };
  constructor(mechId, seat) {
    super();
    this.mech_id = mechId;
    this.seat = seat;
  }
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, player) {
    if (!SEATS.includes(this.seat)) return;
    const mech = world.entities.get(this.mech_id);
    if (!(mech instanceof MechState) || mech.isDead()) return;
    if (player.riding && player.riding.mech === mech.id) {
      // Swapping seats inside.
      if (player.riding.seat === this.seat) return;
      if (mech.seated(world, this.seat)) {
        world.message(player.id, `Someone's already in the ${this.seat}'s seat.`);
        return;
      }
      Mechs.board(world, player, mech, this.seat);
      return;
    }
    player.task = new BoardTask(mech.id, this.seat);
  }
}

export class LeaveMechAction extends Action {
  static TYPE = 'leave_mech';
  slot() { return 'move'; }
  cancelsTask() { return true; }
  apply(world, player) {
    if (player.riding) Mechs.climbOut(world, player);
  }
}

/** At the gantry: put a component into the build. */
export class InstallComponentAction extends Action {
  static TYPE = 'install_component';
  static FIELDS = { station_id: 'int', item: 'id' };
  constructor(stationId, itemId) {
    super();
    this.station_id = stationId;
    this.item = itemId;
  }
  apply(world, player) {
    const station = world.stations.get(this.station_id);
    if (!station || station.def.kind !== StationKind.GANTRY || !station.isAdjacent(player.tile)) return;
    const def = Mechs.defFor(station);
    const build = Mechs.build(world, def);
    const item = Content.item(this.item);
    if (!def || !build || !item) return;
    if (!world.flags.blueprint_loaded) {
      world.message(player.id, Text.get('mech.no_blueprint', Mechs.vars(def)));
      return;
    }
    const need = def.needs(item) - (build.installed[item.id] || 0);
    if (need <= 0) {
      world.message(player.id, def.needs(item) ? `The mech already has every ${item.display_name.toLowerCase()} it needs.` : "That isn't part of the mech.");
      return;
    }
    if (!player.inventory.remove(item, 1)) return;
    build.installed[item.id] = (build.installed[item.id] || 0) + 1;
    build.contributors.push({ name: player.display_name, item: item.id });
    world.grantXp(player, ENGINEERING, def.install_xp);
    world.emitEvent(station.id, 'mech_install', { station: station.id, item: item.id, player: player.id });
    const left = Mechs.missing(def, build).reduce((n, c) => n + c.count, 0);
    world.message(player.id, `You bolt the ${item.display_name.toLowerCase()} into place. ${left ? `${left} component${left === 1 ? '' : 's'} to go.` : ''}`);
    if (left === 0 && !Mechs.of(world, build)) {
      Mechs.assemble(world, def, build);
      world.flags.mech_complete = true;
      world.announce(Text.get('mech.complete', Mechs.vars(def, { player: player.display_name })));
    }
  }
}

/** At the gantry or the repair rig: deploy, recall or service the mech. */
export class MechCommandAction extends Action {
  static TYPE = 'mech_command';
  static FIELDS = { station_id: 'int', command: 'id' };
  constructor(stationId, command) {
    super();
    this.station_id = stationId;
    this.command = command;
  }
  apply(world, player) {
    const station = world.stations.get(this.station_id);
    if (!station || !station.isAdjacent(player.tile)) return;
    const atGantry = station.def.kind === StationKind.GANTRY;
    if (!atGantry && station.def.kind !== StationKind.REPAIR) return;
    const def = Mechs.defFor(station);
    const build = Mechs.build(world, def);
    const mech = build && Mechs.of(world, build);
    if (!mech) {
      world.message(player.id, 'There is no mech standing to do that with.');
      return;
    }
    const say = (text) => world.message(player.id, text);
    switch (this.command) {
      case 'deploy': {
        if (!atGantry) return;
        if (!Mechs.parked(world, def, mech)) return say("It's already out in the field.");
        if (!world.flags.mech_powered) return say(Text.get('mech.not_powered', Mechs.vars(def)));
        const drop = Mechs.spot(world, def.drop);
        mech.clearTask();
        mech.teleport(drop);
        build.deployed = true;
        world.emitEvent(mech.id, 'teleport', { entity: mech.id, tile: drop });
        world.announce(Text.get('mech.deployed', Mechs.vars(def)));
        return;
      }
      case 'recall': {
        if (!atGantry) return;
        if (Mechs.parked(world, def, mech)) return say("It's already on the pad.");
        if (mech.inCombat(world.tick)) return say("It's in the middle of a fight. Get it clear first.");
        const pad = Mechs.spot(world, def.pad);
        mech.clearTask();
        mech.teleport(pad);
        build.deployed = false;
        world.emitEvent(mech.id, 'teleport', { entity: mech.id, tile: pad });
        say(Text.get('mech.recalled', Mechs.vars(def)));
        return;
      }
      case 'service': {
        if (atGantry && !Mechs.parked(world, def, mech)) return say("It's out in the field. Service it at the repair rig by the drop point.");
        if (!atGantry && mech.distanceTo(station.tile) > Content.rules.mech.rig_range) return say('Bring the mech up to the rig first.');
        const done = Mechs.service(world, player, mech);
        if (!done) {
          const names = [def.repair_item, def.fuel_item, def.ammo_item].filter(Boolean).map((i) => i.display_name.toLowerCase());
          return say(`It doesn't need anything you have. It takes ${names.join(', ')}.`);
        }
        say(`You load ${done.join('; ')}.`);
        if (mech.crewMembers(world).length) Mechs.tellCrew(world, mech, `${player.display_name} services the mech.`);
        return;
      }
    }
  }
}

registerActions(BoardAction, LeaveMechAction, InstallComponentAction, MechCommandAction);

/** What a seated crew member's clicks do. Anything with no use from a seat is refused. */
const PASS_THROUGH = new Set(['chat', 'equip', 'unequip', 'drop', 'swap_items', 'use_item', 'set_combat_style', 'set_run',
  'board_mech', 'leave_mech', 'dialogue_choice', 'dialogue_close', 'debug_grant_xp', 'debug_give', 'call_pet', 'dismiss_pet',
  'trade_offer', 'trade_remove', 'trade_accept', 'trade_cancel']);

function routeSeated(world, player, action) {
  const type = action.constructor.TYPE;
  if (PASS_THROUGH.has(type)) return false;
  const mech = world.entities.get(player.riding.mech);
  if (!(mech instanceof MechState) || mech.isDead()) {
    Mechs.leaveSeat(world, player);
    return false;
  }
  const pilot = player.riding.seat === 'pilot';
  if (type === 'debug_teleport') {
    Mechs.climbOut(world, player, 'You hop out of the mech.');
    return false;
  }
  if (type === 'move') {
    if (!pilot) {
      world.message(player.id, "You're the gunner: the pilot drives.");
      return true;
    }
    if (mech.fuel <= 0) {
      world.message(player.id, `The tank's dry. Fill it with ${mech.mech && mech.mech.fuel_item ? mech.mech.fuel_item.display_name.toLowerCase() : 'fuel'} at the repair rig.`);
      return true;
    }
    if (mech.mech && Mechs.parked(world, mech.mech, mech)) {
      world.message(player.id, Text.get('mech.clamped', Mechs.vars(mech.mech)));
      return true;
    }
    if (mech.task && mech.task.chase !== false) mech.clearTask();
    mech.path = world.findPath(mech.tile, action.target, mech);
    if (!mech.path.length && !eq(mech.tile, action.target)) {
      world.message(player.id, world.inZone(action.target, 'mech') ? "The mech can't fit through there." : Text.get('mech.cant_leave', Mechs.vars(mech.mech)));
    }
    return true;
  }
  if (type === 'attack') {
    const target = world.entities.get(action.target_id);
    if (!target || !target.isNpc() || !target.def.attackable || target.isDead()) return true;
    if (!mech.mech || mech.ammo <= 0) {
      world.message(player.id, `The magazine is empty. Load ${mech.mech && mech.mech.ammo_item ? mech.mech.ammo_item.display_name.toLowerCase() : 'ammo'} at the repair rig.`);
      return true;
    }
    mech.task = new MechAttackTask(target.id, pilot && mech.fuel > 0, player.id);
    return true;
  }
  if (type === 'interact') {
    const object = world.getObject(action.object_id);
    if (object instanceof GatherNode && object.def.requires_mech) {
      if (!pilot) {
        world.message(player.id, 'Only the pilot can work the arms.');
        return true;
      }
      mech.task = new MechSalvageTask(object.id, player.id);
      return true;
    }
  }
  world.message(player.id, "You'd have to climb out of the mech first.");
  return true;
}

// --- Brains -----------------------------------------------------------------

/** A mech only does what its crew tell it, and fights back if someone's aboard to fire. */
class MechBrain extends NpcBrain {
  think() {}

  beforeTask() {
    return true;
  }

  holdsPosition() {
    return false;
  }

  cannotReach(world, mech) {
    Mechs.tellCrew(world, mech, "The mech can't get there.");
  }

  retaliate(mech, attacker) {
    if (mech.task != null || mech.ammo <= 0 || mech.crew.pilot < 0 && mech.crew.gunner < 0) return;
    if (!attacker.isNpc() || !attacker.def.attackable) return;
    mech.task = new MechAttackTask(attacker.id, false, mech.crew.gunner >= 0 ? mech.crew.gunner : mech.crew.pilot);
  }
}
NpcBrain.register('mech', new MechBrain());

/**
 * The colossus wants the mech: it goes for a mech in sight before anyone on
 * foot, and drops a pilot on foot the moment a mech turns up.
 */
class ColossusBrain extends NpcBrain {
  think(world, npc) {
    if (!npc.isDead() && (npc.task == null || this._onFoot(world, npc))) {
      const mech = this._nearestMech(world, npc);
      if (mech) {
        npc.task = new AttackTask(mech.id);
        return;
      }
    }
    super.think(world, npc);
  }

  _onFoot(world, npc) {
    const target = npc.task instanceof AttackTask ? world.entities.get(npc.task.target_id) : null;
    return target != null && !(target instanceof MechState);
  }

  _nearestMech(world, npc) {
    let best = null;
    let bestD = npc.def.aggro_radius * 2 + 1;
    for (const e of world.entities.values()) {
      if (!(e instanceof MechState) || e.isDead() || world.areaIdAt(e.tile) !== world.areaIdAt(npc.tile)) continue;
      const d = e.distanceTo(npc.tile);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }
}
NpcBrain.register('colossus', new ColossusBrain());

// --- Stations ---------------------------------------------------------------

StationHandlers[StationKind.GANTRY] = (world, player, station) => {
  world.emitEvent(player.id, 'open_mech', { station: station.id });
};
StationHandlers[StationKind.REPAIR] = (world, player, station) => {
  world.emitEvent(player.id, 'open_mech', { station: station.id });
};

// --- The feature ------------------------------------------------------------

function buildToData(build) {
  return { installed: { ...build.installed }, contributors: build.contributors.map((c) => ({ ...c })), mech_id: build.mech_id, deployed: build.deployed };
}

Features.register({
  id: 'mech',

  init(world) {
    /** Mech def id -> { installed: { item id: count }, contributors: [{ name, item }], mech_id, deployed }. */
    world.mech_builds = {};
    for (const def of Object.values(Content.mechs || {})) {
      world.mech_builds[def.id] = { installed: {}, contributors: [], mech_id: -1, deployed: false };
    }
  },

  initPlayer(_world, player) {
    player.riding = null;
  },

  /** The foreman's "Power it up!": the first time, the mech wakes and can be deployed. */
  onQuestEvent(world, player, name) {
    if (name !== 'mech_powerup') return;
    const def = Mechs.defaultDef();
    const mech = def && Mechs.of(world, Mechs.build(world, def));
    if (world.flags.mech_powered) return;
    world.flags.mech_powered = true;
    if (mech) world.emitEvent(mech.id, 'mech_powerup', { mech: mech.id });
    world.announce(Text.get('mech.powered_up', Mechs.vars(def, { player: player.display_name })));
  },

  routeAction(world, entity, action) {
    if (!entity.riding) return false;
    return routeSeated(world, entity, action);
  },

  tick(world) {
    for (const mech of world.entities.values()) {
      if (!(mech instanceof MechState)) continue;
      // Fuel: a unit every few tiles walked; an empty tank stops it.
      const walked = Math.max(0, mech.steps_this_tick.length - 1);
      if (walked && mech.mech) {
        mech._walked += walked;
        while (mech._walked >= mech.mech.tiles_per_fuel) {
          mech._walked -= mech.mech.tiles_per_fuel;
          mech.fuel = Math.max(0, mech.fuel - 1);
        }
        if (mech.fuel === 0) {
          mech.path = [];
          if (mech.task && mech.task.chase) mech.task.chase = false;
          Mechs.tellCrew(world, mech, "The engine coughs and dies: the tank's empty. Someone on foot can fill it at the repair rig.");
        }
      }
      // A destroyed mech's NPC goes once its wreckage is down (see onKill).
      if (mech.isDead()) world.removeNpc(mech.id);
    }
    // The crew ride along.
    for (const player of world.players()) {
      if (!player.riding) continue;
      const mech = world.entities.get(player.riding.mech);
      if (!(mech instanceof MechState) || mech.isDead()) {
        Mechs.leaveSeat(world, player);
        continue;
      }
      player.tile = { ...mech.tile };
      player.path = [];
      player.steps_this_tick = mech.steps_this_tick.map((t) => ({ ...t }));
    }
  },

  onKill(world, victim) {
    if (!(victim instanceof MechState)) {
      // A seated pilot can't die, but just in case: they leave their seat.
      if (victim.riding) Mechs.leaveSeat(world, victim);
      return;
    }
    const def = victim.mech;
    for (const seat of SEATS) {
      const p = victim.seated(world, seat);
      if (p) Mechs.climbOut(world, p, 'The mech goes down! You\'re thrown clear of the cockpit.');
    }
    const build = def && Mechs.build(world, def);
    if (!build) return;
    const kept = {};
    for (const id of def.keep_on_destroy) if (build.installed[id]) kept[id] = build.installed[id];
    build.installed = kept;
    build.mech_id = -1;
    build.deployed = false;
    const survivors = def.keep_on_destroy.map((id) => (Content.item(id) ? Content.item(id).display_name.toLowerCase() : id));
    world.announce(Text.get('mech.destroyed', Mechs.vars(def, { kept: Text.list(survivors) })));
  },

  /** Seated crew can't be hurt; only a mech can hurt a mech-only boss. */
  hitDamage(damage, world, attacker, target) {
    if (target.riding) return 0;
    if (target.isNpc() && target.def.mech_only_damage && !(attacker instanceof MechState)) {
      world.emitEvent(target.id, 'no_effect', { attacker: attacker ? attacker.id : -1, target: target.id });
      if (attacker && !attacker.isNpc()) world.message(attacker.id, Text.get('mech.only_mechs_hurt'));
      return 0;
    }
    // The crew learn from the mech's shots.
    if (attacker instanceof MechState && damage > 0) {
      const shooter = attacker.seated(world, 'gunner') || attacker.seated(world, 'pilot');
      if (shooter) world.grantXp(shooter, FIREARMS, damage * 2);
    }
    return damage;
  },

  save(world) {
    const out = {};
    for (const [id, build] of Object.entries(world.mech_builds)) {
      const data = buildToData(build);
      const mech = Mechs.of(world, build);
      data.mech = mech ? { tile: mech.tile, hp: mech.hp, fuel: mech.fuel, ammo: mech.ammo } : null;
      delete data.mech_id;
      out[id] = data;
    }
    return out;
  },

  load(world, data) {
    for (const [id, saved] of Object.entries(data || {})) {
      const def = Content.mechs[id];
      const build = world.mech_builds[id];
      if (!def || !build) continue;
      build.installed = { ...(saved.installed || {}) };
      build.contributors = (saved.contributors || []).map((c) => ({ ...c }));
      build.deployed = !!saved.deployed;
      if (saved.mech) {
        const mech = Mechs.assemble(world, def, build);
        // Off the map (an area moved since the save): back on its pad.
        mech.teleport(world.areaIdAt(saved.mech.tile) >= 0 ? saved.mech.tile : Mechs.spot(world, def.pad) || world.spawn_point);
        mech.hp = Math.min(saved.mech.hp, mech.maxHp());
        mech.fuel = saved.mech.fuel;
        mech.ammo = saved.mech.ammo;
        build.deployed = !!saved.deployed;
      }
    }
  },

  snapshot(world) {
    const out = {};
    for (const [id, build] of Object.entries(world.mech_builds)) {
      const data = buildToData(build);
      const mech = Mechs.of(world, build);
      if (mech) Object.assign(data, { crew: { ...mech.crew }, fuel: mech.fuel, ammo: mech.ammo, plates: mech.plates });
      out[id] = data;
    }
    return out;
  },

  apply(world, data) {
    world.mech_builds = data;
    for (const build of Object.values(data)) {
      const mech = world.entities.get(build.mech_id);
      if (!(mech instanceof MechState) || build.crew === undefined) continue;
      mech.crew = build.crew;
      mech.fuel = build.fuel;
      mech.ammo = build.ammo;
      mech.plates = build.plates;
    }
  },

  publicPlayer(player) {
    return player.riding ? { ...player.riding } : null;
  },

  applyPlayer(_world, player, data) {
    player.riding = data || null;
  },
});
