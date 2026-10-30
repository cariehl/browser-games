// Rules engine: pure game logic, no DOM. Actions are generators that may yield "choices"
// (pick a hex, accept a reroll); the UI or AI driver answers them. Visual events go to B.fx.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const Hex = G.Hex;
  const ABIL = ['STR', 'CON', 'DEX', 'INT', 'WIS', 'CHA'];
  const mod = (s) => Math.floor((s - 10) / 2);

  // ---------- RNG ----------
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  let rand = Math.random;
  const d = (n) => 1 + Math.floor(rand() * n);

  // dice strings: "2d6+3", "1W", "2W+1d6"
  function parseDice(str, u) {
    const out = { dice: [], flat: 0 };
    if (str == null) return out;
    String(str).replace(/\s/g, '').split(/(?=[+-])/).forEach(part => {
      if (!part) return;
      const sign = part[0] === '-' ? -1 : 1;
      const p = part.replace(/^[+-]/, '');
      let m;
      if ((m = p.match(/^(\d*)W$/))) {
        const n = m[1] ? +m[1] : 1;
        const w = (u && u.weapon) ? u.weapon.die : [1, 6];
        for (let i = 0; i < n; i++) out.dice.push([w[0], w[1]]);
      } else if ((m = p.match(/^(\d*)d(\d+)$/))) {
        out.dice.push([m[1] ? +m[1] : 1, +m[2]]);
      } else out.flat += sign * (+p || 0);
    });
    return out;
  }
  function rollDice(spec, max) {
    let t = spec.flat, rolls = [];
    for (const [n, s] of spec.dice) for (let i = 0; i < n; i++) { const r = max ? s : d(s); rolls.push(r); t += r; }
    return { total: t, rolls };
  }
  function avgDice(spec) { let t = spec.flat; for (const [n, s] of spec.dice) t += n * (s + 1) / 2; return t; }

  // ---------- Terrain ----------
  const TERRAIN = {
    floor: { name: 'Ground', cost: 1 },
    grass: { name: 'Grass', cost: 1 },
    road: { name: 'Road', cost: 1 },
    rough: { name: 'Undergrowth', cost: 2, difficult: true },
    tree: { name: 'Tree', block: true, los: true },
    rock: { name: 'Boulder', block: true, los: true },
    wall: { name: 'Wall', block: true, los: true },
    water: { name: 'Deep Water', block: true },
    bridge: { name: 'Bridge', cost: 1 },
    wagon: { name: 'Wagon', block: true, los: true },
    tent: { name: 'Tent', cost: 2, difficult: true },
    fire: { name: 'Campfire', cost: 1, hazard: { dmg: '1d6+2', dtype: 'fire' } },
    oven: { name: 'Roaring Oven', cost: 1, hazard: { dmg: '2d6+2', dtype: 'fire' } },
    frosting: { name: 'Frosting Pool', cost: 2, difficult: true, hazard: { cond: 'slowed' } },
    pillar: { name: 'Sugar Pillar', block: true, los: true },
    tile: { name: 'Checkered Tile', cost: 1 },
    counter: { name: 'Counter', block: true },
    flames: { name: 'Burning Ground', cost: 1, hazard: { dmg: '1d6+2', dtype: 'fire' } },
    jam: { name: 'Sticky Jam', cost: 2, difficult: true, hazard: { cond: 'immobilized' } },
  };

  // ---------- Battle setup ----------
  let uid = 0;
  function newBattle(scen, party, opts = {}) {
    if (opts.seed != null) rand = makeRng(opts.seed); else rand = Math.random;
    const B = {
      scen, round: 0, turnIdx: -1, order: [], units: [], tiles: new Map(), zones: [],
      log: [], fx: [], momentum: 0, over: null, stats: {}, telegraphs: [], flags: {}, quiet: !!opts.quiet,
    };
    // map
    scen.map.forEach((rowStr, row) => {
      [...rowStr].forEach((ch, col) => {
        const t = scen.legend[ch];
        if (!t) return;
        const h = Hex.fromOffset(col, row);
        B.tiles.set(Hex.hk(h), { q: h.q, r: h.r, col, row, terrain: t.terrain || t, height: t.height || 0 });
        if (t.spawn) (B.spawns = B.spawns || {})[t.spawn] = (B.spawns[t.spawn] || []).concat([h]);
      });
    });
    const heroStarts = (B.spawns && B.spawns.hero) || [];
    party.forEach((build, i) => {
      const u = G.Build.makeHero(build, scen.level);
      u.pos = heroStarts[i] || heroStarts[0];
      addUnit(B, u);
    });
    for (const sp of scen.enemies) {
      const pos = sp.at ? Hex.fromOffset(sp.at[0], sp.at[1]) : null;
      addUnit(B, makeMonster(sp.id, pos, sp));
    }
    for (const sp of (scen.objects || [])) addUnit(B, makeMonster(sp.id, Hex.fromOffset(sp.at[0], sp.at[1]), sp));
    return B;
  }

  function addUnit(B, u) {
    u.uid = ++uid; u.conds = u.conds || []; u.used = u.used || {}; u.uses = u.uses || {};
    u.tempHp = u.tempHp || 0; u.act = { std: 0, move: 0, minor: 0 };
    B.units.push(u);
    B.stats[u.uid] = { dmg: 0, kills: 0, crits: 0, healed: 0, hits: 0, misses: 0, taken: 0 };
    return u;
  }

  function makeMonster(id, pos, sp = {}) {
    const def = G.Monsters[id];
    if (!def) throw new Error('unknown monster ' + id);
    const u = {
      id, name: sp.name || def.name, side: def.side || 'enemy', role: def.role, level: def.level,
      monster: true, minion: !!def.minion, solo: !!def.solo, elite: !!def.elite, object: def.side === 'object',
      maxHp: def.hp, hp: def.hp, def: Object.assign({}, def.def), speed: def.speed || 6,
      initBonus: def.init || 0, saveBonus: def.saveBonus || 0,
      powers: def.powers.map(p => Object.assign({ src: id }, p)),
      traits: (def.traits || []).slice(), resist: def.resist || {}, vuln: def.vuln || {},
      look: def.look, size: def.size || 1, rad: def.large ? 1 : 0, ai: def.ai || def.role, pos,
      actionPoints: def.actionPoints || 0, immuneForced: !!def.immuneForced, reach: def.reach || 1,
      barks: def.barks, title: def.title, desc: def.desc,
    };
    u.recharge = {};
    return u;
  }

  // ---------- Queries ----------
  const tile = (B, h) => B.tiles.get(Hex.hk(h));
  const terr = (B, h) => { const t = tile(B, h); return t ? TERRAIN[t.terrain] : null; };
  const alive = (u) => !u.dead;
  // Large creatures (rad 1) fill their hex and the six around it; distances are measured edge to edge
  const rad = (u) => u.rad || 0;
  const occupies = (u, h, at) => Hex.dist(at || u.pos, h) <= rad(u);
  const footprint = (u, at) => rad(u) ? Hex.within(at || u.pos, rad(u)) : [at || u.pos];
  const udist = (a, b, aPos, bPos) => Math.max(0, Hex.dist(aPos || a.pos, bPos || b.pos) - rad(a) - rad(b));
  const hdist = (u, h, at) => Math.max(0, Hex.dist(at || u.pos, h) - rad(u));
  const unitAt = (B, h) => B.units.find(u => !u.dead && u.pos && occupies(u, h));
  const isHostile = (a, b) => a.side !== b.side && !(a.object && b.object);
  const enemiesOf = (B, u) => B.units.filter(o => !o.dead && !o.object && o.side !== u.side && o.side !== 'object');
  const alliesOf = (B, u, incSelf) => B.units.filter(o => !o.dead && o.side === u.side && (incSelf || o !== u));
  const hasCond = (u, c) => u.conds.some(x => x.c === c);
  const condsOf = (u, c) => u.conds.filter(x => x.c === c);
  const bloodied = (u) => u.hp <= Math.floor(u.maxHp / 2);
  const isDying = (u) => hasCond(u, 'dying');
  const helpless = (u) => isDying(u) || hasCond(u, 'stunned') || hasCond(u, 'asleep');
  const canAct = (u) => !u.dead && !helpless(u);
  const canReact = (u) => canAct(u) && !hasCond(u, 'dazed') && !u.object;

  function passable(B, h, u) {
    const t = terr(B, h);
    if (!t || t.block) return false;
    return true;
  }
  function blocksLos(B, h) { const t = terr(B, h); return !t || !!t.los; }
  // clear if either edge-nudged line is unobstructed, so peeking past a corner works the same on both sides
  function los(B, a, b) {
    const clear = (line) => { for (let i = 1; i < line.length - 1; i++) if (blocksLos(B, line[i])) return false; return true; };
    return clear(Hex.line(a, b, 1)) || clear(Hex.line(a, b, -1));
  }
  function threatRange(e) { return e.reach || 1; }
  function threatening(B, u, at) {
    const p = at || u.pos;
    return enemiesOf(B, u).filter(e => e.pos && canReact(e) && udist(e, u, null, p) <= threatRange(e));
  }

  // ---------- Conditions ----------
  // dur: 'eont' (end of src's next turn) | 'sont' | 'save' | 'enc' | 'eot' (end of affected's turn) | number of rounds
  function addCond(B, u, c, opts = {}) {
    if (u.dead) return;
    if (u.immune && u.immune.includes(c)) return;
    const dur = opts.dur || 'eont';
    if (c === 'marked') u.conds = u.conds.filter(x => x.c !== 'marked');
    if (c === 'quarry') for (const o of B.units) o.conds = o.conds.filter(x => !(x.c === 'quarry' && x.src === opts.src));
    if (c === 'ongoing') { // ongoing damage of the same type doesn't stack: keep the larger
      const og = u.conds.find(x => x.c === 'ongoing' && x.dtype === opts.dtype);
      if (og) { og.amt = Math.max(og.amt, opts.amt || 0); return; }
    }
    const existing = u.conds.find(x => x.c === c && x.src === opts.src && !opts.stack);
    if (existing && !['ongoing', 'atkBonus', 'defBonus', 'dmgBonus'].includes(c)) { existing.dur = dur; existing.fresh = !!(B.active && B.active.uid === opts.src); return; }
    u.conds.push({ c, dur, src: opts.src, amt: opts.amt, dtype: opts.dtype, then: opts.then, vs: opts.vs, label: opts.label, fresh: !!(B.active && B.active.uid === opts.src), savePen: opts.savePen || 0 });
    if (['slowed', 'immobilized', 'dazed', 'stunned', 'prone', 'weakened', 'blinded', 'asleep'].includes(c)) fx(B, { t: 'cond', u: u.uid, c });
  }
  function removeCond(u, pred) { u.conds = u.conds.filter(x => !pred(x)); }
  function condSum(u, c, ctx) {
    let t = 0;
    for (const x of u.conds) if (x.c === c && (!x.vs || (ctx && ctx.target && x.vs === ctx.target.uid))) t += x.amt || 0;
    return t;
  }

  // ---------- Logging / fx ----------
  function log(B, msg, cls) { B.log.push({ msg, cls, round: B.round }); if (!B.quiet && typeof process !== 'undefined' && process.env && process.env.VERBOSE) console.log(msg); }
  function fx(B, ev) { B.fx.push(ev); }

  // ---------- Stats ----------
  function speedOf(u) {
    if (hasCond(u, 'immobilized') || helpless(u)) return 0;
    let s = u.speed + condSum(u, 'speedBonus');
    if (hasCond(u, 'slowed')) s = Math.min(s, 2);
    return Math.max(0, s);
  }
  function defense(B, u, which, ctx = {}) {
    let v = u.def[which] + condSum(u, 'defBonus', null);
    v += traitSum(B, u, 'defMod', which, ctx);
    for (const a of B.units) if (a !== u && !a.dead && a.side === u.side && a.pos && u.pos && udist(a, u) === 1) v += traitSum(B, a, 'auraDefAlly', which);
    if (u.secondWindUntil) v += 2;
    if (which !== 'AC' || true) {
      // prone: +2 vs ranged, (combat advantage handled separately)
      if (hasCond(u, 'prone') && ctx.ranged) v += 2;
    }
    return v;
  }
  function hasCA(B, att, tgt, ctx = {}) {
    if (tgt.object) return false;
    if (hasCond(tgt, 'cagrant') || hasCond(tgt, 'blinded')) {
      const g = condsOf(tgt, 'cagrant');
      if (hasCond(tgt, 'blinded') || g.some(x => !x.vs || x.vs === att.uid || (x.vs === 'side' && x.side === att.side) || x.vs === 'any')) return true;
    }
    if (hasCond(tgt, 'dazed') || hasCond(tgt, 'stunned') || hasCond(tgt, 'asleep') || isDying(tgt) || hasCond(tgt, 'immobilized') && false) return true;
    if (hasCond(tgt, 'prone') && ctx.melee) return true;
    if (ctx.hidden || hasCond(att, 'hidden')) return true;
    if (att.firstStrike && !tgt.actedThisFight) return true;
    if (ctx.melee || ctx.adjacentCheck !== false) {
      if (flanking(B, att, tgt)) return true;
    }
    return false;
  }
  function flanking(B, att, tgt, attPos) {
    const ap = attPos || att.pos;
    if (!ap || udist(att, tgt, ap) !== 1) return false;
    const opp = { q: 2 * tgt.pos.q - ap.q, r: 2 * tgt.pos.r - ap.r };
    const ok = (a) => a && a !== att && a.side === att.side && canAct(a) && !a.object;
    if (!rad(tgt)) return !!ok(unitAt(B, opp));
    // around a Large creature: any ally adjacent to it on the far side
    return B.units.some(a => !a.dead && a.pos && ok(a) && udist(a, tgt) === 1 && Hex.dist(a.pos, opp) <= rad(tgt));
  }

  // ---------- Traits ----------
  function traitSum(B, u, hook, ...args) {
    let t = 0;
    for (const id of (u.traits || [])) { const T = G.Traits[id]; if (T && T[hook]) t += T[hook](B, u, ...args) || 0; }
    return t;
  }
  function* traitRun(B, u, hook, ...args) {
    for (const id of (u.traits || []).slice()) { const T = G.Traits[id]; if (T && T[hook]) { const r = T[hook](B, u, ...args); if (r && r.next) yield* r; } }
  }

  // ---------- Power helpers ----------
  function powerRange(u, p) {
    if (p.weapon && p.adapt && u.weapon && u.weapon.ranged) return { kind: 'ranged', range: u.weapon.range };
    if (p.tgt === 'melee') return { kind: 'melee', range: (p.range || 1) + ((u.weapon && u.weapon.reach && p.weapon) ? u.weapon.reach - 1 : 0) + (u.monster && p.range == null ? (u.reach - 1) : 0) };
    if (p.tgt === 'ranged' && p.weapon && u.weapon && u.weapon.ranged && !p.range) return { kind: 'ranged', range: u.weapon.range };
    return { kind: p.tgt, range: p.range || 0 };
  }
  function atkStat(u, p) {
    if (!p.atk) return null;
    let s = p.atk.stat;
    if (s === 'WPN') s = (u.weapon && u.weapon.ranged) ? 'DEX' : 'STR';
    return s;
  }
  function attackBonus(B, u, p, tgt, ctx = {}) {
    let b = 0, parts = [];
    if (u.monster) { b = p.atk.bonus || 0; parts.push(['base', b]); }
    else {
      const s = atkStat(u, p);
      const m = mod(u.abil[s]); const half = Math.floor(u.level / 2);
      b = m + half; parts.push([s, m]); if (half) parts.push(['½ lvl', half]);
      if ((p.weapon || p.basic) && !p.improvised) { const prof = (u.weapon && u.weapon.prof) || 0; if (prof) { b += prof; parts.push(['prof', prof]); } }
      if (u.enh && !p.improvised) { b += u.enh; parts.push(['enh', u.enh]); }
      if (p.atk.bonus) { b += p.atk.bonus; parts.push(['power', p.atk.bonus]); }
    }
    const tb = traitSum(B, u, 'atkMod', { power: p, target: tgt, ...ctx });
    if (tb) { b += tb; parts.push(['feats', tb]); }
    const cb = condSum(u, 'atkBonus', { target: tgt });
    if (cb) { b += cb; parts.push(['bonus', cb]); }
    if (ctx.ca) { const ca = 2 + traitSum(B, u, 'caMod', { power: p, target: tgt }); b += ca; parts.push(['adv', ca]); }
    if (ctx.charge) { b += 1; parts.push(['charge', 1]); }
    const mk = condsOf(u, 'marked').find(x => x.src !== tgt.uid);
    if (mk && !ctx.includesMarker) { b -= 2; parts.push(['marked', -2]); }
    if (hasCond(u, 'prone') && !ctx.melee) { b -= 2; parts.push(['prone', -2]); }
    if (hasCond(u, 'blinded')) { b -= 5; parts.push(['blind', -5]); }
    if (ctx.cover) { b -= 2; parts.push(['cover', -2]); }
    return { total: b, parts };
  }
  function damageSpec(B, u, p, tgt) {
    const dmgStr = (u.monster || !p.dmgMod && p.noMod) ? p.dmg : p.dmg;
    const spec = parseDice(dmgStr, u);
    if (!u.monster && p.dmg && !p.noMod) {
      const s = p.dmgMod || atkStat(u, p);
      if (s) spec.flat += mod(u.abil[s]);
    }
    if (!u.monster && u.enh && (p.weapon || p.implement || p.basic) && !p.improvised) spec.flat += u.enh;
    return spec;
  }

  // range/LOS check for a single-target power
  function validTarget(B, u, p, t, fromPos) {
    const pos = fromPos || u.pos;
    if (!t || t.dead || !t.pos) return false;
    const pr = powerRange(u, p);
    const want = p.targets || 'enemy';
    if (want === 'enemy' && !(t.side !== u.side)) return false;
    if (want === 'ally' && (t.side !== u.side || t === u || t.object)) return false;
    if (want === 'allyOrSelf' && (t.side !== u.side || t.object)) return false;
    if (want === 'self' && t !== u) return false;
    const dd = udist(u, t, pos);
    if (pr.kind === 'melee') return t !== u && dd <= pr.range;
    if (pr.kind === 'ranged' || pr.kind === 'touch') return dd <= pr.range && (t === u || footprint(t).some(h => los(B, pos, h)));
    if (pr.kind === 'self') return t === u;
    return false;
  }

  // compute affected hexes for area powers; aim = hex
  function areaHexes(B, u, p, aim, fromPos) {
    const pos = fromPos || u.pos;
    const pr = powerRange(u, p);
    // a Large creature's close attacks reach out from the edge of its space
    if (p.tgt === 'closeBurst') return Hex.within(pos, p.size + rad(u)).filter(h => tile(B, h) && (p.includeSelf ? Hex.dist(h, pos) === 0 || Hex.dist(h, pos) > rad(u) : Hex.dist(h, pos) > rad(u)));
    if (p.tgt === 'closeBlast') return Hex.blast(pos, aim, p.size + rad(u)).filter(h => tile(B, h) && Hex.dist(h, pos) > rad(u) && los(B, pos, h));
    if (p.tgt === 'areaBurst') {
      if (!aim || Hex.dist(pos, aim) > pr.range || !tile(B, aim) || !los(B, pos, aim)) return [];
      return Hex.within(aim, p.size).filter(h => tile(B, h) && (Hex.eq(h, aim) || los(B, aim, h)));
    }
    return [];
  }
  function isArea(p) { return ['closeBurst', 'closeBlast', 'areaBurst'].includes(p.tgt); }
  function areaTargets(B, u, p, hexes) {
    const want = p.targets || 'enemy';
    const out = [];
    for (const h of hexes) {
      const t = unitAt(B, h); if (!t || out.includes(t)) continue;
      if (want === 'enemy' && t.side === u.side) continue;
      if (want === 'ally' && (t.side !== u.side || t.object)) continue;
      if (want === 'allyOrSelf' && (t.side !== u.side || t.object)) continue;
      if (want === 'creature' && t.object && false) continue;
      if (t === u && !p.includeSelf) continue;
      if (u.monster && isDying(t)) continue; // monsters ignore the fallen with area attacks
      out.push(t);
    }
    return out;
  }

  // ---------- Action economy ----------
  function canSpend(u, a) {
    const A = u.act;
    if (A.single && A.spent) return false;
    if (a === 'free') return true;
    if (a === 'standard') return A.std > 0;
    if (a === 'move') return A.move > 0 || A.std > 0;
    if (a === 'minor') return A.minor > 0 || A.move > 0 || A.std > 0;
    return false;
  }
  function spend(u, a) {
    const A = u.act;
    if (a === 'free') return;
    if (A.single) { A.spent = true; A.std = A.move = A.minor = 0; return; }
    if (a === 'standard') A.std--;
    else if (a === 'move') { if (A.move > 0) A.move--; else A.std--; }
    else if (a === 'minor') { if (A.minor > 0) A.minor--; else if (A.move > 0) A.move--; else A.std--; }
  }
  function powerReady(B, u, p) {
    if (p.passive) return false;
    if (p.kind === 'encounter' || p.kind === 'daily') { if (u.used[p.id]) return false; }
    if (p.uses) { if ((u.uses[p.id] || 0) >= p.uses) return false; }
    if (p.recharge && u.recharge[p.id] === false) return false;
    if (p.when && !p.when(B, u)) return false;
    return true;
  }
  function canUse(B, u, p) {
    if (!canAct(u)) return false;
    if (!powerReady(B, u, p)) return false;
    return canSpend(u, p.action || 'standard');
  }

  // ---------- Movement ----------
  // can u's space be at h while moving? (blocked terrain or a hostile body in the way)
  function canPass(B, u, h) {
    for (const f of footprint(u, h)) {
      if (!passable(B, f, u)) return false;
      const occ = unitAt(B, f);
      if (occ && occ !== u && (occ.side !== u.side || occ.object)) return false;
    }
    return true;
  }
  function stepCost(B, u, h, mode) {
    if (mode === 'teleport' || u.ignoreDifficult) return 1;
    return footprint(u, h).some(f => { const t = terr(B, f); return t && t.difficult; }) ? 2 : 1;
  }
  // returns Map key -> {cost, prev, prov} for hexes reachable this move.
  // Leaving an enemy's reach provokes it (once); moving around inside its reach doesn't.
  function reach(B, u, budget, mode = 'move', opts = {}) {
    const start = opts.from || u.pos; const res = new Map();
    const sk = Hex.hk(start);
    res.set(sk, { h: start, cost: 0, prov: 0, prev: null, provBy: opts.provBy || [] });
    const open = [res.get(sk)];
    while (open.length) {
      open.sort((a, b) => a.prov - b.prov || a.cost - b.cost);
      const cur = open.shift();
      const threats = mode === 'move' ? threatening(B, u, cur.h).filter(e => !e.oaUsed) : [];
      for (const n of Hex.neighbors(cur.h)) {
        if (!canPass(B, u, n)) continue;
        const nc = cur.cost + stepCost(B, u, n, mode);
        if (nc > budget) continue;
        const newBy = threats.filter(e => !cur.provBy.includes(e.uid) && udist(e, u, null, n) > threatRange(e)).map(e => e.uid);
        const np = cur.prov + newBy.length;
        const k = Hex.hk(n);
        const ex = res.get(k);
        if (!ex || np < ex.prov || (np === ex.prov && nc < ex.cost)) {
          const node = { h: n, cost: nc, prov: np, prev: cur, provBy: cur.provBy.concat(newBy) };
          res.set(k, node); open.push(node);
        }
      }
    }
    // can't end sharing a hex with another creature
    for (const v of res.values()) if (footprint(u, v.h).some(f => { const o = unitAt(B, f); return o && o !== u; })) v.noEnd = true;
    return res;
  }
  function pathFrom(node) { const p = []; while (node) { p.unshift(node.h); node = node.prev; } return p; }

  // teleport/jump: any free hex within n regardless of path
  function freeHexesWithin(B, u, n, from) {
    return Hex.within(from || u.pos, n).filter(h => tile(B, h) && footprint(u, h).every(f => passable(B, f) && (!unitAt(B, f) || unitAt(B, f) === u)) && !Hex.eq(h, u.pos));
  }

  function* moveAlong(B, u, path, kind = 'move') {
    // path includes start hex
    if (path.length < 2) return;
    const reactedOA = new Set();
    for (let i = 1; i < path.length; i++) {
      if (u.dead || isDying(u)) return;
      const from = path[i - 1], to = path[i];
      if (kind === 'move') {
        // stepping out of an enemy's reach provokes it; repositioning within its reach doesn't
        for (const e of threatening(B, u, from)) {
          if (reactedOA.has(e.uid) || e.oaUsed || udist(e, u, null, to) <= threatRange(e)) continue;
          reactedOA.add(e.uid);
          const stop = yield* opportunityAttack(B, e, u);
          if (u.dead || isDying(u)) return;
          if (stop) { log(B, `${u.name} is stopped in their tracks!`, 'cond'); return; }
        }
      }
      if (i === path.length - 1 && footprint(u, to).some(f => unitAt(B, f) && unitAt(B, f) !== u)) return; // can't end on an occupant
      u.pos = to;
      if (u.turnFlags) u.turnFlags.moved = (u.turnFlags.moved || 0) + 1;
      fx(B, { t: 'step', u: u.uid, to, kind });
      yield* enterHex(B, u, to, kind);
      if (hasCond(u, 'immobilized') && kind === 'move') return;
    }
    if (kind === 'shift') yield* notifyEnemyAction(B, u, { shift: true });
  }
  function* enterHex(B, u, h, kind) {
    const t = terr(B, h);
    if (t && t.hazard) {
      if (t.hazard.dmg) {
        const r = rollDice(parseDice(t.hazard.dmg));
        log(B, `${u.name} ${kind === 'forced' ? 'is shoved into' : 'blunders through'} the ${t.name}!`, 'hazard');
        if (kind === 'forced') fx(B, { t: 'banner', text: t.hazard.dtype === 'fire' ? 'Into the fire!' : 'Shoved in!', u: u.uid, cls: 'crit' });
        yield* dealDamage(B, null, u, r.total, { dtype: t.hazard.dtype, label: t.name });
      }
      if (t.hazard.cond && !u.dead && !hasCond(u, t.hazard.cond)) { addCond(B, u, t.hazard.cond, { dur: 'save', label: t.name }); log(B, `${u.name} is stuck in the ${t.name} (${t.hazard.cond}).`, 'cond'); }
    }
    for (const z of B.zones) if (z.onEnter && z.hexes.some(x => Hex.eq(x, h))) yield* z.onEnter(B, u, z);
  }

  function* opportunityAttack(B, e, u) {
    const basic = e.powers.find(p => p.basicMelee) || e.powers.find(p => p.tgt === 'melee' && p.atk);
    if (!basic) return false;
    e.oaUsed = true;
    log(B, `${e.name} takes an opportunity attack on ${u.name}!`, 'oa');
    fx(B, { t: 'banner', text: 'Opportunity Attack!', u: e.uid, cls: 'oa' });
    const res = yield* attackRoll(B, e, basic, u, { oa: true, melee: true });
    if (res && res.hit && traitSum(B, e, 'oaStops', u)) return true;
    return false;
  }

  // forced movement: push/pull/slide. Yields a hex choice for the controller of src.
  function forcedOptions(B, src, tgt, kind, n) {
    if (tgt.immuneForced || tgt.object || tgt.dead) return [];
    n = Math.max(0, n - traitSum(B, tgt, 'forcedResist'));
    const origin = src.pos;
    let frontier = [{ h: tgt.pos, path: [tgt.pos] }];
    const out = []; const seen = new Set([Hex.hk(tgt.pos)]);
    for (let s = 0; s < n; s++) {
      const next = [];
      for (const f of frontier) {
        for (const nb of Hex.neighbors(f.h)) {
          const k = Hex.hk(nb); if (seen.has(k)) continue;
          if (!passable(B, nb) || unitAt(B, nb)) continue;
          const dn = Hex.dist(origin, nb), dc = Hex.dist(origin, f.h);
          if (kind === 'push' && dn <= dc) continue;
          if (kind === 'pull' && dn >= dc) continue;
          seen.add(k);
          const node = { h: nb, path: f.path.concat([nb]) };
          next.push(node); out.push(node);
        }
      }
      frontier = next;
    }
    return out;
  }
  function* forcedMove(B, src, tgt, kind, n) {
    const opts = forcedOptions(B, src, tgt, kind, n);
    if (!opts.length) return;
    const ch = yield {
      choice: 'hex', unit: src, about: tgt, label: `${kind[0].toUpperCase() + kind.slice(1)} ${tgt.name} up to ${n}`,
      hexes: opts.map(o => o.h), optional: true,
      auto: () => autoForced(B, src, tgt, opts),
    };
    if (!ch) return;
    const node = opts.find(o => Hex.eq(o.h, ch));
    if (!node) return;
    log(B, `${src.name} ${kind === 'push' ? 'pushes' : kind === 'pull' ? 'pulls' : 'slides'} ${tgt.name} ${node.path.length - 1}.`, 'move');
    fx(B, { t: 'forced', u: tgt.uid });
    for (let i = 1; i < node.path.length; i++) {
      if (tgt.dead) break;
      tgt.pos = node.path[i];
      fx(B, { t: 'step', u: tgt.uid, to: tgt.pos, kind: 'forced' });
      yield* enterHex(B, tgt, tgt.pos, 'forced');
    }
  }
  function autoForced(B, src, tgt, opts) {
    // prefer hazards, then isolate from allies / bring into flank, then max distance
    let best = null, bs = -1e9;
    for (const o of opts) {
      let s = 0;
      for (const h of o.path.slice(1)) { const t = terr(B, h); if (t.hazard) s += t.hazard.dmg ? 10 : 4; }
      const hostiles = B.units.filter(x => !x.dead && x.side === src.side && x !== src && Hex.dist(x.pos, o.h) === 1).length;
      s += hostiles * 2 + o.path.length * 0.5;
      if (s > bs) { bs = s; best = o.h; }
    }
    return best;
  }

  // ---------- Damage & healing ----------
  function* dealDamage(B, src, tgt, amount, o = {}) {
    if (tgt.dead || amount <= 0 && !o.force) return 0;
    let a = amount;
    if (o.dtype && tgt.resist[o.dtype]) a -= tgt.resist[o.dtype];
    if (tgt.resist.all) a -= tgt.resist.all;
    if (o.dtype && tgt.vuln[o.dtype]) a += tgt.vuln[o.dtype];
    a += condSum(tgt, 'vuln');
    if (src && hasCond(src, 'weakened') && !o.noWeaken) a = Math.floor(a / 2);
    a = Math.max(0, a);
    if (tgt.minion) {
      if (o.miss) { log(B, `${tgt.name} shrugs off the glancing blow.`, 'miss'); return 0; }
      a = Math.max(a, 1);
    }
    let absorbed = Math.min(tgt.tempHp, a); tgt.tempHp -= absorbed; const real = a - absorbed;
    const wasBloodied = bloodied(tgt);
    const before = tgt.hp;
    tgt.hp -= real;
    if (src && B.stats[src.uid]) B.stats[src.uid].dmg += Math.min(a, Math.max(0, before) + absorbed);
    if (B.stats[tgt.uid]) B.stats[tgt.uid].taken += a;
    fx(B, { t: 'damage', u: tgt.uid, amt: a, crit: !!o.crit, dtype: o.dtype, absorbed, hp: tgt.hp, temp: tgt.tempHp });
    log(B, `${tgt.name} takes ${a}${o.dtype ? ' ' + o.dtype : ''} damage${o.label ? ' (' + o.label + ')' : ''}${absorbed ? ` (${absorbed} absorbed)` : ''}. [${Math.max(tgt.hp, tgt.side === 'hero' ? tgt.hp : 0)}/${tgt.maxHp}]`, 'dmg');
    if (a > 0) removeCond(tgt, x => x.c === 'asleep');
    if (!wasBloodied && bloodied(tgt) && tgt.hp > 0) {
      fx(B, { t: 'banner', text: 'Bloodied!', u: tgt.uid, cls: 'blood' });
      yield* traitRun(B, tgt, 'onBloodied', src);
    }
    if (tgt.hp <= 0 && !tgt.minion && tgt.side !== 'hero' && -tgt.hp >= 10) fx(B, { t: 'banner', text: 'OVERKILL!', u: tgt.uid, cls: 'crit' });
    if (tgt.hp <= 0) yield* drop(B, src, tgt, o);
    else if (src) yield* traitRun(B, tgt, 'onDamaged', src, a);
    return a;
  }
  function* drop(B, src, tgt, o = {}) {
    if (tgt.side === 'hero') {
      const prevent = traitSum(B, tgt, 'preventDrop');
      if (prevent) { tgt.hp = 1; return; }
      if (isDying(tgt)) {
        // a blow against the dying counts as a failed death save; a critical hit counts twice
        const n = o.crit ? 2 : 1;
        tgt.deathFails = (tgt.deathFails || 0) + n;
        log(B, `${tgt.name} is struck while dying: ${n > 1 ? 'two failed death saves' : 'a failed death save'}! [${Math.min(3, tgt.deathFails)}/3]`, 'death');
        fx(B, { t: 'save', u: tgt.uid, ok: false, c: 'death', fails: tgt.deathFails });
        if (tgt.deathFails >= 3) yield* kill(B, src, tgt);
      } else {
        addCond(B, tgt, 'dying', { dur: 'enc' }); addCond(B, tgt, 'prone', { dur: 'enc' });
        tgt.deathFails = tgt.deathFails || 0;
        log(B, `${tgt.name} falls, dying!`, 'death');
        gainMomentum(B, 1, tgt);
        log(B, 'The party\'s resolve hardens (+1 Momentum).', 'oa');
        fx(B, { t: 'dying', u: tgt.uid });
        removeCond(tgt, x => x.c === 'marked' && false);
        checkEnd(B);
      }
      return;
    }
    yield* kill(B, src, tgt);
  }
  function* kill(B, src, tgt) {
    if (tgt.dead) return;
    tgt.dead = true; tgt.hp = Math.min(tgt.hp, 0);
    log(B, tgt.side === 'hero' ? `${tgt.name} has died.` : `${tgt.name} is defeated!`, 'death');
    fx(B, { t: 'death', u: tgt.uid });
    if (src && B.stats[src.uid]) B.stats[src.uid].kills++;
    // conditions sourced from the dead unit end
    for (const o of B.units) removeCond(o, x => x.src === tgt.uid && ['marked', 'quarry'].includes(x.c));
    if (src && src.side === 'hero' && tgt.side === 'enemy') gainMomentum(B, tgt.minion ? 0.5 : 1, src);
    yield* traitRun(B, tgt, 'onDeath', src);
    if (src && !src.dead) yield* traitRun(B, src, 'onKill', tgt);
    checkEnd(B);
  }
  function gainMomentum(B, n, by) {
    const before = Math.floor(B.momentum);
    B.momentum = Math.min(6, B.momentum + n);
    if (Math.floor(B.momentum) > before) fx(B, { t: 'momentum', v: B.momentum });
  }
  function heal(B, src, tgt, amount, o = {}) {
    if (tgt.dead || amount <= 0) return 0;
    if (tgt.hp < 0) tgt.hp = 0;
    const was = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
    const got = tgt.hp - was;
    if (got <= 0 && !isDying(tgt)) return 0;
    if (isDying(tgt) && tgt.hp > 0) {
      removeCond(tgt, x => x.c === 'dying'); tgt.deathFails = 0;
      log(B, `${tgt.name} is back on their feet!`, 'heal'); fx(B, { t: 'revive', u: tgt.uid });
    }
    if (src && B.stats[src.uid]) B.stats[src.uid].healed += got;
    fx(B, { t: 'heal', u: tgt.uid, amt: got, hp: tgt.hp });
    log(B, `${tgt.name} regains ${got} HP. [${tgt.hp}/${tgt.maxHp}]`, 'heal');
    return got;
  }
  function spendSurge(B, src, tgt, bonus = 0) {
    if (tgt.surges > 0) { tgt.surges--; return heal(B, src, tgt, tgt.surgeValue + bonus); }
    if (bonus > 0) return heal(B, src, tgt, bonus);
    log(B, `${tgt.name} has no healing surges left!`, 'miss'); return 0;
  }
  function giveTemp(B, tgt, amt) {
    if (tgt.dead || amt <= 0) return;
    if (amt > tgt.tempHp) { tgt.tempHp = amt; fx(B, { t: 'temp', u: tgt.uid, amt }); log(B, `${tgt.name} gains ${amt} temporary HP.`, 'heal'); }
  }

  // ---------- Attacks ----------
  function* attackRoll(B, u, p, t, ctx = {}) {
    const pr = powerRange(u, p);
    ctx.melee = ctx.melee || pr.kind === 'melee';
    ctx.ranged = pr.kind === 'ranged' || pr.kind === 'areaBurst';
    ctx.ca = ctx.ca != null ? ctx.ca : hasCA(B, u, t, ctx);
    const mk = condsOf(u, 'marked')[0];
    ctx.includesMarker = !mk || (ctx.allTargets || [t]).some(x => x.uid === mk.src);
    yield* traitRun(B, u, 'onAttack', t, p, ctx);
    let ab = attackBonus(B, u, p, t, ctx);
    const vs = p.atk.vs;
    const dv = t.object ? (t.def[vs] || 8) : defense(B, t, vs, ctx);
    let roll = d(20);
    let hit, crit;
    const evalRoll = () => {
      const critRange = 20 - traitSum(B, u, 'critRange', p);
      crit = roll >= critRange;
      hit = roll !== 1 && (crit || roll + ab.total >= dv);
    };
    evalRoll();
    fx(B, { t: 'roll', u: u.uid, tgt: t.uid, roll, bonus: ab.total, parts: ab.parts, def: dv, vs, hit, crit, power: p.name });
    // rerolls: heroes may spend momentum or an encounter reroll after a miss
    if (!hit && u.side === 'hero' && !ctx.noReroll && !ctx.oa && B.active === u) {
      const canElf = traitSum(B, u, 'hasReroll') > 0;
      const canMom = B.momentum >= 2;
      if (canElf || canMom) {
        const ans = yield {
          choice: 'reroll', unit: u, label: `Missed ${t.name} (${roll}+${ab.total} vs ${vs} ${dv}). Reroll?`,
          options: [canElf && 'elf', canMom && 'momentum'].filter(Boolean),
          auto: () => (dv - ab.total <= 14 && (canElf ? 'elf' : (B.momentum >= 3 || p.kind !== 'atwill') ? 'momentum' : null)) || null,
        };
        if (ans) {
          if (ans === 'elf') u.used.__elfReroll = true; else B.momentum -= 2;
          roll = d(20); evalRoll();
          log(B, `${u.name} rerolls! (${ans === 'elf' ? 'Keen Eye' : 'Momentum'})`, 'oa');
          fx(B, { t: 'roll', u: u.uid, tgt: t.uid, roll, bonus: ab.total, parts: ab.parts, def: dv, vs, hit, crit, power: p.name, reroll: true });
        }
      }
    }
    // halfling-style forced reroll on being hit
    if (hit && !crit && t.side === 'hero' && traitSum(B, t, 'canForceReroll') > 0) {
      t.used.__luck = true; roll = d(20); evalRoll();
      log(B, `${t.name}'s Lucky Break forces a reroll: ${roll}!`, 'oa');
      fx(B, { t: 'roll', u: u.uid, tgt: t.uid, roll, bonus: ab.total, parts: ab.parts, def: dv, vs, hit, crit, power: p.name, reroll: true });
    }
    const st = B.stats[u.uid];
    log(B, `${u.name} → ${t.name}: ${p.name} — d20 ${roll} + ${ab.total} = ${roll + ab.total} vs ${vs} ${dv}: ${crit ? 'CRITICAL HIT!' : hit ? 'hit' : 'miss'}${ctx.ca ? ' (advantage)' : ''}`, hit ? 'hit' : 'miss');
    t.actedThisFight = t.actedThisFight; // noop
    const res = { hit, crit, roll, total: roll + ab.total, def: dv, dmg: 0 };
    if (hit) {
      st && st.hits++;
      if (crit) { st && st.crits++; if (u.side === 'hero') gainMomentum(B, 1, u); fx(B, { t: 'banner', text: 'CRITICAL!', u: t.uid, cls: 'crit' }); }
      if (p.dmg) {
        const spec = damageSpec(B, u, p, t);
        let total = rollDice(spec, crit).total;
        if (crit && u.critDice) total += rollDice(parseDice(u.critDice)).total;
        const ectx = Object.assign({}, ctx, { power: p, target: t, crit });
        total += traitSum(B, u, 'dmgMod', ectx);
        total += condSum(u, 'dmgBonus', { target: t });
        res.dmg = yield* dealDamage(B, u, t, total, { dtype: p.dtype, crit });
      }
      if (!t.dead || t.side === 'hero') {
        for (const e of (p.hit || [])) yield* applyEffect(B, u, t, e, p, ctx);
      }
      if (p.onHit) { const r = p.onHit(B, u, t, ctx, res); if (r && r.next) yield* r; }
      yield* traitRun(B, u, 'onHit', t, p, ctx, res);
      if (!u.dead) yield* traitRun(B, t, 'onHitBy', u, p, ctx, res);
    } else {
      st && st.misses++;
      if (p.miss === 'half' && p.dmg) {
        const spec = damageSpec(B, u, p, t);
        const total = Math.floor(rollDice(spec).total / 2);
        res.dmg = yield* dealDamage(B, u, t, total, { dtype: p.dtype, miss: true, label: 'half on miss' });
      } else if (Array.isArray(p.miss)) for (const e of p.miss) yield* applyEffect(B, u, t, e, p, ctx);
      if (p.onMiss) { const r = p.onMiss(B, u, t, ctx); if (r && r.next) yield* r; }
      yield* traitRun(B, t, 'onMissedBy', u, p, ctx);
    }
    return res;
  }

  // effect application. e.on: 'target' (default) | 'self' | 'allyNear' | 'alliesNear'
  function* applyEffect(B, u, t, e, p, ctx = {}) {
    let subjects = [t];
    if (e.on === 'self') subjects = [u];
    else if (e.on === 'allyNear') {
      const cands = alliesOf(B, u).filter(a => !a.object && Hex.dist(a.pos, u.pos) <= (e.within || 5));
      cands.sort((a, b) => (e.prefer === 'hurt' ? (a.hp / a.maxHp) - (b.hp / b.maxHp) : Hex.dist(a.pos, t.pos) - Hex.dist(b.pos, t.pos)));
      subjects = cands.slice(0, 1);
    } else if (e.on === 'alliesNear') {
      subjects = alliesOf(B, u, e.incSelf).filter(a => !a.object && Hex.dist(a.pos, u.pos) <= (e.within || 5));
    } else if (e.on === 'allyAdjTarget') {
      subjects = alliesOf(B, u).filter(a => !a.object && canAct(a) && udist(a, t) === 1).slice(0, 1);
    }
    for (const s of subjects) {
      if (!s || s.dead) continue;
      const stat = (k) => (u.abil ? mod(u.abil[k]) : 0);
      const num = (v) => typeof v === 'number' ? v : typeof v === 'string' ? (ABIL.includes(v) ? stat(v) : rollDice(parseDice(v.replace(/(STR|CON|DEX|INT|WIS|CHA)/g, (m) => stat(m)), u)).total) : (v && v.call ? v(B, u, s) : 0);
      switch (e.t) {
        case 'push': case 'pull': case 'slide': {
          const n = e.n + (u.forcedBonus || 0);
          if (Hex.dist(s.pos, u.pos) > 0 || e.t === 'slide') yield* forcedMove(B, u, s, e.t, n);
          break;
        }
        case 'cond': {
          if (s.object) break;
          addCond(B, s, e.c, { dur: e.dur || 'eont', src: u.uid, amt: e.amt != null ? num(e.amt) : undefined, then: e.then, vs: e.vs === 'self' ? u.uid : e.vs, savePen: traitSum(B, u, 'savePen') });
          const lbl = e.c === 'prone' ? 'until they stand' : { eont: 'until end of next turn', save: 'save ends', sont: 'until start of next turn', enc: 'until end of encounter', eot: 'until end of turn' }[e.dur || 'eont'];
          log(B, `${s.name} is ${e.label || e.c}${e.amt ? ' (' + num(e.amt) + ')' : ''} (${lbl}).`, 'cond');
          break;
        }
        case 'ongoing': {
          if (s.object) break;
          addCond(B, s, 'ongoing', { dur: 'save', src: u.uid, amt: num(e.amt), dtype: e.dtype, savePen: traitSum(B, u, 'savePen') });
          log(B, `${s.name} takes ongoing ${num(e.amt)} ${e.dtype || ''} damage (save ends).`, 'cond');
          fx(B, { t: 'cond', u: s.uid, c: 'ongoing' });
          break;
        }
        case 'mark': addCond(B, s, 'marked', { dur: e.dur || 'eont', src: u.uid }); break;
        case 'heal': {
          const bonus = num(e.bonus || 0) + (u.healBonus || 0);
          if (e.surge) spendSurge(B, u, s, bonus); else heal(B, u, s, e.amt === 'surgeValue' ? s.surgeValue + bonus : num(e.amt) + bonus);
          break;
        }
        case 'temp': giveTemp(B, s, num(e.amt)); break;
        case 'dmg': yield* dealDamage(B, u, s, num(e.amt), { dtype: e.dtype }); break;
        case 'shift': { // subject shifts n: chosen by controller of u
          if (!canAct(s) && s !== u) break;
          const r = reach(B, s, e.n, 'shift');
          const hexes = [...r.values()].filter(v => !v.noEnd && v.cost > 0).map(v => v.h);
          if (!hexes.length) break;
          const ch = yield { choice: 'hex', unit: u, about: s, label: `${s === u ? 'Shift' : 'Shift ' + s.name} up to ${e.n}`, hexes, optional: true, auto: () => G.AI ? G.AI.autoShift(B, s, hexes) : null };
          if (ch) { const node = r.get(Hex.hk(ch)); if (node) { log(B, `${s.name} shifts.`, 'move'); yield* moveAlong(B, s, pathFrom(node), 'shift'); } }
          break;
        }
        case 'teleport': {
          const hexes = freeHexesWithin(B, s, e.n);
          const ch = yield { choice: 'hex', unit: u, about: s, label: `Teleport up to ${e.n}`, hexes, optional: true, auto: () => G.AI ? G.AI.autoShift(B, s, hexes) : null };
          if (ch) { s.pos = ch; fx(B, { t: 'teleport', u: s.uid, to: ch }); yield* enterHex(B, s, ch, 'teleport'); }
          break;
        }
        case 'swap': {
          if (s.immuneForced || s.object) break;
          const a = u.pos; u.pos = s.pos; s.pos = a;
          fx(B, { t: 'step', u: u.uid, to: u.pos, kind: 'shift' }); fx(B, { t: 'step', u: s.uid, to: s.pos, kind: 'forced' });
          log(B, `${u.name} and ${s.name} trade places!`, 'move');
          break;
        }
        case 'grantAttack': yield* grantAttack(B, u, s, t, { atk: num(e.atk || 0), dmg: e.dmg ? num(e.dmg) : 0 }); break;
        case 'save': { // immediate saving throw
          yield* savingThrows(B, s, num(e.bonus || 0), true);
          break;
        }
        case 'zone': {
          const hexes = e.size != null ? Hex.within(ctx.aim || s.pos, e.size) : [s.pos];
          B.zones.push({ id: ++uid, name: e.name, hexes, owner: u.uid, side: u.side, dmg: e.dmg && num(e.dmg), dtype: e.dtype, rounds: e.rounds || 99, color: e.color, cond: e.cond, ends: e.ends });
          fx(B, { t: 'zone' });
          log(B, `${e.name} fills the area.`, 'cond');
          break;
        }
        case 'fn': { const r = e.fn(B, u, s, ctx); if (r && r.next) yield* r; break; }
      }
    }
  }

  // an ally makes a basic attack against t at u's command
  function* grantAttack(B, u, ally, t, o = {}) {
    if (!ally || !canAct(ally) || t.dead) return;
    const bp = ally.powers.find(x => x.basicMelee);
    const rp = ally.powers.find(x => x.basicRanged);
    const opts = [bp, rp].filter(x => x && validTarget(B, ally, x, t));
    opts.sort((a, b) => avgDice(damageSpec(B, ally, b, t)) - avgDice(damageSpec(B, ally, a, t)));
    const pw = opts[0];
    if (!pw) return;
    log(B, `${u.name} directs ${ally.name} to strike!`, 'oa');
    fx(B, { t: 'banner', text: 'Commanded!', u: ally.uid, cls: 'ally' });
    fx(B, { t: 'attack', u: ally.uid, tgt: t.uid, kind: powerRange(ally, pw).kind, power: pw.name });
    const extra = Object.assign({}, pw);
    const bonusAtk = (o.atk || 0) + traitSum(B, u, 'grantAtkMod');
    if (bonusAtk) extra.atk = Object.assign({}, pw.atk, { bonus: (pw.atk.bonus || 0) + bonusAtk });
    if (o.dmg) extra.dmg = pw.dmg + '+' + o.dmg;
    yield* attackRoll(B, ally, extra, t, { granted: true });
  }

  function* savingThrows(B, u, bonus = 0, single) {
    const saves = u.conds.filter(x => x.dur === 'save');
    for (const c of saves) {
      const r = d(20); const tot = r + (u.saveBonus || 0) + bonus - (c.savePen || 0);
      if (tot >= 10) {
        u.conds = u.conds.filter(x => x !== c);
        log(B, `${u.name} saves against ${c.label || c.c} (${tot}).`, 'save');
        fx(B, { t: 'save', u: u.uid, ok: true, c: c.c });
      } else {
        log(B, `${u.name} fails a save against ${c.label || c.c} (${tot}).`, 'cond');
        fx(B, { t: 'save', u: u.uid, ok: false, c: c.c });
        if (c.then && !c.thenDone) { c.thenDone = true; u.conds = u.conds.filter(x => x !== c); addCond(B, u, c.then, { dur: 'save', src: c.src }); log(B, `${u.name} succumbs: now ${c.then}!`, 'cond'); }
      }
      if (single) break;
    }
  }

  // ---------- Using powers (main entry) ----------
  // aim: {unit} for single target, {hex} for area/blast, nothing for self
  function* usePower(B, u, p, aim = {}) {
    if (!canUse(B, u, p)) { log(B, `${u.name} can't use ${p.name} now.`, 'miss'); return false; }
    commitMove(u);
    spend(u, p.action || 'standard');
    if (p.kind === 'encounter' || p.kind === 'daily') u.used[p.id] = true;
    if (p.uses) u.uses[p.id] = (u.uses[p.id] || 0) + 1;
    if (p.recharge) u.recharge[p.id] = false;
    const wasHidden = hasCond(u, 'hidden');
    if (p.atk) removeCond(u, x => x.c === 'hidden');
    u.actedThisFight = true;
    const pr = powerRange(u, p);
    let targets = [], hexes = [];
    if (isArea(p)) { hexes = areaHexes(B, u, p, aim.hex); targets = areaTargets(B, u, p, hexes); }
    else if (p.tgt === 'self') targets = [u];
    else if (aim.unit) targets = [aim.unit];
    log(B, `${u.name} uses ${p.name}.`, 'power');
    fx(B, { t: 'power', u: u.uid, name: p.name, kind: p.kind, side: u.side });
    const bark = typeof p.bark === 'function' ? p.bark(B, u) : p.bark;
    if (bark && u.barks) fx(B, { t: 'bark', u: u.uid, text: bark });
    // provoke: ranged or area attacks while threatened
    if (p.atk && (pr.kind === 'ranged' || pr.kind === 'areaBurst') && !p.noProvoke) {
      for (const e of threatening(B, u)) {
        if (e.oaUsed) continue;
        yield* opportunityAttack(B, e, u);
        if (u.dead || isDying(u)) return true;
      }
    }
    if (p.pre) for (const e of p.pre) yield* applyEffect(B, u, targets[0] || u, e, p, aim);
    // visual
    const tgtUnit = targets[0];
    if (isArea(p)) fx(B, { t: 'area', u: u.uid, hexes, dtype: p.dtype, kind: p.tgt, aim: aim.hex });
    else if (tgtUnit && tgtUnit !== u) fx(B, { t: 'attack', u: u.uid, tgt: tgtUnit.uid, kind: pr.kind, dtype: p.dtype, power: p.name });
    else fx(B, { t: 'self', u: u.uid, dtype: p.dtype });

    const ctx = { aim: aim.hex, allTargets: targets, area: isArea(p), hidden: wasHidden };
    const killsBefore = B.units.filter(x => x.dead && x.side !== u.side && !x.object).length;
    const results = [];
    if (p.atk) {
      for (const t of targets) {
        const n = p.hits || 1;
        for (let i = 0; i < n; i++) {
          if (t.dead) break;
          const tt = (i > 0 && p.hitsSplit) ? (nextTarget(B, u, p, t) || t) : t;
          if (tt.dead) break;
          const r = yield* attackRoll(B, u, p, tt, Object.assign({}, ctx));
          results.push(r);
          if (u.dead || isDying(u)) break;
        }
      }
      yield* traitRun(B, u, 'afterAttack', targets, results);
      // notify enemies that u attacked (fighter combat challenge etc.)
      yield* notifyEnemyAction(B, u, { attack: true, targets });
    } else {
      for (const t of targets) for (const e of (p.hit || [])) yield* applyEffect(B, u, t, e, p, ctx);
      if (p.onHit) for (const t of targets) { const r = p.onHit(B, u, t, ctx, {}); if (r && r.next) yield* r; }
    }
    if (p.eff) for (const e of p.eff) yield* applyEffect(B, u, targets[0] || u, e, p, ctx);
    if (p.after) { const r = p.after(B, u, targets, results, ctx); if (r && r.next) yield* r; }
    if (p.zone) yield* applyEffect(B, u, u, Object.assign({ t: 'zone' }, p.zone), p, ctx);
    const multi = B.units.filter(x => x.dead && x.side !== u.side && !x.object).length - killsBefore;
    if (multi >= 2 && u.side === 'hero') {
      fx(B, { t: 'banner', text: ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!'][multi] || 'RAMPAGE!', u: u.uid, cls: 'crit' });
      log(B, `${u.name} drops ${multi} foes at once!`, 'oa');
      if (multi >= 3) gainMomentum(B, 1, u);
    }
    if (p.shiftAfter && !u.dead && !isDying(u)) yield* applyEffect(B, u, u, { t: 'shift', n: p.shiftAfter, on: 'self' }, p, ctx);
    checkEnd(B);
    return true;
  }
  function nextTarget(B, u, p, prev) {
    const cands = enemiesOf(B, u).filter(e => e !== prev && validTarget(B, u, p, e));
    return (u.monster && cands.find(e => !isDying(e))) || cands[0];
  }

  function* notifyEnemyAction(B, actor, info) {
    for (const e of B.units.slice()) {
      if (e.dead || e.side === actor.side || e.object) continue;
      yield* traitRun(B, e, 'onEnemyAction', actor, info);
      if (actor.dead) return;
    }
  }

  // ---------- Special actions ----------
  // A planned move (opts.plan) stays open after each leg: the hero can keep going with what's left of
  // their speed, or undo legs, until they take another action. Legs that provoked, hit a hazard or
  // otherwise changed the battle are locked in.
  function moveLeft(u, kind = 'move') { const m = u.moving; return m && m.kind === kind ? m.budget - m.spent : null; }
  function commitMove(u) { u.moving = null; }
  function canUndoMove(u) { const m = u.moving; return !!(m && m.legs.length && !m.legs[m.legs.length - 1].locked); }
  function* doMove(B, u, dest, kind = 'move', opts = {}) {
    const open = opts.plan && u.moving && u.moving.kind === kind ? u.moving : null;
    if (!open) commitMove(u);
    if (!open && !canSpend(u, 'move')) return false;
    if (!open && hasCond(u, 'prone')) { spend(u, 'move'); removeCond(u, x => x.c === 'prone'); log(B, `${u.name} stands up.`, 'move'); fx(B, { t: 'stand', u: u.uid }); return true; }
    const budget = open ? open.budget - open.spent : kind === 'shift' ? 1 + (u.shiftBonus || 0) : speedOf(u);
    const r = reach(B, u, budget, kind);
    const node = r.get(Hex.hk(dest));
    if (!node || node.noEnd || node.cost === 0) return false;
    const leg = { pos: u.pos, conds: u.conds.slice(), act: Object.assign({}, u.act), cost: node.cost, moved: u.turnFlags && u.turnFlags.moved, acted: u.actedThisFight };
    if (!open) spend(u, 'move');
    removeCond(u, x => x.c === 'hidden');
    u.actedThisFight = true;
    const logLen = B.log.length;
    yield* moveAlong(B, u, pathFrom(node), kind);
    if (opts.plan && !u.dead) {
      const m = open || (u.moving = { kind, budget, spent: 0, legs: [] });
      m.spent += node.cost;
      leg.locked = B.log.length !== logLen || !Hex.eq(u.pos, dest) || isDying(u);
      if (leg.locked && !Hex.eq(u.pos, dest)) m.spent = m.budget; // stopped short: the move is over
      m.legs.push(leg);
    }
    return true;
  }
  function* undoMove(B, u) {
    if (!canUndoMove(u)) return false;
    const m = u.moving, leg = m.legs.pop();
    u.pos = leg.pos; u.conds = leg.conds; u.actedThisFight = leg.acted;
    if (u.turnFlags) u.turnFlags.moved = leg.moved;
    m.spent -= leg.cost;
    if (!m.legs.length) { u.act = leg.act; u.moving = null; }
    fx(B, { t: 'step', u: u.uid, to: u.pos, kind: 'undo' });
    return true;
  }

  // Charge: a standard action to move up to speed (at least 2 hexes) and make a basic melee attack at +1.
  // path, if given, is the exact route (starting at u.pos); otherwise the safest route is chosen.
  function chargePath(B, u, tgt, path) {
    const bp = u.powers.find(p => p.basicMelee);
    if (!bp || !tgt || tgt.dead) return null;
    if (path) {
      if (path.length < 2 || !Hex.eq(path[0], u.pos)) return null;
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        if (Hex.dist(path[i - 1], path[i]) !== 1 || !canPass(B, u, path[i])) return null;
        cost += stepCost(B, u, path[i], 'move');
      }
      const end = path[path.length - 1];
      if (cost < 2 || cost > speedOf(u) || udist(u, tgt, end) !== 1) return null;
      if (footprint(u, end).some(f => unitAt(B, f) && unitAt(B, f) !== u)) return null;
      return path;
    }
    let best = null;
    for (const v of reach(B, u, speedOf(u), 'move').values()) {
      if (v.noEnd || v.cost < 2 || udist(u, tgt, v.h) !== 1) continue;
      if (!best || v.prov < best.prov || (v.prov === best.prov && v.cost < best.cost)) best = v;
    }
    return best && pathFrom(best);
  }
  function* doCharge(B, u, tgt, path) {
    if (!canSpend(u, 'standard')) return false;
    commitMove(u);
    const bp = u.powers.find(p => p.basicMelee);
    const route = chargePath(B, u, tgt, path);
    if (!route) return false;
    spend(u, 'standard');
    u.act.move = 0; // charging ends your movement for the turn
    u.actedThisFight = true;
    log(B, `${u.name} charges ${tgt.name}!`, 'power');
    fx(B, { t: 'banner', text: 'CHARGE!', u: u.uid, cls: 'ally' });
    yield* moveAlong(B, u, route, 'move');
    if (u.dead || isDying(u) || udist(u, tgt) !== 1) return true;
    fx(B, { t: 'attack', u: u.uid, tgt: tgt.uid, kind: 'melee', power: 'Charge' });
    yield* attackRoll(B, u, bp, tgt, { charge: true, melee: true });
    yield* traitRun(B, u, 'afterAttack', [tgt], []);
    yield* notifyEnemyAction(B, u, { attack: true, targets: [tgt] });
    checkEnd(B);
    return true;
  }
  function chargeOptions(B, u) {
    if (!canSpend(u, 'standard') || speedOf(u) < 2 || !u.powers.find(p => p.basicMelee)) return [];
    const r = reach(B, u, speedOf(u), 'move');
    const out = [];
    for (const e of enemiesOf(B, u)) {
      for (const v of r.values()) if (!v.noEnd && v.cost >= 2 && udist(u, e, v.h) === 1) { out.push(e); break; }
    }
    return out;
  }
  function* secondWind(B, u) {
    const a = u.secondWindAction || 'standard';
    if (u.used.__sw || !canSpend(u, a) || u.surges <= 0) return false;
    commitMove(u);
    spend(u, a); u.used.__sw = true;
    log(B, `${u.name} catches a second wind!`, 'heal');
    fx(B, { t: 'banner', text: 'Second Wind', u: u.uid, cls: 'heal' });
    spendSurge(B, u, u, u.swBonus || 0);
    addCond(B, u, 'defBonus', { dur: 'sont', src: u.uid, amt: 2, label: '+2 defenses' });
    return true;
  }
  function* actionPoint(B, u) {
    if (u.used.__ap || u.monster && !u.actionPoints) return false;
    commitMove(u);
    if (u.monster) u.actionPoints--; else u.used.__ap = true;
    u.act.std++; if (u.act.single) { u.act.single = false; u.act.spent = false; u.act.std = 1; }
    log(B, `${u.name} spends an action point!`, 'power');
    fx(B, { t: 'banner', text: 'Action Point!', u: u.uid, cls: 'ap' });
    yield* traitRun(B, u, 'onActionPoint');
    return true;
  }

  // ---------- Turn flow ----------
  function rollInitiative(B) {
    const entries = [];
    for (const u of B.units) {
      if (u.object) continue;
      const bonus = u.monster ? u.initBonus : (mod(u.abil.DEX) + Math.floor(u.level / 2) + (u.initBonus || 0));
      const lead = B.units.filter(a => a.side === u.side && !a.dead).reduce((m, a) => Math.max(m, traitSum(B, a, 'allyInit')), 0);
      u.init = d(20) + bonus + lead;
      entries.push({ u, init: u.init });
      if (u.solo) entries.push({ u, init: u.init - 10, second: true });
    }
    // party-wide init bonus (warlord etc.)
    entries.sort((a, b) => b.init - a.init || (a.u.side === 'hero' ? -1 : 1));
    B.order = entries;
    log(B, 'Roll for initiative! ' + entries.map(e => `${e.u.name} ${e.init}`).join(', '), 'round');
  }
  function addToInitiative(B, u, afterIdx) {
    u.init = (B.order[afterIdx] ? B.order[afterIdx].init : 0) - 0.5;
    B.order.splice(afterIdx + 1, 0, { u, init: u.init });
  }

  function* startBattle(B) {
    rollInitiative(B);
    for (const u of B.units) yield* traitRun(B, u, 'onBattleStart');
    if (B.scen.intro) log(B, B.scen.intro, 'story');
    B.round = 1;
    log(B, '— Round 1 —', 'round');
    B.turnIdx = -1;
  }

  // advance to next living unit; returns the unit whose turn begins (after start-of-turn processing)
  function* nextTurn(B) {
    for (let guard = 0; guard < 200; guard++) {
      if (B.over) return null;
      B.turnIdx++;
      if (B.turnIdx >= B.order.length) {
        B.turnIdx = 0; B.round++;
        log(B, `— Round ${B.round} —`, 'round');
        fx(B, { t: 'round', n: B.round });
        yield* scenarioEvents(B);
        if (B.over) return null;
        // zones tick down
        B.zones = B.zones.filter(z => --z.rounds > 0);
      }
      const ent = B.order[B.turnIdx];
      const u = ent.u;
      if (u.dead) continue;
      if (ent.second && traitSum(B, u, 'skipSecond')) continue;
      B.active = u; B.activeEntry = ent;
      const ok = yield* startTurn(B, u, ent);
      if (B.over) return null;
      if (ok) return u;
      yield* endTurn(B, u);
    }
    return null;
  }

  function* startTurn(B, u, ent) {
    for (const o of B.units) o.oaUsed = false;
    B.turnNo = (B.turnNo || 0) + 1;
    u.act = { std: 1, move: 1, minor: 1 };
    u.turnFlags = {}; u.moving = null;
    // expire 'sont' from u
    for (const o of B.units) removeCond(o, x => x.src === u.uid && x.dur === 'sont');
    fx(B, { t: 'turn', u: u.uid });
    // recharge
    if (!(ent && ent.second)) for (const p of u.powers) if (p.recharge && u.recharge[p.id] === false) {
      const r = d(6); if (r >= p.recharge) { u.recharge[p.id] = true; log(B, `${u.name}'s ${p.name} recharges (${r}).`, 'save'); }
    }
    // ongoing damage
    for (const c of condsOf(u, 'ongoing')) {
      yield* dealDamage(B, null, u, c.amt, { dtype: c.dtype, label: 'ongoing' });
      if (u.dead) return false;
    }
    // zones and hazards at start of turn
    for (const z of B.zones) {
      if (z.dmg && z.side !== u.side && z.hexes.some(h => Hex.eq(h, u.pos))) {
        yield* dealDamage(B, null, u, z.dmg, { dtype: z.dtype, label: z.name });
        if (u.dead) return false;
      }
    }
    const t = terr(B, u.pos);
    if (t && t.hazard && t.hazard.dmg && !u.monsterImmuneHazard) {
      const r = rollDice(parseDice(t.hazard.dmg));
      log(B, `${u.name} is burned by the ${t.name}.`, 'hazard');
      yield* dealDamage(B, null, u, r.total, { dtype: t.hazard.dtype, label: t.name });
      if (u.dead) return false;
    }
    yield* traitRun(B, u, 'onTurnStart', ent);
    if (u.dead || B.over) return false;
    if (u.regen && !isDying(u) && u.hp > 0) heal(B, null, u, u.regen);
    if (isDying(u)) {
      const r = d(20);
      if (r === 20) { log(B, `${u.name} rallies from death's door! (20)`, 'heal'); u.surges > 0 ? spendSurge(B, null, u) : heal(B, null, u, 1); }
      else if (r < 10) {
        u.deathFails = (u.deathFails || 0) + 1;
        log(B, `${u.name} fails a death save (${r}). [${u.deathFails}/3]`, 'death');
        fx(B, { t: 'save', u: u.uid, ok: false, c: 'death' });
        if (u.deathFails >= 3) { yield* kill(B, null, u); return false; }
      } else { log(B, `${u.name} clings to life (${r}).`, 'save'); fx(B, { t: 'save', u: u.uid, ok: true, c: 'death' }); }
      if (isDying(u)) return false;
    }
    if (hasCond(u, 'stunned') || hasCond(u, 'asleep')) { log(B, `${u.name} is ${hasCond(u, 'asleep') ? 'asleep' : 'stunned'} and can't act!`, 'cond'); return false; }
    if (hasCond(u, 'dazed')) u.act.single = true;
    return true;
  }

  function* endTurn(B, u) {
    commitMove(u);
    if (!u.dead) {
      yield* traitRun(B, u, 'onTurnEnd');
      removeCond(u, x => x.dur === 'eot');
      yield* savingThrows(B, u);
    }
    // conditions lasting until end of u's next turn expire unless placed this turn
    for (const o of B.units) {
      o.conds = o.conds.filter(x => !(x.src === u.uid && x.dur === 'eont' && !x.fresh));
      for (const x of o.conds) if (x.src === u.uid) x.fresh = false;
    }
    // self-applied eont from own powers: treat same
    for (const z of B.zones.slice()) if (z.ends === 'eont' && z.owner === u.uid) { if (z.fresh === false) B.zones.splice(B.zones.indexOf(z), 1); else z.fresh = false; }
    u.secondWindUntil = 0;
    B.telegraphs = B.telegraphs.filter(tg => !tg.expired);
    checkEnd(B);
  }

  function* scenarioEvents(B) {
    for (const ev of (B.scen.events || [])) {
      if (ev.done) continue;
      if ((ev.round && B.round >= ev.round) || (ev.when && ev.when(B))) {
        ev.done = true;
        if (ev.msg) { log(B, ev.msg, 'story'); fx(B, { t: 'story', text: ev.msg }); }
        for (const sp of (ev.spawn || [])) spawnMonster(B, sp.id, Hex.fromOffset(sp.at[0], sp.at[1]), sp);
      }
    }
  }
  function spawnMonster(B, id, pos, sp = {}) {
    let p = pos;
    if (unitAt(B, p) || !passable(B, p)) {
      const alt = Hex.within(pos, 2).filter(h => passable(B, h) && !unitAt(B, h));
      if (!alt.length) return null;
      p = alt[0];
    }
    const m = addUnit(B, makeMonster(id, p, sp));
    addToInitiative(B, m, B.turnIdx < 0 ? B.order.length - 1 : B.turnIdx);
    fx(B, { t: 'spawn', u: m.uid });
    return m;
  }

  function checkEnd(B) {
    if (B.over) return;
    const heroes = B.units.filter(u => u.side === 'hero');
    const foes = B.units.filter(u => u.side === 'enemy');
    if (foes.every(u => u.dead) || (B.scen.bossId && foes.some(f => f.id === B.scen.bossId && f.dead))) {
      B.over = 'win';
      for (const f of foes) if (!f.dead) { f.dead = true; fx(B, { t: 'death', u: f.uid, flee: true }); }
      log(B, B.scen.winText || 'Victory!', 'story');
    } else if (heroes.every(u => u.dead || isDying(u))) {
      B.over = 'lose'; log(B, 'The party has fallen...', 'story');
    }
  }

  // drive a generator to completion, answering choices automatically
  function runAuto(gen) {
    let r = gen.next();
    while (!r.done) r = gen.next(r.value && r.value.auto ? r.value.auto() : undefined);
    return r.value;
  }

  G.Engine = {
    ABIL, mod, d, parseDice, rollDice, avgDice, makeRng, setRng: (r) => { rand = r; }, TERRAIN,
    newBattle, addUnit, makeMonster, spawnMonster, tile, terr, unitAt, enemiesOf, alliesOf, hasCond, condsOf, condSum,
    bloodied, isDying, helpless, canAct, canReact, passable, los, threatening, addCond, removeCond, log, fx,
    speedOf, defense, hasCA, flanking, traitSum, traitRun, powerRange, atkStat, attackBonus, damageSpec,
    validTarget, areaHexes, areaTargets, isArea, canSpend, spend, canUse, powerReady, reach, pathFrom, freeHexesWithin,
    udist, hdist, footprint, occupies, canPass, moveLeft, commitMove, canUndoMove, undoMove, chargePath,
    moveAlong, forcedMove, forcedOptions, dealDamage, heal, spendSurge, giveTemp, attackRoll, applyEffect, savingThrows,
    usePower, doMove, doCharge, chargeOptions, secondWind, actionPoint, startBattle, nextTurn, startTurn, endTurn, checkEnd,
    runAuto, gainMomentum, grantAttack, kill, enterHex, isHostile,
  };
})();
if (typeof module !== 'undefined') module.exports = G;
