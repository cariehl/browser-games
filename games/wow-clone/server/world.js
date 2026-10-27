// The raid simulation: movement, abilities, auras, threat and enemies, run on
// a RaidState. RaidRoom feeds it player messages and calls update() every
// tick; it reports what happened through [emit]:
//
//   emit('hit', { source, target, ability, amount, heal, crit, tick })  to everyone
//   emit('error', { text }, raiderId)                                     to one raider
//
// Talents (shared/talents.js) are chosen once per raid and folded into
// combat through talentStats: power, crit, cooldowns, cast times, aura
// durations, health, threat and damage taken.
//
// It knows nothing about the network, so tests can drive it directly.

import { ABILITIES, CLASSES, CRIT_CHANCE, CRIT_MULTIPLIER, HEAL_THREAT } from '../shared/classes.js';
import { distance, facingToward, GCD, isFacing, isMoving, MELEE_RANGE, radiusOf, reach, stepMovement } from '../shared/combat.js';
import { confine } from '../shared/arena.js';
import { ENEMY_KINDS } from '../shared/enemies.js';
import {
  abilitiesOf, auraDurationFor, castTimeFor, cooldownFor, critFor, powerFor, talentProblem, talentStats,
} from '../shared/talents.js';
import { Aura, Enemy, Raider } from './state.js';

const STILL = { forward: 0, strafe: 0 };

/** A cast that ends this far out of range still lands: the target may have stepped back a little. */
const RANGE_SLACK = 2;

/** An enemy switches targets only to someone with this much more threat than its current one (as in WoW). */
const SWITCH_THREAT = 1.1;

/** How long a taunt holds an enemy on the taunter. */
const TAUNT_SECONDS = 3;

export class RaidWorld {
  /** Movement input by raider id: { forward, strafe }. */
  inputs = new Map();
  /** The target a raider's current cast will land on, by raider id. */
  castTargets = new Map();
  /** When each auto-attacking raider can next swing, by raider id. */
  nextSwings = new Map();
  /** What each raider's talents add up to (talentStats), by raider id. */
  stats = new Map();
  /** Next tick time for each ticking aura. */
  auraTicks = new WeakMap();
  /** Server-only enemy state by enemy id: home, swing timer, taunt, respawn. */
  brains = new Map();
  nextEnemy = 1;

  /** [random]: () => [0, 1), swappable for tests. */
  constructor(state, { emit = () => {}, random = Math.random } = {}) {
    this.state = state;
    this.emit = emit;
    this.random = random;
  }

  get time() {
    return this.state.time;
  }

  /** A raider or enemy by id, or undefined. */
  unit(id) {
    return this.state.raiders.get(id) ?? this.state.enemies.get(id);
  }

  isEnemy(id) {
    return this.state.enemies.has(id);
  }

  // ---------------------------------------------------------------- setup

  /** Adds a raider at [spot] ({ x, z, facing }) with full health. */
  addRaider(id, { name, role }, spot) {
    const maxHealth = CLASSES[role].maxHealth;
    this.state.raiders.set(id, new Raider({
      name, role, ...spot, health: maxHealth, maxHealth, targetId: '',
      castAbility: '', castStart: 0, castEnd: 0, connected: true, attacking: false, gcdEnd: 0, warp: 0,
      talentsChosen: false, abilities: abilitiesOf(role),
    }));
  }

  /** Talent stats for raider [id] (none spent: all zeros). */
  statsOf(id) {
    return this.stats.get(id) ?? talentStats('', {});
  }

  /**
   * Spends raider [id]'s talent points: [picks] is { talentId: rank }.
   * Once per raid. Returns null, or why not (also sent as an 'error').
   */
  chooseTalents(id, picks) {
    const raider = this.state.raiders.get(id);
    if (!raider) return 'Unknown raider.';
    const why = raider.talentsChosen ? 'Your talents are already chosen for this raid.' : talentProblem(raider.role, picks);
    if (why) {
      this.emit('error', { text: why }, id);
      return why;
    }
    const clean = Object.fromEntries(Object.entries(picks).filter(([, rank]) => rank > 0));
    for (const [talent, rank] of Object.entries(clean)) raider.talents.set(talent, rank);
    const stats = talentStats(raider.role, clean);
    this.stats.set(id, stats);
    raider.abilities.splice(0, raider.abilities.length, ...abilitiesOf(raider.role, clean));
    raider.maxHealth = Math.round(CLASSES[raider.role].maxHealth * (1 + stats.health));
    raider.health = raider.maxHealth;
    raider.talentsChosen = true;
    return null;
  }

  removeRaider(id) {
    this.state.raiders.delete(id);
    this.inputs.delete(id);
    this.castTargets.delete(id);
    this.nextSwings.delete(id);
    this.stats.delete(id);
    this.forget(id);
  }

  /** Adds an enemy of [kind] at { x, z, facing }. Returns its id. */
  addEnemy(kind, { x, z, facing = 0 }) {
    const info = ENEMY_KINDS[kind];
    const id = `enemy-${this.nextEnemy++}`;
    this.state.enemies.set(id, new Enemy({
      name: info.name, kind, x, z, facing, health: info.maxHealth, maxHealth: info.maxHealth, targetId: '',
      castAbility: '', castStart: 0, castEnd: 0,
    }));
    this.brains.set(id, { home: { x, z, facing }, nextSwing: 0, tauntBy: '', tauntUntil: 0, respawnAt: 0, lastHit: 0, evading: false });
    return id;
  }

  // ------------------------------------------------------- player actions

  /** [input]: { forward, strafe, facing }, already checked by the room. */
  setInput(id, input) {
    const raider = this.state.raiders.get(id);
    if (!raider || raider.health <= 0) return;
    this.inputs.set(id, { forward: input.forward, strafe: input.strafe });
    raider.facing = input.facing;
    if (raider.castAbility && isMoving(input)) this.stopCast(id);
  }

  /** Selects [targetId] ('' clears). Ignores ids that aren't units. */
  setTarget(id, targetId) {
    const raider = this.state.raiders.get(id);
    if (!raider || (targetId && !this.unit(targetId))) return;
    // A new target ends auto-attack on the old one.
    if (targetId !== raider.targetId) raider.attacking = false;
    raider.targetId = targetId;
  }

  /** Starts or stops auto-attacking the current target. */
  setAttack(id, on) {
    const raider = this.state.raiders.get(id);
    if (!raider) return;
    if (!on) {
      raider.attacking = false;
      return;
    }
    const target = this.state.enemies.get(raider.targetId);
    if (!raider.talentsChosen) return this.emit('error', { text: 'Choose your talents first.' }, id);
    if (raider.health <= 0) return this.emit('error', { text: 'You are dead.' }, id);
    if (!target || target.health <= 0) return this.emit('error', { text: 'You have no target.' }, id);
    raider.attacking = true;
  }

  stopCast(id) {
    const raider = this.state.raiders.get(id);
    if (!raider?.castAbility) return;
    raider.castAbility = '';
    this.castTargets.delete(id);
  }

  /** Respawns a dead raider at [spot] with full health. */
  release(id, spot) {
    const raider = this.state.raiders.get(id);
    if (!raider || raider.health > 0) return;
    Object.assign(raider, spot);
    raider.health = raider.maxHealth;
    raider.warp = (raider.warp + 1) % 65536;
    this.inputs.delete(id);
  }

  /**
   * Starts [abilityId] for raider [id] on their current target. Returns null
   * if it started, or why not (also sent to them as an 'error').
   */
  cast(id, abilityId) {
    const raider = this.state.raiders.get(id);
    // Not one of theirs: a bad message, not a mistake to tell them about.
    if (!raider || !raider.abilities.includes(abilityId)) return 'Unknown ability.';
    const why = this.tryCast(id, abilityId);
    if (why) this.emit('error', { text: why }, id);
    return why;
  }

  tryCast(id, abilityId) {
    const raider = this.state.raiders.get(id);
    const ability = ABILITIES[abilityId];
    if (!raider.talentsChosen) return 'Choose your talents first.';
    if (raider.health <= 0) return 'You are dead.';
    if (raider.castAbility) return 'You are already casting.';
    if (ability.gcd !== false && this.time < raider.gcdEnd) return 'Not ready yet.';
    if (this.time < (raider.cooldowns.get(abilityId) ?? 0)) return 'That ability is on cooldown.';
    if (ability.cast && isMoving(this.inputs.get(id))) return "Can't do that while moving.";

    const targetId = this.pickTarget(raider, id, ability);
    if (targetId === null) return ability.target === 'enemy' ? 'You have no target.' : 'Invalid target.';
    const why = this.checkTarget(raider, targetId, ability, 0);
    if (why) return why;

    if (ability.gcd !== false) raider.gcdEnd = this.time + GCD;
    const castTime = castTimeFor(this.statsOf(id), abilityId);
    if (castTime > 0) {
      raider.castAbility = abilityId;
      raider.castStart = this.time;
      raider.castEnd = this.time + castTime;
      this.castTargets.set(id, targetId);
    } else {
      this.land(id, abilityId, targetId);
    }
    return null;
  }

  /** The id an ability will land on: the raider's target or themselves. null if there's nothing suitable. */
  pickTarget(raider, id, ability) {
    const target = this.unit(raider.targetId);
    switch (ability.target) {
      case 'enemy':
        return target && this.isEnemy(raider.targetId) ? raider.targetId : null;
      case 'friendly':
        // A friendly spell with an enemy (or nothing) selected goes on yourself.
        return target && !this.isEnemy(raider.targetId) ? raider.targetId : id;
      default:
        return id;
    }
  }

  /** Why [ability] can't land on [targetId] now, or null. [slack] widens the range. */
  checkTarget(raider, targetId, ability, slack) {
    const target = this.unit(targetId);
    if (!target) return 'Invalid target.';
    if (target.health <= 0) return 'Your target is dead.';
    if (target === raider) return null;
    if (ability.range && reach(raider, target) > ability.range + slack) return 'Out of range.';
    if (ability.target === 'enemy' && !isFacing(raider, target)) return 'You must face your target.';
    return null;
  }

  /** Applies a finished ability: damage, healing, auras, taunt. Starts its cooldown. */
  land(id, abilityId, targetId) {
    const raider = this.state.raiders.get(id);
    const ability = ABILITIES[abilityId];
    const stats = this.statsOf(id);
    if (ability.cooldown) raider.cooldowns.set(abilityId, this.time + cooldownFor(stats, abilityId));
    // Melee abilities start auto-attack, as in WoW.
    if (ability.target === 'enemy' && ability.range === MELEE_RANGE) raider.attacking = true;

    let targets = [targetId];
    if (ability.target === 'enemiesAround' || ability.target === 'alliesAround') {
      const pool = ability.target === 'enemiesAround' ? this.state.enemies : this.state.raiders;
      targets = [...pool.entries()]
        .filter(([, u]) => u.health > 0 && distance(raider, u) - radiusOf(u) <= ability.radius)
        .map(([uid]) => uid);
    }
    for (const tid of targets) {
      if (ability.damage) {
        const hit = this.roll(ability.damage, critFor(stats, abilityId));
        hit.amount *= this.damageDone(raider) * powerFor(stats, abilityId);
        this.damage(id, tid, hit, abilityId);
      }
      if (ability.heal) {
        const hit = this.roll(ability.heal, critFor(stats, abilityId));
        hit.amount *= powerFor(stats, abilityId);
        this.heal(id, tid, hit, abilityId);
      }
      if (ability.aura) this.applyAura(id, tid, abilityId);
      if (ability.taunt) this.taunt(id, tid);
    }
  }

  /** A roll in [min, max], with [critChance] to crit: { amount, crit }. */
  roll([min, max], critChance = CRIT_CHANCE) {
    const amount = min + this.random() * (max - min);
    const crit = this.random() < critChance;
    return { amount: crit ? amount * CRIT_MULTIPLIER : amount, crit };
  }

  /** The multiplier on damage [unit] deals from its auras. */
  damageDone(unit) {
    let k = 1;
    for (const aura of unit.auras.values()) k *= ABILITIES[aura.ability]?.aura?.damageDone ?? 1;
    return k;
  }

  /** [id] is the unit's id: raiders' talents can lower it. */
  damageTaken(unit, id) {
    let k = 1 - (this.stats.get(id)?.damageTaken ?? 0);
    for (const aura of unit.auras.values()) k *= ABILITIES[aura.ability]?.aura?.damageTaken ?? 1;
    return k;
  }

  // ----------------------------------------------------- damage and heals

  /** [hit]: { amount, crit } (or a number). Applies reductions, threat and death. */
  damage(sourceId, targetId, hit, abilityId, tick = false) {
    const target = this.unit(targetId);
    if (!target || target.health <= 0) return;
    const { amount: raw, crit = false } = typeof hit === 'number' ? { amount: hit } : hit;
    let amount = Math.max(1, Math.round(raw * this.damageTaken(target, targetId)));
    const enemy = this.isEnemy(targetId);
    const floor = enemy && ENEMY_KINDS[target.kind].immortal ? 1 : 0;
    amount = Math.min(amount, target.health - floor);
    target.health -= amount;
    this.emit('hit', { source: sourceId, target: targetId, ability: abilityId, amount, heal: false, crit, tick });

    if (enemy) {
      const source = this.state.raiders.get(sourceId);
      if (source) {
        const threat = CLASSES[source.role].threat * (1 + this.statsOf(sourceId).threat) * (ABILITIES[abilityId]?.threat ?? 1);
        this.addThreat(targetId, sourceId, amount * threat);
      }
      this.brains.get(targetId).lastHit = this.time;
      if (target.health <= 0) this.enemyDied(targetId);
    } else if (target.health <= 0) {
      this.raiderDied(targetId);
    }
  }

  heal(sourceId, targetId, hit, abilityId, tick = false) {
    const target = this.unit(targetId);
    if (!target || target.health <= 0) return;
    const { amount: raw, crit = false } = typeof hit === 'number' ? { amount: hit } : hit;
    const amount = Math.min(Math.round(raw), target.maxHealth - target.health);
    target.health += amount;
    this.emit('hit', { source: sourceId, target: targetId, ability: abilityId, amount, heal: true, crit, tick });
    // Every enemy fighting the healed raider takes notice of the healer.
    if (amount > 0 && this.state.raiders.has(sourceId)) {
      for (const [eid, enemy] of this.state.enemies.entries()) {
        if (enemy.health > 0 && enemy.threat.has(targetId)) this.addThreat(eid, sourceId, amount * HEAL_THREAT);
      }
    }
  }

  applyAura(sourceId, targetId, abilityId) {
    const target = this.unit(targetId);
    if (!target || target.health <= 0) return;
    const spec = ABILITIES[abilityId].aura;
    const duration = auraDurationFor(this.statsOf(sourceId), abilityId);
    const key = `${abilityId}:${sourceId}`;
    let aura = target.auras.get(key);
    if (aura) {
      aura.ends = this.time + duration;
    } else {
      aura = new Aura({ ability: abilityId, sourceId, ends: this.time + duration });
      target.auras.set(key, aura);
    }
    if (spec.every) this.auraTicks.set(aura, this.time + spec.every);
    // A debuff counts as an attack: the enemy notices whoever applied it.
    if (this.isEnemy(targetId) && this.state.raiders.has(sourceId)) this.addThreat(targetId, sourceId, 1);
  }

  taunt(sourceId, enemyId) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy || enemy.health <= 0) return;
    const top = Math.max(0, ...enemy.threat.values());
    enemy.threat.set(sourceId, Math.max(top * SWITCH_THREAT, enemy.threat.get(sourceId) ?? 0) + 1);
    const brain = this.brains.get(enemyId);
    brain.tauntBy = sourceId;
    brain.tauntUntil = this.time + TAUNT_SECONDS;
    brain.evading = false;
  }

  addThreat(enemyId, raiderId, amount) {
    const enemy = this.state.enemies.get(enemyId);
    const raider = this.state.raiders.get(raiderId);
    if (!enemy || enemy.health <= 0 || !raider || raider.health <= 0) return;
    if (this.brains.get(enemyId).evading) return;
    enemy.threat.set(raiderId, (enemy.threat.get(raiderId) ?? 0) + amount);
  }

  raiderDied(id) {
    const raider = this.state.raiders.get(id);
    raider.health = 0;
    raider.castAbility = '';
    raider.attacking = false;
    raider.auras.clear();
    this.castTargets.delete(id);
    this.inputs.delete(id);
    this.forget(id);
  }

  enemyDied(id) {
    const enemy = this.state.enemies.get(id);
    const info = ENEMY_KINDS[enemy.kind];
    enemy.health = 0;
    enemy.threat.clear();
    enemy.auras.clear();
    enemy.targetId = '';
    this.brains.get(id).respawnAt = this.time + (info.respawn ?? 10);
  }

  /** Takes raider [id] off every threat table. */
  forget(id) {
    for (const enemy of this.state.enemies.values()) enemy.threat.delete(id);
  }

  // ---------------------------------------------------------- simulation

  /** One simulation step of [dt] seconds. */
  update(dt) {
    this.state.time += dt;
    for (const [id, raider] of this.state.raiders.entries()) {
      if (raider.health <= 0) continue;
      const input = this.inputs.get(id) ?? STILL;
      if (isMoving(input)) {
        const pos = stepMovement(raider, raider.facing, input, dt);
        raider.x = pos.x;
        raider.z = pos.z;
      }
      if (raider.castAbility && this.time >= raider.castEnd) this.finishCast(id, raider);
      if (raider.attacking) this.autoAttack(id, raider);
    }
    for (const [id, unit] of [...this.state.raiders.entries(), ...this.state.enemies.entries()]) this.tickAuras(id, unit);
    for (const [id, enemy] of [...this.state.enemies.entries()]) this.think(id, enemy, dt);
  }

  /** Swings at the target when the swing timer allows and it's in reach and in front. Casting holds the swing. */
  autoAttack(id, raider) {
    const target = this.state.enemies.get(raider.targetId);
    if (!target || target.health <= 0) {
      raider.attacking = false;
      return;
    }
    if (raider.castAbility || this.time < (this.nextSwings.get(id) ?? 0)) return;
    if (reach(raider, target) > MELEE_RANGE || !isFacing(raider, target)) return;
    const attack = CLASSES[raider.role].attack;
    const stats = this.statsOf(id);
    this.nextSwings.set(id, this.time + attack.swing);
    const hit = this.roll(attack.damage, critFor(stats, 'attack'));
    hit.amount *= this.damageDone(raider) * powerFor(stats, 'attack');
    this.damage(id, raider.targetId, hit, 'attack');
  }

  finishCast(id, raider) {
    const abilityId = raider.castAbility;
    const targetId = this.castTargets.get(id);
    raider.castAbility = '';
    this.castTargets.delete(id);
    const why = this.checkTarget(raider, targetId, ABILITIES[abilityId], RANGE_SLACK);
    if (why) return this.emit('error', { text: why }, id);
    this.land(id, abilityId, targetId);
  }

  tickAuras(id, unit) {
    for (const [key, aura] of [...unit.auras.entries()]) {
      const spec = ABILITIES[aura.ability]?.aura;
      let next = this.auraTicks.get(aura);
      while (spec?.every && next !== undefined && next <= this.time + 1e-9 && next <= aura.ends + 1e-9) {
        const power = powerFor(this.statsOf(aura.sourceId), aura.ability);
        if (spec.damage) this.damage(aura.sourceId, id, spec.damage * this.damageDoneBy(aura.sourceId) * power, aura.ability, true);
        if (spec.heal) this.heal(aura.sourceId, id, spec.heal * power, aura.ability, true);
        next += spec.every;
        this.auraTicks.set(aura, next);
        if (unit.health <= 0) return; // Died: auras are gone.
      }
      if (this.time >= aura.ends) unit.auras.delete(key);
    }
  }

  damageDoneBy(id) {
    const unit = this.unit(id);
    return unit ? this.damageDone(unit) : 1;
  }

  // --------------------------------------------------------------- enemies

  think(id, enemy, dt) {
    const info = ENEMY_KINDS[enemy.kind];
    const brain = this.brains.get(id);

    if (enemy.health <= 0) {
      if (this.time >= brain.respawnAt) this.respawn(id, enemy, brain);
      return;
    }
    if (info.passive) {
      // A practice target: it just keeps score, and resets when left alone.
      if (enemy.threat.size && this.time - brain.lastHit > info.resetAfter && !this.hasDebuff(enemy)) this.reset(enemy);
      enemy.targetId = this.topThreat(enemy) ?? '';
      return;
    }

    if (brain.evading) {
      if (this.moveToward(enemy, brain.home, 0.2, info.speed * 1.5, dt)) {
        brain.evading = false;
        enemy.facing = brain.home.facing;
      }
      return;
    }

    // Everyone it was fighting is dead or gone: back home.
    if (enemy.threat.size === 0 && enemy.targetId) return this.evade(id, enemy, brain);
    // Pulled by anyone who wanders close.
    if (enemy.threat.size === 0) {
      for (const [rid, raider] of this.state.raiders.entries()) {
        if (raider.health > 0 && distance(enemy, raider) <= info.aggro) this.addThreat(id, rid, 1);
      }
      if (enemy.threat.size === 0) return;
    }
    if (distance(enemy, brain.home) > info.leash) return this.evade(id, enemy, brain);

    const targetId = this.chooseTarget(enemy, brain);
    if (!targetId) return this.evade(id, enemy, brain);
    if (enemy.targetId !== targetId) {
      enemy.targetId = targetId;
      // A fresh target gets a moment before the first swing.
      brain.nextSwing = Math.max(brain.nextSwing, this.time + 0.5);
    }
    const target = this.state.raiders.get(targetId);
    const reachTo = info.radius + radiusOf(target) + 1;
    const there = this.moveToward(enemy, target, reachTo - 0.3, info.speed, dt);
    enemy.facing = facingToward(enemy, target);
    if ((there || distance(enemy, target) <= reachTo) && this.time >= brain.nextSwing) {
      brain.nextSwing = this.time + info.swing;
      this.damage(id, targetId, this.roll(info.hit), 'melee');
    }
  }

  /** The raider [enemy] should attack: its taunter, its current target, or whoever has the most threat. */
  chooseTarget(enemy, brain) {
    for (const rid of [...enemy.threat.keys()]) {
      if (!(this.state.raiders.get(rid)?.health > 0)) enemy.threat.delete(rid);
    }
    if (brain.tauntBy && this.time < brain.tauntUntil && enemy.threat.has(brain.tauntBy)) return brain.tauntBy;
    const top = this.topThreat(enemy);
    const current = enemy.targetId;
    if (top && current && enemy.threat.has(current) && enemy.threat.get(top) <= enemy.threat.get(current) * SWITCH_THREAT) {
      return current;
    }
    return top;
  }

  topThreat(enemy) {
    let best = null;
    for (const [rid, value] of enemy.threat.entries()) {
      if (best === null || value > enemy.threat.get(best)) best = rid;
    }
    return best;
  }

  hasDebuff(enemy) {
    return enemy.auras.size > 0;
  }

  /** Moves [unit] toward [to] until within [stop]. True once there. */
  moveToward(unit, to, stop, speed, dt) {
    const d = distance(unit, to);
    if (d <= stop) return true;
    const step = Math.min(speed * dt, d - stop);
    const pos = confine(unit.x + ((to.x - unit.x) / d) * step, unit.z + ((to.z - unit.z) / d) * step, radiusOf(unit));
    unit.x = pos.x;
    unit.z = pos.z;
    unit.facing = facingToward(unit, to);
    return d - step <= stop + 1e-6;
  }

  /** Gives up the fight: forgets everyone, heals up and walks home. */
  evade(_id, enemy, brain) {
    this.reset(enemy);
    brain.evading = true;
    brain.tauntBy = '';
  }

  reset(enemy) {
    enemy.threat.clear();
    enemy.auras.clear();
    enemy.targetId = '';
    enemy.health = enemy.maxHealth;
  }

  respawn(id, enemy, brain) {
    Object.assign(enemy, brain.home);
    this.reset(enemy);
    Object.assign(brain, { nextSwing: 0, tauntBy: '', tauntUntil: 0, evading: false });
  }
}
