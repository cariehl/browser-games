// Tactical AI: scores (position, power, target) plans by expected value. Drives monsters, and heroes in autoplay/sims.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const Hex = G.Hex;
  const E = () => G.Engine;

  const COND_VALUE = { stunned: 16, asleep: 12, dazed: 7, immobilized: 4, slowed: 2.5, prone: 4, weakened: 7, blinded: 5, marked: 1.5, cagrant: 3, quarry: 0, vuln: 6, atkBonus: 0, defBonus: 0 };

  function hitChance(B, u, p, t, ctx) {
    if (!p.atk) return 1;
    const ab = E().attackBonus(B, u, p, t, ctx).total;
    const dv = t.object ? (t.def[p.atk.vs] || 5) : E().defense(B, t, p.atk.vs, ctx);
    return Math.max(0.05, Math.min(0.95, (21 - (dv - ab)) / 20));
  }
  function avgDmg(B, u, p, t, ctx) {
    if (!p.dmg) return 0;
    let a = E().avgDice(E().damageSpec(B, u, p, t));
    if (ctx.ca && u.traits.includes('sneakAttack') && (p.weapon || p.basic) && u.sneakTurn !== B.turnNo) a += u.traits.includes('shadowblade') ? 9 : 7;
    if (ctx.ca && u.traits.includes('caDamage')) a += E().avgDice(E().parseDice(G.Monsters[u.id].caDmg));
    if (u.traits.includes('quarry') && t.conds.some(c => c.c === 'quarry' && c.src === u.uid)) a += 3.5;
    if (u.traits.includes('evoker') && E().isArea(p)) a += 2;
    if (u.traits.includes('twinblade') && p.weapon && E().powerRange(u, p).kind === 'melee') a += 2;
    if (u.traits.includes('lightbringer') && p.implement) a += 2;
    if (u.phase3) a += 4;
    if (E().hasCond(u, 'weakened')) a /= 2;
    return a;
  }
  function effectValue(B, u, list, t) {
    let v = 0;
    for (const e of (list || [])) {
      if (e.t === 'cond') v += (COND_VALUE[e.c] || 2) * (e.dur === 'save' || e.dur === 'enc' ? 1.6 : 1) * (e.on === 'self' || e.on === 'allyNear' || e.on === 'alliesNear' ? 0.6 : 1);
      else if (e.t === 'ongoing') v += (typeof e.amt === 'number' ? e.amt : 5) * 1.5;
      else if (e.t === 'push' || e.t === 'pull' || e.t === 'slide') v += 1;
      else if (e.t === 'grantAttack') v += 8;
      else if (e.t === 'heal') v += e.on ? 6 : 0;
      else if (e.t === 'temp') v += 3;
      else if (e.t === 'fn') v += 3;
      else if (e.t === 'swap') v += 1;
    }
    return v;
  }
  function targetWeight(B, u, t) {
    if (t.object) return 0;
    let w = 1;
    if (E().isDying(t)) w *= u.side === 'enemy' ? 0.15 : 0.05;
    if (E().bloodied(t)) w *= 1.25;
    if (u.side === 'enemy' && t.side === 'hero') {
      if (t.role === 'Leader' || t.role === 'Controller') w *= 1.15;
      const mk = E().condsOf(u, 'marked')[0];
      if (mk && mk.src !== t.uid) w *= 0.8;
    }
    return w;
  }
  // value of attacking target t with power p from current u.pos
  function attackValue(B, u, p, t, extraCtx = {}) {
    const pr = E().powerRange(u, p);
    const ctx = Object.assign({ melee: pr.kind === 'melee', ranged: pr.kind === 'ranged' || pr.kind === 'areaBurst' }, extraCtx);
    if (t.object) return objectValue(B, u, t);
    ctx.ca = E().hasCA(B, u, t, ctx);
    const hc = hitChance(B, u, p, t, ctx);
    const hits = p.hits || 1;
    let dmg = avgDmg(B, u, p, t, ctx);
    let v;
    if (t.minion) v = hc * 9 * Math.min(hits, 1.5);
    else {
      const cap = Math.max(1, t.hp + t.tempHp);
      v = Math.min(dmg, cap) * hc * hits;
      if (p.miss === 'half') v += Math.min(dmg / 2, cap) * (1 - hc);
      if (dmg * hits >= cap) v += 6 * hc; // likely kill bonus
      v += effectValue(B, u, p.hit, t) * hc;
    }
    return v * targetWeight(B, u, t);
  }
  function objectValue(B, u, o) {
    let v = 0;
    for (const x of B.units) {
      if (x.dead || x === o || x.object || E().udist(x, o) > 1) continue;
      const val = x.minion ? 9 : (o.traits.includes('jamBurst') ? 5 : 9);
      v += (x.side !== u.side ? val : -val * 1.4);
    }
    return Math.max(0, v) * 0.9;
  }

  // enumerate aims for a power from a position: returns [{aim, value, targets}]
  function bestAim(B, u, p) {
    const pr = E().powerRange(u, p);
    let best = null;
    const consider = (aim, val) => { if (val > 0 && (!best || val > best.value)) best = { aim, value: val }; };
    if (p.tgt === 'self') return { aim: {}, value: selfValue(B, u, p) };
    if (E().isArea(p)) {
      let aims = [];
      if (p.tgt === 'closeBurst') aims = [null];
      else {
        const seen = new Set();
        for (const e of B.units) {
          if (e.dead || e.side === u.side) continue;
          for (const h of Hex.within(e.pos, (p.tgt === 'areaBurst' ? (p.size || 1) : 0) + (e.rad || 0))) {
            const k = Hex.hk(h); if (seen.has(k)) continue; seen.add(k);
            if (p.tgt === 'areaBurst' && Hex.dist(u.pos, h) > pr.range) continue;
            if (p.tgt === 'closeBlast' && E().hdist(u, h) > p.size) continue;
            if (E().occupies(u, h)) continue;
            aims.push(h);
          }
        }
      }
      for (const aim of aims) {
        const hexes = E().areaHexes(B, u, p, aim);
        if (!hexes.length) continue;
        const ts = E().areaTargets(B, u, p, hexes);
        let v = 0;
        if ((p.targets || 'enemy') === 'enemy' || p.targets === 'creature') {
          for (const t of ts) v += p.atk ? attackValue(B, u, p, t, { area: true }) : effectValue(B, u, p.hit, t);
          if (p.zone) v += 6 * ts.filter(t => !t.object).length;
        } else {
          v = allyEffectValue(B, u, p, ts);
        }
        if (p.after && p.id === 'c_sunfall') v += B.units.filter(a => a.side === u.side && !a.dead && Hex.dist(a.pos, aim) <= 2 && a.hp < a.maxHp - 5).length * 6;
        consider({ hex: aim || u.pos }, v);
      }
      if (best && p.tgt === 'closeBurst') best.aim = { hex: u.pos };
      return best;
    }
    const want = p.targets || 'enemy';
    for (const t of B.units) {
      if (t.dead) continue;
      if (!E().validTarget(B, u, p, t)) continue;
      let v;
      if (want === 'enemy') {
        if (t.object && u.side === 'enemy') continue;
        if (u.side === 'enemy' && E().isDying(t)) continue; // monsters leave the fallen alone
        if (p.atk) v = attackValue(B, u, p, t);
        else if (p.grant || p.id === 'w_rally') { const a = G.allyCanAttack(B, u, t); v = a ? 9 * targetWeight(B, u, t) : 0; }
        else if (p.hit && p.hit.some(e => e.c === 'quarry')) v = t.minion ? 0.5 : 4 + t.hp / 20;
        else v = effectValue(B, u, p.hit, t);
      } else v = allyEffectValue(B, u, p, [t]);
      consider({ unit: t }, v);
    }
    return best;
  }
  function allyEffectValue(B, u, p, ts) {
    let v = 0;
    for (const t of ts) {
      for (const e of (p.hit || [])) {
        if (e.t === 'heal') {
          const missing = t.maxHp - t.hp;
          if (E().isDying(t)) v += 40;
          else if (t.hp < t.maxHp * 0.5) v += Math.min(missing, t.surgeValue + 5) * 1.0;
          else v += Math.min(missing, 6) * 0.3;
          if (e.surge && t.surges <= 0) v -= 10;
        } else if (e.t === 'cond' && e.c === 'atkBonus') v += e.dur === 'enc' ? 5 : 2;
        else if (e.t === 'save') v += t.conds.some(c => c.dur === 'save' && c.c !== 'ongoing' || c.c === 'ongoing') ? 6 : 0;
        else if (e.t === 'temp') v += t.hp < t.maxHp * 0.7 ? 3 : 1;
        else if (e.t === 'shift') v += 0;
      }
    }
    return v;
  }
  function selfValue(B, u, p) {
    let v = 0;
    const adj = E().enemiesOf(B, u).filter(e => E().udist(e, u) <= 1).length;
    for (const e of (p.eff || [])) {
      if (e.t === 'temp') v += (u.hp < u.maxHp * 0.75) ? 6 : 2;
      if (e.t === 'cond' && e.c === 'defBonus') v += adj ? 4 : 0.5;
      if (e.t === 'cond' && e.c === 'atkBonus') v += 3;
      if (e.t === 'cond' && e.c === 'hidden') v += 3;
    }
    return v;
  }

  // positional desirability of ending at pos
  function posValue(B, u, pos, node) {
    let v = 0;
    const t = E().terr(B, pos);
    if (t && t.hazard) v -= t.hazard.dmg ? 12 : 6;
    if (B.telegraphs.some(tg => tg.owner !== u.uid && u.side === 'hero' && Hex.dist(tg.center, pos) <= tg.size)) v -= 35;
    if (node) v -= node.prov * (u.side === 'hero' ? 7 : 5);
    const foes = E().enemiesOf(B, u);
    const adj = foes.filter(e => E().udist(e, u, null, pos) <= (e.reach || 1) && E().canReact(e)).length;
    const ranged = isRangedUnit(u);
    if (ranged) v -= adj * 4;
    else if (u.side === 'hero' && u.role === 'Defender') v += Math.min(adj, 2) * 1.5;
    else if (u.side === 'hero') v -= adj * 1.2;
    // stay near friends (heroes) for heals/flanks
    if (u.side === 'hero') {
      const near = E().alliesOf(B, u).filter(a => Hex.dist(a.pos, pos) <= 3).length;
      v += Math.min(near, 2) * 0.5;
      v -= E().alliesOf(B, u).filter(a => Hex.dist(a.pos, pos) === 1).length * 0.6; // don't clump up for area attacks
    }
    return v;
  }
  function isRangedUnit(u) {
    if (u.ai === 'artillery' || u.ai === 'controller') return true;
    if (u.side === 'hero') return u.cls === 'wizard' || (u.weapon && u.weapon.ranged) || (u.cls === 'cleric' && u.sub === 'lightbringer');
    return false;
  }

  function* withPos(B, u, pos, fn) { }

  // evaluate the best standard-action plan from each reachable hex
  function planStandard(B, u, opts = {}) {
    const powers = u.powers.filter(p => (p.action || 'standard') === 'standard' && E().canUse(B, u, p) && !p.passive);
    const moveOk = !opts.noMove && E().canSpend(u, 'move') && E().speedOf(u) > 0 && !E().hasCond(u, 'prone');
    let nodes = moveOk ? [...E().reach(B, u, E().speedOf(u), 'move').values()].filter(n => !n.noEnd) : [{ h: u.pos, cost: 0, prov: 0, prev: null }];
    if (moveOk) { // shifting 1 never provokes: offer it as an alternative way to reposition
      const sh = [...E().reach(B, u, 1 + (u.shiftBonus || 0), 'shift').values()].filter(n => !n.noEnd && n.cost > 0).map(n => Object.assign({}, n, { shift: true, prov: 0 }));
      nodes = nodes.concat(sh);
    }
    const home = u.pos;
    let best = null;
    for (const n of nodes) {
      u.pos = n.h;
      const pv = posValue(B, u, n.h, n) - n.cost * 0.05;
      const threats = E().threatening(B, u, n.h).filter(e => !e.oaUsed).length;
      for (const p of powers) {
        const a = bestAim(B, u, p);
        if (!a) continue;
        let v = a.value;
        const pk = E().powerRange(u, p).kind;
        if (p.atk && !p.noProvoke && (pk === 'ranged' || pk === 'areaBurst')) v -= threats * 6;
        if (p.kind === 'daily') v -= u.side === 'hero' ? 9 : 0;
        else if (p.kind === 'encounter') v -= u.side === 'hero' ? 3 : 0;
        if (p.recharge) v += 1;
        const total = v + pv;
        if (!best || total > best.score) best = { node: n, power: p, aim: a.aim, score: total };
      }
    }
    u.pos = home;
    return best;
  }

  // movement toward targets when no attack is available
  function planApproach(B, u, budgetMult = 1) {
    const r = E().reach(B, u, E().speedOf(u) * budgetMult, 'move');
    const foes = E().enemiesOf(B, u).filter(e => !E().isDying(e));
    if (!foes.length) return null;
    const ranged = isRangedUnit(u);
    let best = null;
    for (const n of r.values()) {
      if (n.noEnd) continue;
      let dmin = 99;
      for (const f of foes) dmin = Math.min(dmin, E().udist(u, f, n.h) + (f.minion ? 1 : 0));
      let v = ranged ? -Math.abs(dmin - 6) : -dmin;
      v += posValue(B, u, n.h, n) * 0.5;
      if (!best || v > best.v) best = { n, v };
    }
    return best;
  }

  function* useMinors(B, u, phase) {
    for (const p of u.powers) {
      if ((p.action || 'standard') !== 'minor' || !E().canUse(B, u, p)) continue;
      if (!E().canSpend(u, 'minor')) return;
      // keep at least the standard for attacks: canSpend with minor uses minor first
      if (u.act.minor <= 0 && !(p.uses || p.hit && p.hit.some(e => e.t === 'heal'))) continue;
      let val = 0, aim = null;
      if (p.id === 'batch') { val = B.units.filter(x => !x.dead && x.id === 'gingerbread').length < 6 ? 10 : 0; aim = {}; }
      else if (p.uses && p.hit && p.hit[0].t === 'heal') {
        const cands = E().alliesOf(B, u, true).filter(a => !a.object && E().validTarget(B, u, p, a));
        const dying = cands.find(a => E().isDying(a));
        const hurt = cands.filter(a => a.hp < a.maxHp * 0.45 && a.surges > 0).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const t = dying || hurt;
        if (t) { val = 20; aim = { unit: t }; }
      } else if (p.id === 'rally') {
        const n = E().alliesOf(B, u).filter(a => Hex.dist(a.pos, u.pos) <= 5).length;
        if (n >= 2) { val = 5; aim = {}; }
      } else {
        if (phase === 'pre' && p.id === 'a_breath') continue;
        const a = bestAim(B, u, p);
        if (a) { val = a.value - (p.kind === 'encounter' && u.side === 'hero' ? 2 : 0); aim = a.aim; }
        if (p.id === 'c_bless' && B.round > 2) val = 0;
        if (p.id === 'f_taunt') val = aim ? (E().areaTargets(B, u, p, E().areaHexes(B, u, p, u.pos)).filter(t => !t.minion && !t.object).length >= 2 ? 6 : 0) : 0;
      }
      if (val >= 4 && aim) yield* E().usePower(B, u, p, aim);
      if (u.dead || B.over) return;
    }
  }

  function* takeTurn(B, u) {
    if (B.over || u.dead) return;
    if (E().hasCond(u, 'prone') && E().canSpend(u, 'move') && !u.act.single) yield* E().doMove(B, u, u.pos);
    yield* useMinors(B, u, 'pre');
    if (u.dead || B.over) return;
    // second wind when in trouble
    if (u.side === 'hero' && !u.used.__sw && u.hp < u.maxHp * 0.3 && u.surges > 0 && (u.secondWindAction === 'minor' || !planStandard(B, u) || u.hp < u.maxHp * 0.2)) {
      yield* E().secondWind(B, u);
    }
    for (let i = 0; i < 3; i++) {
      if (u.dead || B.over || !E().canAct(u)) return;
      if (!E().canSpend(u, 'standard')) break;
      const plan = planStandard(B, u);
      if (plan && plan.score > 0.5) {
        if (!Hex.eq(plan.node.h, u.pos)) yield* E().doMove(B, u, plan.node.h, plan.node.shift ? 'shift' : 'move');
        if (u.dead || B.over || E().isDying(u)) return;
        // re-aim after moving (things may have changed due to OAs)
        const p = plan.power;
        if (!E().canUse(B, u, p)) continue;
        const a = bestAim(B, u, p);
        if (a) yield* E().usePower(B, u, p, a.aim);
        else { /* nothing to hit after all */ }
      } else {
        // approach: move + standard-as-move
        let moved = false;
        for (let k = 0; k < 2; k++) {
          if (!E().canSpend(u, 'move') || E().speedOf(u) <= 0) break;
          const ap = planApproach(B, u);
          if (!ap || Hex.eq(ap.n.h, u.pos)) break;
          const before = u.pos;
          yield* E().doMove(B, u, ap.n.h);
          moved = true;
          if (u.dead || B.over) return;
          if (Hex.eq(before, u.pos)) break;
          if (planStandard(B, u, { noMove: true }) && E().canSpend(u, 'standard')) break;
        }
        if (!moved) break;
        continue;
      }
      // action point
      if (!u.dead && !B.over && E().canAct(u) && !E().canSpend(u, 'standard')) {
        const wantsAP = u.monster ? (u.actionPoints > 0 && (u.solo ? E().bloodied(u) : true)) : (!u.used.__ap && B.round >= 2 && E().enemiesOf(B, u).some(e => !e.minion));
        if (wantsAP) {
          const nxt = (() => { u.act.std++; const pl = planStandard(B, u, { noMove: true }); u.act.std--; return pl; })();
          if (nxt && nxt.score > 6) yield* E().actionPoint(B, u);
        }
      }
    }
    if (u.dead || B.over) return;
    yield* useMinors(B, u, 'post');
    // leftover move: artillery repositions, melee closes in
    if (E().canSpend(u, 'move') && E().speedOf(u) > 0 && !u.dead && !B.over && u.act.move > 0) {
      const r = E().reach(B, u, E().speedOf(u), 'move');
      let best = null, bv = posValue(B, u, u.pos, null) + 0.5;
      for (const n of r.values()) { if (n.noEnd || n.cost === 0) continue; const v = posValue(B, u, n.h, n); if (v > bv + 0.5) { bv = v; best = n; } }
      if (best && (isRangedUnit(u) || u.side === 'hero')) yield* E().doMove(B, u, best.h);
    }
  }

  function autoShift(B, u, hexes, away) {
    let best = null, bv = -1e9;
    for (const h of hexes) {
      const foes = E().enemiesOf(B, u);
      let v = 0;
      const adj = foes.filter(e => E().udist(u, e, h) === 1);
      if (away || isRangedUnit(u)) v -= adj.length * 4 - Math.min(...foes.map(f => E().udist(u, f, h)), 6) * 0.3;
      else {
        // prefer flanking spots next to enemies
        for (const f of adj) if (E().flanking(B, u, f, h)) v += 3;
        v += adj.length ? 1 : 0;
      }
      const t = E().terr(B, h); if (t && t.hazard) v -= 10;
      if (B.telegraphs.some(tg => u.side === 'hero' && Hex.dist(tg.center, h) <= tg.size)) v -= 30;
      if (v > bv) { bv = v; best = h; }
    }
    return best;
  }

  G.AI = { takeTurn, autoShift, planStandard, bestAim, attackValue, hitChance, avgDmg, isRangedUnit };
})();
if (typeof module !== 'undefined') module.exports = G;
