import { cardDef } from './cards';
import { Game } from './engine';
import { LEY_ORBS, deployRows, dist, inEnemyTerritory, isOrb, type Hex } from './hex';
import type { Action, Target, Unit } from './types';

/**
 * A greedy one-ply AI: it tries every sensible action on a copy of the game,
 * scores the resulting position, and takes the best one (or passes).
 */

const KW_VALUE: Record<string, number> = {
  guardian: 0.6, flying: 1.2, firstStrike: 1, drain: 1.2, regenerate: 1.2, barrier: 1.4, siege: 0.8, deadly: 2.5, swift: 0, infiltrate: 0,
};
const ENGINE_VALUE: Record<string, number> = {
  k_siphon: 3, k_necromancer: 3, d_captain: 2, t_sea_witch: 2, e_flame_dancer: 1.5, g_sporecap: 2.5, d_bastion: 1.5,
  c_pyra: 1.5, c_nerith: 2, c_thornak: 1.5, c_sera: 2, c_morvath: 2, c_nerith2: 3, c_thornak2: 3, c_sera2: 3, c_morvath2: 2,
  t_glacial: 1, g_boar: 0.5, e_berserker: 0.8, k_grave_imp: 0.8, e_powder_goblin: 1, g_sproutling: 0.6, e_phoenix: 1.5,
};

function unitValue(g: Game, u: Unit): number {
  let v = g.power(u) * 1.0 + u.hp * 0.8 + u.atk * 0.2;
  for (const k of u.kw) v += KW_VALUE[k] ?? 0;
  v += ENGINE_VALUE[u.cardId] ?? 0;
  if (u.range > 1) v += 0.8;
  return v;
}

function positional(g: Game, u: Unit): number {
  let v = 0;
  const progress = u.owner === 0 ? u.r : 6 - u.r; // 0..6
  v += progress * 0.25;
  if (isOrb(u)) v += 3;
  else v += Math.max(0, 2 - Math.min(...LEY_ORBS.map((o) => dist(o, u)))) * 0.4;
  if (inEnemyTerritory(u.owner, u)) v += g.power(u) * (u.kw.includes('siege') ? 1.6 : 0.8);
  return v;
}

export function evaluate(g: Game, p: number): number {
  const s = g.s;
  if (s.phase === 'over') return s.winner === p ? 100000 : s.winner === -1 ? -500 : -100000;
  const me = s.players[p], op = s.players[1 - p];
  let score = 0;
  const sanctumVal = (hp: number) => hp * 3 + (hp <= 8 ? (8 - hp) * -2 : 0);
  score += sanctumVal(me.sanctum) - sanctumVal(op.sanctum);
  score += (Math.min(me.hand.length, 8) - Math.min(op.hand.length, 8)) * 1.6;
  score += (me.maxMana - op.maxMana) * 1.5;
  score += (me.spellMana - op.spellMana) * 0.3;

  const units = s.units.filter((u) => u.hp > 0);
  for (const u of units) {
    const sign = u.owner === p ? 1 : -1;
    const val = unitValue(g, u);
    score += sign * (val + positional(g, u));
    // Is it in danger from enemy units that can still act this round?
    const threats = units.filter((e) => e.owner !== u.owner && g.canAct(e) && dist(e, u) <= (g.isRooted(e) ? 0 : e.speed) + e.range);
    if (threats.length) {
      const dmg = threats.reduce((a, e) => a + g.power(e), 0);
      const lethal = u.kw.includes('barrier') ? false : dmg >= u.hp || threats.some((e) => e.kw.includes('deadly'));
      // The side whose turn it is next gets to strike first.
      const enemyMovesNext = s.turn !== u.owner;
      if (lethal) score -= sign * val * (enemyMovesNext ? 0.55 : 0.25);
    }
  }
  return score;
}

/** Pick a handful of promising deploy hexes so the search stays small. */
function deployCandidates(g: Game, p: number, cands: Target[]): Target[] {
  if (cands.length <= 5) return cands;
  const enemies = g.unitsOf(1 - p);
  const front = deployRows(p)[p === 0 ? 1 : 0];
  const scored = cands.map((t) => {
    const h = t as Hex;
    let sc = 0;
    if (h.r === front) sc += 2;
    if (isOrb(h)) sc += 6;
    sc -= Math.min(...LEY_ORBS.map((o) => dist(o, h))) * 0.5;
    if (enemies.length) sc -= Math.min(...enemies.map((e) => dist(e, h))) * 0.3;
    if (inEnemyTerritory(p, h)) sc += 1;
    return { t, sc: sc + Math.random() * 0.3 };
  });
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, 5).map((x) => x.t);
}

export function enumerateActions(g: Game, p: number): Action[] {
  const out: Action[] = [{ type: 'pass' }];
  const pl = g.s.players[p];
  const seenCards = new Set<string>();
  for (const ci of pl.hand) {
    if (seenCards.has(ci.cardId + ':' + ci.costMod)) continue;
    seenCards.add(ci.cardId + ':' + ci.costMod);
    if (!g.playable(p, ci)) continue;
    const d = cardDef(ci.cardId);
    const specs = g.specs(d);
    const rec = (prev: Target[]) => {
      const i = prev.length;
      if (i === specs.length) { out.push({ type: 'play', iid: ci.iid, targets: prev }); return; }
      let cands = g.candidates(p, d, prev, i);
      if (d.type === 'unit' && i === 0) cands = deployCandidates(g, p, cands);
      else if (cands.length > 10) cands = cands.slice(0, 10);
      if (specs[i].optional) cands = [...cands, null];
      for (const c of cands) rec([...prev, c]);
    };
    rec([]);
  }
  for (const u of g.unitsOf(p)) {
    if (!g.canAct(u)) continue;
    const here: Hex = { c: u.c, r: u.r };
    for (const t of g.attackTargets(u, here)) out.push({ type: 'order', uid: u.uid, attack: t });
    for (const [, path] of g.reachable(u)) {
      const to = path[path.length - 1];
      out.push({ type: 'order', uid: u.uid, to });
      for (const t of g.attackTargets(u, to)) out.push({ type: 'order', uid: u.uid, to, attack: t });
    }
  }
  return out;
}

function simClone(g: Game): Game {
  const { log, ...rest } = g.s;
  void log;
  return new Game(structuredClone({ ...rest, log: [] }));
}

export function chooseAction(g: Game, p: number): Action {
  const s = g.s;
  if (s.phase === 'mulligan') return { type: 'mulligan', iids: chooseMulligan(g, p) };
  const base = evaluate(g, p);
  let best: Action = { type: 'pass' };
  let bestScore = base + 0.4; // slight preference for passing over pointless shuffling
  for (const a of enumerateActions(g, p)) {
    if (a.type === 'pass') continue;
    const c = simClone(g);
    const r = c.act(p, a);
    if (!r.ok) continue;
    let sc = evaluate(c, p);
    if (a.type === 'play') {
      const d = cardDef(c.s.lastPlayed?.cardId ?? '');
      sc += d.aiBias ?? 0;
    }
    sc += Math.random() * 0.15; // break ties, keep it a little unpredictable
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  return best;
}

export function chooseMulligan(g: Game, p: number): number[] {
  const hand = g.s.players[p].hand;
  return hand.filter((c) => cardDef(c.cardId).cost >= 5).map((c) => c.iid);
}

