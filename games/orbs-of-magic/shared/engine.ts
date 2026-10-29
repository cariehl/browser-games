import { CARDS, cardDef, type CardDef, type TargetSpec } from './cards';
import { deckColors, deckIcon, prebuiltList, validateDeck, type DeckList } from './decks';
import {
  ALL_HEXES, LEY_ORBS, deployRows, dist, inEnemyTerritory, inBounds, key, neighbors, ownHalfRows, same, type Hex,
} from './hex';
import type { Action, CardInst, GameEvent, GameState, Keyword, PlayerState, Target, Unit } from './types';

export const START_SANCTUM = 20;
export const MAX_MANA = 10;
export const MAX_SPELL_MANA = 3;
export const MAX_HAND = 10;
export const START_HAND = 4;

export type ActResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };

export interface PlayerSetup { name: string; deck: DeckList | string; isAI?: boolean }

function shuffle<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const isUnitT = (t: Target): t is { uid: number } => !!t && 'uid' in t;
const isHexT = (t: Target): t is { c: number; r: number } => !!t && 'c' in t;

/**
 * The rules engine. Wraps a plain-data GameState so it can be cloned cheaply
 * (the AI simulates moves on clones) and sent over the wire as-is.
 */
export class Game {
  s: GameState;
  events: GameEvent[] = [];

  constructor(s: GameState) { this.s = s; }

  static create(a: PlayerSetup, b: PlayerSetup, seed = (Math.random() * 2 ** 31) | 0): Game {
    const s: GameState = {
      round: 0, phase: 'mulligan', turn: 0, initiative: 0, passes: 0, players: [], units: [], nextId: 1,
      winner: null, seed, log: [], lastPlayed: null,
    };
    const g = new Game(s);
    for (const setup of [a, b]) {
      let deck = typeof setup.deck === 'string' ? prebuiltList(setup.deck) : setup.deck;
      if (validateDeck(deck.cards)) deck = prebuiltList('');
      const cards: string[] = [];
      for (const [id, n] of deck.cards) for (let i = 0; i < n; i++) cards.push(id);
      const p: PlayerState = {
        name: setup.name, deckId: deck.id, deckName: deck.name, deckColors: deckColors(deck.cards), deckIcon: deckIcon(deck.cards), deck: shuffle(cards, () => g.rand()), hand: [],
        mana: 0, maxMana: 0, spellMana: 0, sanctum: START_SANCTUM, fatigue: 0, mulliganDone: false,
        graveyard: [], isAI: setup.isAI, spellsCast: 0, sanctumDamageDealt: 0, alliesLost: 0,
      };
      s.players.push(p);
    }
    s.initiative = g.rand() < 0.5 ? 0 : 1;
    s.turn = s.initiative;
    for (let p = 0; p < 2; p++) g.draw(p, START_HAND, true);
    g.events = [];
    return g;
  }

  clone(): Game { return new Game(structuredClone(this.s)); }

  // ───────────── randomness ─────────────
  rand(): number {
    let t = (this.s.seed = (this.s.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.rand() * arr.length)]; }

  // ───────────── queries ─────────────
  unit(uid: number) { return this.s.units.find((u) => u.uid === uid); }
  unitAt(h: Hex) { return this.s.units.find((u) => u.c === h.c && u.r === h.r && u.hp > 0); }
  isEmpty(h: Hex) { return inBounds(h) && !this.unitAt(h); }
  unitsOf(p: number) { return this.s.units.filter((u) => u.owner === p && u.hp > 0); }
  adjacentUnits(h: Hex) { return neighbors(h).map((n) => this.unitAt(n)).filter((u): u is Unit => !!u); }
  power(u: Unit) { return Math.max(0, u.atk + u.tempAtk); }
  has(u: Unit, k: Keyword) { return u.kw.includes(k); }
  tUnit(t: Target) { return isUnitT(t) ? this.unit(t.uid) : undefined; }
  isRooted(u: Unit) { return u.rootedUntil >= this.s.round; }
  canAct(u: Unit) {
    return u.hp > 0 && !u.exhausted && (u.summonedRound !== this.s.round || this.has(u, 'swift'));
  }
  isDeployHex(p: number, h: Hex) { return deployRows(p).includes(h.r) && this.isEmpty(h); }
  emptyDeployHexes(p: number) { return ALL_HEXES.filter((h) => this.isDeployHex(p, h)); }
  randomEmptyNeighbor(h: Hex) {
    const opts = neighbors(h).filter((n) => this.isEmpty(n));
    return opts.length ? this.pick(opts) : undefined;
  }

  cost(p: number, ci: CardInst): number {
    const d = cardDef(ci.cardId);
    let c = d.cost + ci.costMod;
    if (d.type !== 'unit') for (const u of this.unitsOf(p)) c -= cardDef(u.cardId).spellDiscount ?? 0;
    return Math.max(0, c);
  }
  canAfford(p: number, ci: CardInst) {
    const pl = this.s.players[p];
    const c = this.cost(p, ci);
    return cardDef(ci.cardId).type === 'unit' ? pl.mana >= c : pl.mana + pl.spellMana >= c;
  }

  /** All target specs a card needs, in order. Units get an implicit deploy hex first. */
  specs(d: CardDef): TargetSpec[] {
    const extra = d.targets ?? [];
    if (d.type !== 'unit') return extra;
    const infiltrate = d.kw?.includes('infiltrate');
    const deploy: TargetSpec = {
      kind: 'hex', prompt: infiltrate ? 'Summon anywhere in your half' : 'Choose a hex in your deployment zone',
      hexFilter: infiltrate ? (g, h, p) => ownHalfRows(p).includes(h.r) : (g, h, p) => deployRows(p).includes(h.r),
    };
    return [deploy, ...extra];
  }

  /** Every legal choice for spec number `i` given earlier picks. */
  candidates(p: number, d: CardDef, prev: Target[], i: number): Target[] {
    const spec = this.specs(d)[i];
    if (spec.kind === 'hex') {
      return ALL_HEXES.filter((h) => this.isEmpty(h) && (!spec.hexFilter || spec.hexFilter(this, h, p, prev)))
        .map((h) => ({ c: h.c, r: h.r }));
    }
    return this.s.units
      .filter((u) => u.hp > 0)
      .filter((u) => spec.side === 'any' || !spec.side || (spec.side === 'friendly' ? u.owner === p : u.owner !== p))
      .filter((u) => !spec.filter || spec.filter(this, u, p, prev))
      .map((u) => ({ uid: u.uid }));
  }

  validTarget(p: number, d: CardDef, prev: Target[], i: number, t: Target): boolean {
    const spec = this.specs(d)[i];
    if (t === null) return !!spec.optional;
    return this.candidates(p, d, prev, i).some((c) => JSON.stringify(c) === JSON.stringify(t));
  }

  /** Can the card be played at all (affordable + every required target has a choice)? */
  playable(p: number, ci: CardInst): boolean {
    if (this.s.phase !== 'action' || this.s.turn !== p) return false;
    if (!this.canAfford(p, ci)) return false;
    const d = cardDef(ci.cardId);
    const specs = this.specs(d);
    if (specs.length === 0) return true;
    // Required first target must exist. Later targets are checked as the player picks.
    const first = this.candidates(p, d, [], 0);
    if (first.length === 0 && !specs[0].optional) return false;
    if (specs.length > 1 && !specs[1].optional && d.type !== 'unit') {
      return first.some((t) => this.candidates(p, d, [t], 1).length > 0);
    }
    return true;
  }

  /** Hexes a unit can move to this action, with the path to each. */
  reachable(u: Unit): Map<string, Hex[]> {
    const res = new Map<string, Hex[]>();
    if (this.isRooted(u)) return res;
    const flying = this.has(u, 'flying');
    const guarded = (h: Hex) => !flying && this.adjacentUnits(h).some((e) => e.owner !== u.owner && this.has(e, 'guardian'));
    const start: Hex = { c: u.c, r: u.r };
    const seen = new Map<string, Hex[]>([[key(start), [start]]]);
    let frontier: Hex[] = [start];
    for (let step = 0; step < u.speed; step++) {
      const next: Hex[] = [];
      for (const h of frontier) {
        if (step > 0 && guarded(h)) continue; // movement ends when entering a Guardian's zone
        for (const n of neighbors(h)) {
          const k = key(n);
          if (seen.has(k)) continue;
          const occ = this.unitAt(n);
          if (occ && occ.owner !== u.owner && !flying) continue;
          seen.set(k, [...seen.get(key(h))!, n]);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const [k, path] of seen) {
      const h = path[path.length - 1];
      if (path.length > 1 && this.isEmpty(h)) res.set(k, path);
    }
    return res;
  }

  /** What `u` could attack if it stood on `from`. */
  attackTargets(u: Unit, from: Hex): ({ uid: number } | { sanctum: number })[] {
    if (this.power(u) <= 0) return [];
    const out: ({ uid: number } | { sanctum: number })[] = this.s.units
      .filter((e) => e.owner !== u.owner && e.hp > 0 && dist(from, e) <= u.range)
      .map((e) => ({ uid: e.uid }));
    if (inEnemyTerritory(u.owner, from)) out.push({ sanctum: 1 - u.owner });
    return out;
  }

  // ───────────── the main entry point ─────────────
  act(p: number, a: Action): ActResult {
    this.events = [];
    const s = this.s;
    if (s.phase === 'over') return { ok: false, error: 'The game is over.' };
    if (a.type === 'concede') {
      this.log(p, `${s.players[p].name} conceded.`);
      this.endGame(1 - p);
      return { ok: true, events: this.events };
    }
    if (s.phase === 'mulligan') {
      if (a.type !== 'mulligan') return { ok: false, error: 'Choose cards to replace first.' };
      const pl = s.players[p];
      if (pl.mulliganDone) return { ok: false, error: 'Already done.' };
      const out = pl.hand.filter((c) => a.iids.includes(c.iid));
      pl.hand = pl.hand.filter((c) => !a.iids.includes(c.iid));
      const n = out.length;
      this.draw(p, n, true);
      for (const c of out) pl.deck.push(c.cardId);
      shuffle(pl.deck, () => this.rand());
      pl.mulliganDone = true;
      if (s.players.every((x) => x.mulliganDone)) this.startRound();
      return { ok: true, events: this.events };
    }
    if (a.type === 'mulligan') return { ok: false, error: 'Not mulligan time.' };
    if (s.turn !== p) return { ok: false, error: "It's not your action." };

    if (a.type === 'pass') {
      s.passes++;
      this.emit({ t: 'pass', p });
      if (s.passes >= 2) this.endRound();
      else s.turn = 1 - p;
      return { ok: true, events: this.events };
    }

    if (a.type === 'play') {
      const pl = s.players[p];
      const ci = pl.hand.find((c) => c.iid === a.iid);
      if (!ci) return { ok: false, error: 'Card not in hand.' };
      if (!this.playable(p, ci)) return { ok: false, error: "You can't play that now." };
      const d = cardDef(ci.cardId);
      const specs = this.specs(d);
      const targets = a.targets ?? [];
      if (targets.length !== specs.length) return { ok: false, error: 'Wrong number of targets.' };
      for (let i = 0; i < specs.length; i++) {
        if (!this.validTarget(p, d, targets.slice(0, i), i, targets[i])) return { ok: false, error: 'Invalid target.' };
      }
      // pay
      let cost = this.cost(p, ci);
      if (d.type !== 'unit') {
        const fromSpell = Math.min(pl.spellMana, cost);
        pl.spellMana -= fromSpell; cost -= fromSpell;
      }
      pl.mana -= cost;
      pl.hand = pl.hand.filter((c) => c !== ci);
      s.lastPlayed = { player: p, cardId: d.id };
      this.emit({ t: 'play', p, cardId: d.id, targets });
      if (d.type === 'unit') {
        const h = targets[0] as Hex;
        const u = this.summon(d.id, p, h);
        this.log(p, `${pl.name} summoned {{${d.id}}}.`);
        if (u && d.onPlay) d.onPlay(this, { p, targets: targets.slice(1), self: u });
      } else {
        this.log(p, `${pl.name} played {{${d.id}}}.`);
        pl.spellsCast++;
        d.onPlay?.(this, { p, targets });
        for (const u of this.unitsOf(p)) cardDef(u.cardId).onSpellCast?.(this, u, d.id);
      }
      this.resolveDeaths();
      this.afterAction(p);
      return { ok: true, events: this.events };
    }

    if (a.type === 'order') {
      const u = this.unit(a.uid);
      if (!u || u.owner !== p) return { ok: false, error: 'Not your unit.' };
      if (!this.canAct(u)) return { ok: false, error: 'That unit cannot act right now.' };
      if (!a.to && !a.attack) return { ok: false, error: 'Nothing to do.' };
      let from: Hex = { c: u.c, r: u.r };
      let path: Hex[] | undefined;
      if (a.to && !same(a.to, from)) {
        path = this.reachable(u).get(key(a.to));
        if (!path) return { ok: false, error: "Can't move there." };
        from = a.to;
      }
      if (a.attack && !this.attackTargets(u, from).some((t) => JSON.stringify(t) === JSON.stringify(a.attack))) {
        return { ok: false, error: "Can't attack that from there." };
      }
      if (path) {
        u.c = from.c; u.r = from.r;
        this.emit({ t: 'move', uid: u.uid, path });
      }
      u.exhausted = true;
      const who = `${s.players[p].name}'s {{${u.cardId}}}`;
      if (!a.attack) this.log(p, `${who} moved.`);
      else if ('sanctum' in a.attack) this.log(p, `${who} attacked the enemy Sanctum.`);
      else this.log(p, `${who} attacked {{${this.unit(a.attack.uid)!.cardId}}}.`);
      if (a.attack) {
        if ('sanctum' in a.attack) this.attackSanctum(u, a.attack.sanctum);
        else { const tgt = this.unit(a.attack.uid)!; this.combat(u, tgt); }
      }
      this.resolveDeaths();
      this.afterAction(p);
      return { ok: true, events: this.events };
    }
    return { ok: false, error: 'Unknown action.' };
  }

  /** Champions whose condition is met transform into their levelled-up form. */
  checkLevelUps() {
    for (const u of this.s.units) {
      const d = cardDef(u.cardId);
      if (!d.champion || u.hp <= 0) continue;
      const [cur, need] = d.champion.progress(this, u);
      if (cur < need) continue;
      const to = cardDef(d.champion.to);
      const dAtk = u.atk - (d.atk ?? 0), dHp = u.maxHp - (d.hp ?? 0);
      u.cardId = to.id;
      u.atk = (to.atk ?? 0) + dAtk;
      u.maxHp = (to.hp ?? 1) + dHp;
      u.hp = u.maxHp;
      u.speed = to.speed ?? 2;
      u.range = to.range ?? 1;
      for (const k of to.kw ?? []) if (!u.kw.includes(k)) u.kw.push(k);
      this.emit({ t: 'levelUp', uid: u.uid, unit: structuredClone(u) });
      this.log(u.owner, `{{${d.id}}} leveled up into {{${to.id}}}!`);
    }
  }

  private afterAction(p: number) {
    this.checkLevelUps();
    if (this.s.phase !== 'action') return;
    this.s.passes = 0;
    this.s.turn = 1 - p;
  }

  // ───────────── rounds ─────────────
  startRound() {
    const s = this.s;
    s.phase = 'action';
    s.round++;
    if (s.round > 1) s.initiative = 1 - s.initiative;
    s.turn = s.initiative;
    s.passes = 0;
    this.emit({ t: 'round', round: s.round, initiative: s.initiative });
    for (const pl of s.players) {
      pl.maxMana = Math.min(MAX_MANA, pl.maxMana + 1);
      pl.mana = pl.maxMana;
    }
    for (const u of s.units) {
      if (u.frozen) { u.frozen = false; u.exhausted = true; } else u.exhausted = false;
    }
    this.draw(s.initiative, 1);
    this.draw(1 - s.initiative, 1);
    // Ley Orbs pulse for whoever holds them.
    for (const orb of LEY_ORBS) {
      const u = this.unitAt(orb);
      if (!u) continue;
      s.players[u.owner].mana += 1;
      this.emit({ t: 'orbPulse', p: u.owner, orb });
      this.damageSanctum(1 - u.owner, 1, null);
    }
    for (const u of [...s.units]) if (u.hp > 0) cardDef(u.cardId).onRoundStart?.(this, u);
    this.resolveDeaths();
    this.checkLevelUps();
    if (s.phase === 'action') this.log(-1, `Round ${s.round} begins. ${s.players[s.initiative].name} has the initiative.`);
  }

  endRound() {
    const s = this.s;
    for (const pl of s.players) {
      pl.spellMana = Math.min(MAX_SPELL_MANA, pl.spellMana + pl.mana);
      pl.mana = 0;
    }
    for (const u of [...s.units]) if (u.hp > 0) cardDef(u.cardId).onRoundEnd?.(this, u);
    for (const u of s.units) {
      u.tempAtk = 0;
      if (this.has(u, 'regenerate') && u.hp > 0 && u.hp < u.maxHp) {
        const amt = u.maxHp - u.hp; u.hp = u.maxHp;
        this.emit({ t: 'heal', uid: u.uid, amount: amt });
      }
    }
    this.resolveDeaths();
    if (s.phase === 'action') this.startRound();
  }

  // ───────────── combat ─────────────
  combat(a: Unit, d: Unit) {
    const range = dist(a, d);
    this.emit({ t: 'attack', uid: a.uid, target: { uid: d.uid }, ranged: range > 1 });
    const retaliates = d.range >= range;
    this.exchange(a, d, retaliates);
    cardDef(d.cardId).onAttacked?.(this, d, a);
  }

  /** Both units deal damage to each other (used by Predator's Pounce). */
  fight(a: Unit, d: Unit) {
    this.emit({ t: 'attack', uid: a.uid, target: { uid: d.uid }, ranged: false });
    this.exchange(a, d, true);
  }

  private exchange(a: Unit, d: Unit, retaliates: boolean) {
    const aFS = this.has(a, 'firstStrike'), dFS = this.has(d, 'firstStrike');
    if (aFS && !dFS) {
      this.dealDamage(d, this.power(a), a);
      if (retaliates && d.hp > 0) this.dealDamage(a, this.power(d), d);
    } else if (dFS && !aFS && retaliates) {
      this.dealDamage(a, this.power(d), d);
      if (a.hp > 0) this.dealDamage(d, this.power(a), a);
    } else {
      const pa = this.power(a), pd = this.power(d);
      this.dealDamage(d, pa, a);
      if (retaliates) this.dealDamage(a, pd, d);
    }
  }

  attackSanctum(u: Unit, p: number) {
    this.emit({ t: 'attack', uid: u.uid, target: { sanctum: p }, ranged: false });
    const amt = this.power(u) * (this.has(u, 'siege') ? 2 : 1);
    this.damageSanctum(p, amt, u);
  }

  // ───────────── effects API (used by cards) ─────────────
  dealDamage(u: Unit, amount: number, source: Unit | null, fx?: string): number {
    if (amount <= 0 || u.hp <= 0) return 0;
    if (fx) this.fx(fx, u);
    if (this.has(u, 'barrier')) {
      u.kw = u.kw.filter((k) => k !== 'barrier');
      this.emit({ t: 'barrier', uid: u.uid });
      return 0;
    }
    u.hp -= amount;
    this.emit({ t: 'damage', uid: u.uid, amount });
    if (source && this.has(source, 'deadly') && u.hp > 0) { u.hp = 0; this.fx('poison', u); }
    if (source && this.has(source, 'drain')) this.healSanctum(source.owner, amount);
    if (u.hp > 0) cardDef(u.cardId).onDamaged?.(this, u, amount);
    return amount;
  }

  damageSanctum(p: number, amount: number, source: Unit | null = null) {
    if (amount <= 0 || this.s.phase === 'over') return;
    this.s.players[p].sanctum -= amount;
    this.s.players[1 - p].sanctumDamageDealt += amount;
    this.emit({ t: 'sanctumDamage', p, amount });
    if (source && this.has(source, 'drain')) this.healSanctum(source.owner, amount);
    this.checkWin();
  }

  healSanctum(p: number, amount: number) {
    const pl = this.s.players[p];
    const amt = Math.min(amount, START_SANCTUM - pl.sanctum);
    if (amt <= 0) return;
    pl.sanctum += amt;
    this.emit({ t: 'sanctumHeal', p, amount: amt });
  }

  heal(u: Unit, amount: number) {
    const amt = Math.min(amount, u.maxHp - u.hp);
    if (amt <= 0) return;
    u.hp += amt;
    this.emit({ t: 'heal', uid: u.uid, amount: amt });
  }

  buff(u: Unit, atk: number, hp: number) {
    u.atk += atk; u.hp += hp; u.maxHp += hp;
    this.emit({ t: 'buff', uid: u.uid, atk, hp });
  }

  tempBuff(u: Unit, atk: number) {
    u.tempAtk += atk;
    this.emit({ t: 'buff', uid: u.uid, atk, hp: 0 });
  }

  giveKw(u: Unit, k: Keyword) {
    if (!u.kw.includes(k)) u.kw.push(k);
    this.emit({ t: 'buff', uid: u.uid, atk: 0, hp: 0 });
  }

  destroy(u: Unit) { if (u.hp > 0) u.hp = 0; }

  freeze(u: Unit) {
    if (u.exhausted) u.frozen = true; else u.exhausted = true;
    this.emit({ t: 'freeze', uid: u.uid });
  }

  root(u: Unit, rounds: number) {
    u.rootedUntil = Math.max(u.rootedUntil, this.s.round + rounds - 1);
    this.fx('roots', u);
  }

  ready(u: Unit) {
    u.exhausted = false; u.frozen = false;
    if (u.summonedRound === this.s.round) u.summonedRound = -1;
    this.emit({ t: 'ready', uid: u.uid });
  }

  bounce(u: Unit) {
    this.s.units = this.s.units.filter((x) => x !== u);
    this.emit({ t: 'bounce', uid: u.uid });
    const d = cardDef(u.cardId);
    if (d.levelOf) this.addToHand(u.owner, d.levelOf, 0);
    else if (!d.token) this.addToHand(u.owner, u.cardId, 0);
  }

  teleport(u: Unit, h: Hex) {
    if (!this.isEmpty(h)) return;
    u.c = h.c; u.r = h.r;
    this.emit({ t: 'teleport', uid: u.uid, to: h });
  }

  summon(cardId: string, owner: number, h: Hex): Unit | null {
    if (!this.isEmpty(h)) return null;
    const d = cardDef(cardId);
    const u: Unit = {
      uid: this.s.nextId++, cardId, owner, c: h.c, r: h.r,
      atk: d.atk ?? 0, hp: d.hp ?? 1, maxHp: d.hp ?? 1, speed: d.speed ?? 2, range: d.range ?? 1,
      kw: [...(d.kw ?? [])], exhausted: false, summonedRound: this.s.round, frozen: false, rootedUntil: 0, tempAtk: 0,
    };
    this.s.units.push(u);
    this.emit({ t: 'summon', uid: u.uid, unit: structuredClone(u) });
    for (const o of this.unitsOf(owner)) if (o !== u) cardDef(o.cardId).onFriendlySummon?.(this, o, u);
    return u;
  }

  summonInDeploy(cardId: string, p: number, n: number) {
    for (let i = 0; i < n; i++) {
      const hs = this.emptyDeployHexes(p);
      if (!hs.length) return;
      // Prefer the front row.
      const front = hs.filter((h) => h.r === deployRows(p)[p === 0 ? 1 : 0]);
      this.summon(cardId, p, this.pick(front.length ? front : hs));
    }
  }

  draw(p: number, n: number, silent = false) {
    const pl = this.s.players[p];
    for (let i = 0; i < n; i++) {
      const id = pl.deck.pop();
      if (!id) {
        pl.fatigue++;
        this.log(p, `${pl.name} has no cards left and takes ${pl.fatigue} fatigue damage.`);
        this.damageSanctum(p, pl.fatigue);
        continue;
      }
      if (pl.hand.length >= MAX_HAND) {
        if (!silent) this.emit({ t: 'draw', p, burned: id });
        continue;
      }
      pl.hand.push({ iid: this.s.nextId++, cardId: id, costMod: 0 });
      if (!silent) this.emit({ t: 'draw', p });
    }
  }

  addToHand(p: number, cardId: string, costMod: number) {
    const pl = this.s.players[p];
    if (pl.hand.length >= MAX_HAND) return;
    pl.hand.push({ iid: this.s.nextId++, cardId, costMod });
    this.emit({ t: 'draw', p });
  }

  gainMaxMana(p: number, n: number) {
    const pl = this.s.players[p];
    pl.maxMana = Math.min(MAX_MANA, pl.maxMana + n);
    this.emit({ t: 'mana', p });
  }

  fx(kind: string, at: Hex | null, extra: { p?: number } = {}) {
    this.emit({ t: 'fx', kind, at: at ? { c: at.c, r: at.r } : null, ...extra });
  }

  // ───────────── bookkeeping ─────────────
  resolveDeaths() {
    for (let guard = 0; guard < 50; guard++) {
      const dead = this.s.units.filter((u) => u.hp <= 0);
      if (!dead.length) break;
      this.s.units = this.s.units.filter((u) => u.hp > 0);
      for (const u of dead) {
        this.emit({ t: 'death', uid: u.uid });
        const d = cardDef(u.cardId);
        this.log(u.owner, `${this.s.players[u.owner].name}'s {{${u.cardId}}} died.`);
        if (!d.token && !d.levelOf) this.s.players[u.owner].graveyard.push(u.cardId);
        if (d.levelOf) this.s.players[u.owner].graveyard.push(d.levelOf);
        this.s.players[u.owner].alliesLost++;
        d.onDeath?.(this, u);
        for (const o of [...this.s.units]) if (o.hp > 0) cardDef(o.cardId).onUnitDeath?.(this, o, u);
      }
    }
    this.checkWin();
  }

  checkWin() {
    if (this.s.phase === 'over') return;
    const [a, b] = this.s.players.map((p) => p.sanctum <= 0);
    if (a && b) this.endGame(-1);
    else if (a) this.endGame(1);
    else if (b) this.endGame(0);
  }

  endGame(winner: number) {
    this.s.phase = 'over';
    this.s.winner = winner;
    this.emit({ t: 'gameOver', winner });
    this.log(-1, winner === -1 ? 'The game is a draw!' : `${this.s.players[winner].name} wins!`);
  }

  log(p: number, text: string) {
    this.s.log.push({ p, text, round: this.s.round });
    if (this.s.log.length > 150) this.s.log.shift();
  }

  emit(e: GameEvent) { this.events.push(e); }
}

/** A copy of the state that is safe to show to player `p` (hides hands and deck order). */
export function viewFor(s: GameState, p: number): GameState {
  const v = structuredClone(s);
  v.seed = 0;
  v.players.forEach((pl, i) => {
    pl.deck = pl.deck.map(() => '?');
    if (i !== p) pl.hand = pl.hand.map((c) => ({ iid: c.iid, cardId: '?', costMod: 0 }));
  });
  return v;
}

/** Strip hidden information out of events for player `p`. */
export function eventsFor(events: GameEvent[], p: number): GameEvent[] {
  return events.map((e) => (e.t === 'draw' && e.p !== p && e.burned ? { ...e, burned: e.burned } : e));
}

export { CARDS };
