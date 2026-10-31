// Campaign runs: a party walks a node map of scenarios, carrying wounds, spent surges, used daily powers
// and items from fight to fight, with a short rest and a level up between fights. Pure state, no DOM,
// so the headless campaign sim can drive it too. Runs and the Record of Heroes live in localStorage.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const RUN_KEY = 'hexbound.run.v1';
  const REC_KEY = 'hexbound.records.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = () => (typeof localStorage !== 'undefined' ? localStorage : null);
  const PACK_MAX = 3;
  const LOOT_PER_WIN = 2;

  // Each map is a list of nodes in rows (row 0 at the bottom); a node lists the nodes it leads to.
  // Milestone 1 is a straight line, but the shape already allows branches.
  const MAPS = {
    hollowmere: {
      id: 'hollowmere', name: 'The Road to Hollowmere',
      blurb: 'Three fights stand between your party and the King\'s Road.',
      nodes: [
        { id: 'n1', row: 0, col: 0, type: 'combat', scen: 'goblins', next: ['n2'] },
        { id: 'n2', row: 1, col: 0, type: 'combat', scen: 'barrow', next: ['n3'] },
        { id: 'n3', row: 2, col: 0, type: 'combat', scen: 'bandits', next: [] },
      ],
    },
  };

  const scenOf = (id) => G.Scenarios.find(s => s.id === id);
  const mapOf = (run) => MAPS[run.map];
  const nodeOf = (run, id) => mapOf(run).nodes.find(n => n.id === id);

  function newRun(party, difficulty, opts = {}) {
    const rand = opts.rand || Math.random;
    const ids = Object.keys(G.Items || {});
    const map = MAPS[opts.map || 'hollowmere'];
    return {
      v: 1, id: 'run' + Date.now(), started: Date.now(), map: map.id, difficulty: difficulty || 'normal',
      partyName: party.name, level: scenOf(map.nodes[0].scen).level,
      heroes: party.heroes.map(b => ({
        build: clone(b), damage: 0, surgesSpent: 0, daily: [], dead: false, fellAt: null,
        pack: ids.length ? [ids[Math.floor(rand() * ids.length)]] : [],
        stats: { dmg: 0, kills: 0, crits: 0, healed: 0, taken: 0 },
      })),
      path: [], stage: 'map', battles: [], camp: null, outcome: null,
    };
  }

  // nodes the party can walk to next
  function available(run) {
    const m = mapOf(run);
    if (!run.path.length) return m.nodes.filter(n => n.row === 0).map(n => n.id);
    return nodeOf(run, run.path[run.path.length - 1]).next.slice();
  }
  const living = (run) => run.heroes.filter(h => !h.dead);
  // the hero as they stand right now, at the run's level
  const unitOf = (run, h) => G.Build.makeHero(h.build, run.level);
  function status(run, h) {
    const u = unitOf(run, h);
    return {
      maxHp: u.maxHp, hp: Math.max(0, u.maxHp - h.damage), surges: Math.max(0, u.surges - h.surgesSpent), maxSurges: u.surges,
      surgeValue: u.surgeValue, dailies: u.powers.filter(p => p.kind === 'daily').map(p => ({ id: p.id, name: p.name, used: h.daily.includes(p.id) })),
    };
  }

  // what startBattle needs for this node: the living heroes' builds, their packs and their carried state
  function battleSetup(run, nodeId) {
    const n = nodeOf(run, nodeId), scen = scenOf(n.scen);
    const hs = living(run);
    return {
      scen, node: n, heroes: hs,
      party: { name: run.partyName, heroes: hs.map(h => h.build) },
      opts: { items: hs.map(h => h.pack.slice()), carry: hs.map(h => ({ damage: h.damage, surgesSpent: h.surgesSpent, daily: h.daily.slice() })) },
    };
  }

  // fold a finished battle back into the run. Returns a summary for the result screen.
  function recordBattle(run, nodeId, B) {
    const hs = living(run);
    const units = B.units.filter(u => u.side === 'hero');
    const fallen = [];
    hs.forEach((h, i) => {
      const u = units[i]; if (!u) return;
      const st = B.stats[u.uid];
      for (const k in h.stats) h.stats[k] += st[k] || 0;
      if (u.dead) { h.dead = true; h.fellAt = scenOf(nodeOf(run, nodeId).scen).name; fallen.push(h.build.name); return; }
      const fresh = unitOf(run, h);
      h.damage = Math.max(0, fresh.maxHp - Math.max(0, u.hp));
      h.surgesSpent = Math.max(0, fresh.surges - u.surges);
      h.daily = u.powers.filter(p => p.kind === 'daily' && u.used[p.id]).map(p => p.id);
      h.pack = u.powers.filter(p => p.kind === 'item' && (u.uses[p.id] || 0) < (p.uses || 1)).map(p => p.item);
    });
    const won = B.over === 'win';
    run.battles.push({ node: nodeId, scen: nodeOf(run, nodeId).scen, won, rounds: B.round });
    if (won) run.path.push(nodeId);
    if (!won) end(run, 'defeat');
    else if (!available(run).length) end(run, 'victory');
    else makeCamp(run);
    return { won, fallen, over: !!run.outcome };
  }

  // ---- camp: loot, level up, short rest ----
  function makeCamp(run, rand = Math.random) {
    const ids = Object.keys(G.Items || {});
    const found = [];
    for (let i = 0; i < LOOT_PER_WIN && ids.length; i++) {
      const item = ids[Math.floor(rand() * ids.length)];
      const room = living(run).filter(h => h.pack.length < PACK_MAX);
      if (!room.length) break;
      const least = Math.min(...room.map(h => h.pack.length));
      const pick = room.filter(h => h.pack.length === least);
      const h = pick[Math.floor(rand() * pick.length)];
      h.pack.push(item); found.push({ item, hero: run.heroes.indexOf(h) });
    }
    const from = run.level;
    const to = scenOf(nodeOf(run, available(run)[0]).scen).level;
    const before = run.heroes.map(h => h.dead ? null : unitOf(run, h));
    run.level = Math.max(from, to);
    run.camp = { found, from, to: run.level, before: before.map(u => u && { maxHp: u.maxHp, surges: u.surges, powers: u.powers.map(p => p.id), feats: u.feats.slice() }) };
    run.stage = 'camp';
  }

  // the picks a hero gets at this camp's new level(s): new power slots and new feat slots
  function levelChoices(run, hi) {
    const h = run.heroes[hi]; if (h.dead || !run.camp) return [];
    const { from, to } = run.camp; if (to <= from) return [];
    const out = [];
    const a = G.Build.slotsFor(from), b = G.Build.slotsFor(to);
    for (const slot of Object.keys(b)) if (b[slot] > a[slot]) {
      const opts = G.Build.powersOf(h.build.cls, slot);
      let cur = [].concat(h.build.powers[slot] || []).filter(id => opts.some(o => o.id === id));
      if (!cur.length) cur = opts.slice(0, b[slot]).map(o => o.id);
      out.push({ kind: 'power', slot, options: opts.map(o => o.id), pick: cur[0] });
    }
    const fa = G.Build.featSlots(h.build, from), fb = G.Build.featSlots(h.build, to);
    for (let i = fa; i < fb; i++) {
      const earlier = h.build.feats.slice(0, i);
      const opts = Object.entries(G.Build.FEATS).filter(([id, f]) => (!f.cls || f.cls.includes(h.build.cls)) && !earlier.includes(id)).map(([id]) => id);
      out.push({ kind: 'feat', index: i, options: opts, pick: opts.includes(h.build.feats[i]) ? h.build.feats[i] : null });
    }
    return out;
  }
  function choose(run, hi, choice, id) {
    const h = run.heroes[hi];
    if (choice.kind === 'power') h.build.powers[choice.slot] = id;
    else {
      while (h.build.feats.length < choice.index) h.build.feats.push('');
      // a feat can only be taken once: clear it from any later slot
      h.build.feats = h.build.feats.map((f, i) => (i !== choice.index && f === id) ? '' : f);
      h.build.feats[choice.index] = id;
    }
    clampHero(run, h);
  }
  // a feat swap (Toughness, Durable) can change max HP or surges: never leave negative headroom
  function clampHero(run, h) {
    const u = unitOf(run, h);
    h.damage = Math.min(h.damage, u.maxHp);
    h.surgesSpent = Math.min(h.surgesSpent, u.surges);
  }
  function unfilledChoices(run) {
    return run.heroes.some((h, i) => levelChoices(run, i).some(c => c.kind === 'feat' && !c.pick));
  }

  // short rest: spend a healing surge to regain its value
  function spendSurge(run, hi) {
    const h = run.heroes[hi]; if (h.dead) return false;
    const s = status(run, h);
    if (s.surges <= 0 || h.damage <= 0) return false;
    h.surgesSpent++; h.damage = Math.max(0, h.damage - s.surgeValue);
    return true;
  }
  // a sensible default rest: keep spending while a surge would mostly go to use
  function autoRest(run, hi) {
    const h = run.heroes[hi]; let n = 0;
    while (!h.dead && h.damage >= Math.ceil(status(run, h).surgeValue / 2) && spendSurge(run, hi)) n++;
    return n;
  }
  function breakCamp(run) {
    // a hero still at 0 HP with no surges left comes round at 1 HP
    for (const h of living(run)) { const u = unitOf(run, h); if (h.damage >= u.maxHp) h.damage = u.maxHp - 1; }
    run.camp = null; run.stage = 'map';
  }

  // ---- end of a run, and the Record of Heroes ----
  function end(run, outcome) {
    run.outcome = outcome; run.stage = 'over'; run.ended = Date.now();
    const last = run.battles[run.battles.length - 1];
    const totals = run.heroes.reduce((t, h) => { for (const k in h.stats) t[k] = (t[k] || 0) + h.stats[k]; return t; }, {});
    const score = (h) => h.stats.dmg + h.stats.healed * 1.2 + h.stats.kills * 6 + h.stats.crits * 3;
    const mvp = run.heroes.slice().sort((a, b) => score(b) - score(a))[0];
    const rec = {
      id: run.id, started: run.started, ended: run.ended, outcome, difficulty: run.difficulty, partyName: run.partyName, map: mapOf(run).name,
      level: run.level, won: run.battles.filter(b => b.won).length, total: mapOf(run).nodes.length,
      reached: last ? scenOf(last.scen).name : null, rounds: run.battles.reduce((t, b) => t + b.rounds, 0), totals,
      mvp: mvp && mvp.stats.dmg + mvp.stats.healed > 0 ? mvp.build.name : null,
      heroes: run.heroes.map(h => ({ name: h.build.name, cls: h.build.cls, sub: h.build.sub, ancestry: h.build.ancestry, fell: h.dead, fellAt: h.fellAt, kills: h.stats.kills, dmg: h.stats.dmg })),
    };
    run.record = rec;
    addRecord(rec);
    return rec;
  }
  function abandon(run) { if (!run.outcome) end(run, 'abandoned'); clearRun(); }

  function load(key, dflt) { try { const s = store(); const v = s && JSON.parse(s.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function save(key, v) { try { const s = store(); if (s) s.setItem(key, JSON.stringify(v)); } catch (e) { } }
  function loadRun() { const r = load(RUN_KEY, null); return r && r.v === 1 && MAPS[r.map] && !r.outcome ? r : null; }
  function saveRun(run) { save(RUN_KEY, run); }
  function clearRun() { try { const s = store(); if (s) s.removeItem(RUN_KEY); } catch (e) { } }
  function records() { return load(REC_KEY, []); }
  function addRecord(rec) { const list = records().filter(r => r.id !== rec.id); list.unshift(rec); save(REC_KEY, list.slice(0, 100)); }
  function clearRecords() { save(REC_KEY, []); }

  G.Campaign = {
    MAPS, PACK_MAX, LOOT_PER_WIN, newRun, available, living, status, battleSetup, recordBattle, makeCamp, levelChoices, choose,
    unfilledChoices, spendSurge, autoRest, breakCamp, end, abandon, loadRun, saveRun, clearRun, records, clearRecords, scenOf, nodeOf, mapOf,
  };
})();
if (typeof module !== 'undefined') module.exports = G;
