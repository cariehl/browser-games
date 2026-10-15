// Pure data for anything that lives on the tile grid: players, and (via
// NpcState) NPCs.

import { NO_TARGET, eq } from './grid.js';
import { Inventory, Storage } from './inventory.js';
import { Skills, TOUGHNESS, ENDURANCE } from './skills.js';
import { NpcBrain } from './npc_brain.js';

/** How long after a hit someone counts as "in combat" (no regen, HP bar shown). */
export const COMBAT_TICKS = 10;

export class EntityState {
  constructor(id, tile) {
    this.id = id;
    /** Shown above the player and in chat. Empty for NPCs. */
    this.display_name = '';
    this.tile = { ...tile };
    /** Where this entity respawns (players) or wanders around (NPCs). */
    this.spawn_tile = { ...tile };
    this.path = [];
    this.running = false;
    /**
     * Tiles occupied during the latest tick, starting tile first. Views
     * interpolate along this polyline, so running round a corner doesn't
     * cut across it.
     */
    this.steps_this_tick = [{ ...tile }];
    /** skill id -> total XP */
    this.xp = {};
    this.inventory = new Inventory();
    /** Items kept at storage lockers. Players only: null for NPCs. */
    this.storage = new Storage();
    this.hp = 10;
    /** Implants: slot -> ItemDef. They survive death. Empty until the Implants skill exists. */
    this.implants = {};
    /** Wielded weapon, or null for fists. */
    this.weapon = null;
    /** Worn armor: slot ("head", "torso", "legs", "arms") -> ItemDef. */
    this.armor = {};
    /** Combat XP goes to the weapon's skill, or to Endurance when true. */
    this.train_endurance = false;
    /** Earliest tick this entity's next attack may strike (it's committed the tick before). */
    this.next_attack_tick = 0;
    this.last_combat_tick = -1000;
    /** Temporary boosts: skill -> { amount, until }. Not saved. */
    this.boosts = {};
    /** Earliest tick this entity may use another consumable. */
    this.next_use_tick = 0;
    /** seq of the latest client action applied (see Action.seq). Not saved. */
    this.last_action_seq = 0;
    /** The multi-tick thing being done (gathering, crafting, fighting), or null. */
    this.task = null;
    /** Skill being trained right now, for views to animate. Empty when idle. */
    this.activity = '';
    /** Tile to face while working on something, or NO_TARGET. */
    this.face_target = NO_TARGET;
    /** The open trade's id, or -1. Not saved. */
    this.trade_id = -1;
    /** A trade asked for: { target, until }, or null. Not saved. */
    this.trade_request = null;

    for (const [skill, level] of Object.entries(Skills.STARTING_LEVELS)) this.xp[skill] = Skills.xpForLevel(level);
    this.hp = this.level(TOUGHNESS);
  }

  /** Total defence bonus from worn armor. */
  armorBonus() {
    let total = 0;
    for (const item of Object.values(this.armor)) total += item.defence_bonus;
    return total;
  }

  /** Advance along the path: 1 tile per tick walking, 2 running. */
  step() {
    this.steps_this_tick = [{ ...this.tile }];
    const maxSteps = this.running ? 2 : 1;
    for (let i = 0; i < maxSteps; i++) {
      if (this.path.length === 0) break;
      this.tile = this.path.shift();
      this.steps_this_tick.push({ ...this.tile });
    }
  }

  isMoving() {
    return this.path.length > 0;
  }

  level(skill) {
    return Skills.levelForXp(this.xp[skill] || 0);
  }

  /** The level including any boost, for rolls. Requirements use level(). */
  effectiveLevel(skill) {
    return this.level(skill) + this.boostOf(skill);
  }

  boostOf(skill) {
    return this.boosts[skill] ? this.boosts[skill].amount : 0;
  }

  maxHp() {
    return this.level(TOUGHNESS);
  }

  isDead() {
    return false;
  }

  isNpc() {
    return false;
  }

  /** A player (not an NPC, a pet or a mech). */
  isPlayer() {
    return !this.isNpc();
  }

  /** What decides its behaviour when no one gives it orders. Null for players. */
  brain() {
    return null;
  }

  inCombat(tick) {
    return tick - this.last_combat_tick < COMBAT_TICKS;
  }

  hasFaceTarget() {
    return !eq(this.face_target, NO_TARGET);
  }

  clearTask() {
    this.task = null;
    this.activity = '';
    this.face_target = NO_TARGET;
  }

  /** Jump to a tile with no walking (respawns). */
  teleport(to) {
    this.tile = { ...to };
    this.path = [];
    this.steps_this_tick = [{ ...to }];
  }

  displayName() {
    return this.display_name;
  }
}

/** An NPC: driven by its brain instead of player input. Stats come from its NpcDef. */
export class NpcState extends EntityState {
  constructor(id, def, tile) {
    super(id, tile);
    this.def = def;
    /** Respawn tick while dead; -1 while alive. */
    this.dead_until = -1;
    /** While dead: where its husk lies (its respawn waits for it). NO_TARGET if none. */
    this.husk_tile = NO_TARGET;
    /** Attacker id -> damage landed since it last respawned or healed. Not saved. */
    this.damage_by = {};
    this.xp = {};
    this.storage = null;
    this.hp = def.hitpoints;
  }

  brain() {
    return this.def.brain || NpcBrain.standard();
  }

  maxHp() {
    return this.def.hitpoints;
  }

  isDead() {
    return this.dead_until >= 0;
  }

  isNpc() {
    return true;
  }

  /** Dead, with its husk still lying around. */
  waitingForHusk() {
    return this.isDead() && !eq(this.husk_tile, NO_TARGET);
  }

  displayName() {
    return this.def.display_name;
  }
}

export { ENDURANCE };
