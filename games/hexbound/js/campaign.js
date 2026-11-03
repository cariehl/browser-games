// Campaign runs: a party walks three acts of a branching node map (fights, elites, events, shops, rest sites,
// treasure and an act boss), carrying wounds, spent surges, used daily powers, items, gear and gold from node to
// node. Pure state, no DOM, so the headless campaign sim can drive it too. Runs and the Record of Heroes live in
// localStorage.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const RUN_KEY = 'hexbound.run.v2';
  const REC_KEY = 'hexbound.records.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = () => (typeof localStorage !== 'undefined' ? localStorage : null);
  const PACK_MAX = 3;
  const START_GOLD = 40;
  const MAX_LEVEL = 5;
  // party level by XP: a fight is 1 XP, an elite or a boss 2. Beating an act boss also guarantees a level.
  const XP_LEVELS = [0, 0, 3, 6, 10, 14];
  const XP = { combat: 1, elite: 2, boss: 2 };
  const levelFor = (xp) => { let l = 1; for (let k = 2; k <= MAX_LEVEL; k++) if (xp >= XP_LEVELS[k]) l = k; return l; };

  const ACTS = [
    { name: 'The Thornwood', sub: 'Act I', rows: 7, width: 5, factions: ['goblins', 'beasts'], eliteScen: 'goblins', boss: 'barrow', minLevelAfter: 3, gearTier: 1,
      blurb: 'Goblin warbands and worse haunt the old forest road. At its end, a hill cemetery where nothing stays buried.' },
    { name: 'The King\'s Road', sub: 'Act II', rows: 7, width: 5, factions: ['bandits', 'undead', 'beasts'], boss: 'bandits', minLevelAfter: 5, gearTier: 2,
      blurb: 'The highway to Hollowmere: barricades, highwaymen, and the restless dead of old battlefields. Merrin the Red holds the toll.' },
    { name: 'Hollowmere', sub: 'Act III', rows: 5, width: 4, factions: ['bakery', 'undead', 'bandits'], boss: 'golem', gearTier: 3,
      blurb: 'The city itself, overrun by the Grand Bakery\'s escaped confections. Something enormous waits at the heart of it.' },
  ];
  const NODE_TYPES = {
    combat: { name: 'Fight', icon: '⚔' }, elite: { name: 'Elite', icon: '💀' }, event: { name: 'Unknown', icon: '❓' },
    shop: { name: 'Merchant', icon: '💰' }, rest: { name: 'Rest Site', icon: '🔥' }, treasure: { name: 'Treasure', icon: '🧰' }, boss: { name: 'Boss', icon: '👑' },
  };
  const PRICE = { potion: 22, throwable: 26, gear: 18 };
  const GEAR_PRICE = { 1: 75, 2: 130, 3: 200 };

  const rng = (seed) => G.Encounters.rng(seed);
  const pickOf = (r, list) => list[Math.floor(r() * list.length)];
  const scenOf = (id) => G.Scenarios.find(s => s.id === id);

  // ---------- the act maps ----------
  // Slay-the-Spire style: a few paths climb a grid, each step moving up and at most one column sideways, never
  // crossing another path. The cells the paths touch become nodes; every top node leads to the act's boss.
  function genAct(ai, seed) {
    const A = ACTS[ai], r = rng(seed), R = A.rows, Wd = A.width;
    const cells = new Map(), edges = [];
    const key = (row, col) => `${ai + 1}-${row}-${col}`;
    const touch = (row, col) => { const k = key(row, col); if (!cells.has(k)) cells.set(k, { id: k, act: ai, row, col, next: [] }); return cells.get(k); };
    const starts = [];
    for (let p = 0; p < 4; p++) {
      let col = Math.floor(r() * Wd);
      if (p === 1 && col === starts[0]) col = (col + 1 + Math.floor(r() * (Wd - 1))) % Wd;
      starts.push(col);
      for (let row = 0; row < R; row++) {
        const n = touch(row, col);
        if (row === R - 1) break;
        let nc = Math.max(0, Math.min(Wd - 1, col + Math.floor(r() * 3) - 1));
        if (edges.some(e => e.row === row && ((e.a < col && e.b > nc) || (e.a > col && e.b < nc)))) nc = col;
        if (!n.next.includes(key(row + 1, nc))) n.next.push(key(row + 1, nc));
        edges.push({ row, a: col, b: nc });
        col = nc;
      }
    }
    const nodes = [...cells.values()];
    const parents = (n) => nodes.filter(o => o.next.includes(n.id));
    const mid = Math.floor(R / 2);
    for (const n of nodes.sort((a, b) => a.row - b.row || a.col - b.col)) {
      if (n.row === 0) n.type = 'combat';
      else if (n.row === R - 1) n.type = 'rest';
      else if (n.row === mid && R >= 6) n.type = 'treasure';
      else {
        for (let k = 0; k < 8; k++) {
          const x = r();
          let t = x < 0.42 ? 'combat' : x < 0.66 ? 'event' : x < 0.8 ? 'elite' : x < 0.91 ? 'shop' : 'rest';
          if (t === 'elite' && n.row < 2) t = 'combat';
          if (t === 'rest' && (n.row < 2 || n.row === R - 2)) t = 'event';
          if (['elite', 'shop', 'rest'].includes(t) && parents(n).some(p => p.type === t)) continue;
          n.type = t; break;
        }
        n.type = n.type || 'combat';
      }
    }
    // every act gets at least one merchant and (in Acts I and II) at least one elite
    const middle = nodes.filter(n => n.row > 0 && n.row < R - 1 && n.type !== 'treasure');
    if (!nodes.some(n => n.type === 'shop')) { const c = middle.filter(n => n.type === 'event' || n.type === 'combat'); if (c.length) pickOf(r, c).type = 'shop'; }
    if (ai < 2 && !nodes.some(n => n.type === 'elite')) { const c = middle.filter(n => n.row >= 2 && n.type === 'combat'); if (c.length) pickOf(r, c).type = 'elite'; }
    for (const n of nodes) {
      n.seed = Math.floor(r() * 1e9);
      if (n.type === 'combat') n.faction = pickOf(r, A.factions);
      if (n.type === 'elite') { if (A.eliteScen && r() < 0.4) n.scen = A.eliteScen; else n.faction = pickOf(r, A.factions); }
    }
    const boss = { id: `${ai + 1}-boss`, act: ai, row: R, col: (Wd - 1) / 2, type: 'boss', scen: A.boss, next: [], seed: Math.floor(r() * 1e9) };
    for (const n of nodes) if (n.row === R - 1) n.next = [boss.id];
    nodes.push(boss);
    return { act: ai, name: A.name, nodes };
  }

  const mapOf = (run) => run.maps[run.act];
  const nodeOf = (run, id) => { for (const m of run.maps) { const n = m.nodes.find(x => x.id === id); if (n) return n; } return null; };

  function newRun(party, difficulty, opts = {}) {
    const rand = opts.rand || Math.random;
    const seed = opts.seed != null ? opts.seed : Math.floor(rand() * 1e9);
    const ids = Object.keys(G.Items || {});
    return {
      v: 2, id: 'run' + Date.now() + Math.floor(rand() * 1000), started: Date.now(), seed, difficulty: difficulty || 'normal',
      partyName: party.name, level: 1, xp: 0, gold: START_GOLD, act: 0,
      maps: ACTS.map((a, i) => genAct(i, seed + i * 1013)),
      heroes: party.heroes.map(b => ({
        build: clone(b), damage: 0, surgesSpent: 0, daily: [], dead: false, fellAt: null,
        pack: ids.length ? [ids[Math.floor(rand() * ids.length)]] : [],
        gear: { weapon: null, armor: null, neck: null, trinket: null }, boons: [],
        stats: { dmg: 0, kills: 0, crits: 0, healed: 0, taken: 0 },
      })),
      stash: [], path: [], stage: 'map', node: null, battles: [], camp: null, event: null, shop: null, seen: [], outcome: null,
      log: [],
    };
  }

  // nodes the party can walk to next
  function available(run) {
    const m = mapOf(run);
    const last = run.path.length ? nodeOf(run, run.path[run.path.length - 1]) : null;
    if (!last || last.act !== run.act) return m.nodes.filter(n => n.row === 0).map(n => n.id);
    return last.next.slice();
  }
  const living = (run) => run.heroes.filter(h => !h.dead);
  const gearOf = (h) => Object.assign({}, h.gear, { boons: h.boons || [] });
  // the hero as they stand right now, at the run's level, in their gear
  const unitOf = (run, h) => G.Build.makeHero(h.build, run.level, gearOf(h));
  function status(run, h) {
    const u = unitOf(run, h);
    return {
      maxHp: u.maxHp, hp: Math.max(0, u.maxHp - h.damage), surges: Math.max(0, u.surges - h.surgesSpent), maxSurges: u.surges,
      surgeValue: u.surgeValue, def: u.def, speed: u.speed,
      dailies: u.powers.filter(p => p.kind === 'daily').map(p => ({ id: p.id, name: p.name, used: h.daily.includes(p.id) })),
    };
  }
  const nextLevelXp = (run) => run.level >= MAX_LEVEL ? null : XP_LEVELS[run.level + 1];

  // ---------- entering a node ----------
  function enter(run, nodeId, rand = Math.random) {
    const n = nodeOf(run, nodeId);
    run.node = nodeId;
    if (n.type === 'combat' || n.type === 'elite' || n.type === 'boss') { run.stage = 'battle'; return 'battle'; }
    run.path.push(nodeId);
    if (n.type === 'event') {
      const r = rng(n.seed);
      const pool = Object.keys(G.Events).filter(id => !run.seen.includes(id));
      const id = pickOf(r, pool.length ? pool : Object.keys(G.Events));
      run.seen.push(id);
      run.event = { id, result: null };
      run.stage = 'event';
    } else if (n.type === 'shop') { run.shop = makeShop(run, n); run.stage = 'shop'; }
    else if (n.type === 'rest') { run.stage = 'rest'; run.rest = { done: null }; }
    else if (n.type === 'treasure') { run.stage = 'treasure'; run.treasure = { opened: null }; }
    return run.stage;
  }

  // what startBattle needs for a fight: the scenario (fixed or generated), the living heroes' builds, packs, gear
  // and carried state, and how far to scale the monsters to the party's level
  function battleSetup(run, nodeId) {
    const n = nodeOf(run, nodeId);
    const hs = living(run);
    const fight = run.event && run.event.fight;
    let scen, lvAdj = 0;
    if (fight) {
      scen = G.Encounters.make({ faction: fight.faction, kind: fight.kind, level: run.level, heroes: hs.length, seed: n.seed + 77, act: run.act + 1 });
    } else if (n.scen) {
      scen = shrink(scenOf(n.scen), hs.length);
      lvAdj = Math.max(-1, Math.min(0, run.level - scen.level)); // fixed fights shrink to an underlevelled party but never grow
    } else {
      scen = G.Encounters.make({ faction: n.faction, kind: n.type, level: run.level, heroes: hs.length, seed: n.seed, act: run.act + 1 });
    }
    return {
      scen, node: n, heroes: hs, kind: fight ? 'combat' : n.type,
      party: { name: run.partyName, heroes: hs.map(h => h.build) },
      opts: {
        items: hs.map(h => h.pack.slice()), gear: hs.map(gearOf), level: run.level, lvAdj,
        carry: hs.map(h => ({ damage: h.damage, surgesSpent: h.surgesSpent, daily: h.daily.slice() })),
      },
    };
  }
  // a hand-built fight against a party missing heroes: drop a share of the rank and file (never the elites, the
  // boss or objects) and of the reinforcements, so a party of three still has a chance
  function shrink(scen, n) {
    if (n >= 4) return scen;
    const keep = n / 4;
    const thin = (list) => { let acc = 0; return list.filter(e => { const m = G.Monsters[e.id]; if (!m || m.elite || m.solo || m.side === 'object') return true; acc += keep; if (acc >= 1) { acc -= 1; return true; } return false; }); };
    return Object.assign({}, scen, { enemies: thin(scen.enemies), events: (scen.events || []).map(ev => Object.assign({}, ev, { spawn: ev.spawn ? thin(ev.spawn) : ev.spawn })) });
  }
  // a short preview of a fight node for the map panel
  function fightPreview(run, nodeId) {
    const n = nodeOf(run, nodeId);
    if (n.scen) { const s = scenOf(n.scen); return { scen: s, fixed: true, level: Math.max(s.level - 1, Math.min(s.level + 2, run.level)) }; }
    const F = G.Encounters.FACTIONS[n.faction];
    return { faction: F, level: run.level, fixed: false };
  }

  // fold a finished battle back into the run. Returns a summary for the result screen.
  function recordBattle(run, nodeId, B, rand = Math.random) {
    const n = nodeOf(run, nodeId);
    const hs = living(run);
    const units = B.units.filter(u => u.side === 'hero');
    const fallen = [];
    const kind = run.event && run.event.fight ? 'combat' : n.type;
    hs.forEach((h, i) => {
      const u = units[i]; if (!u) return;
      const st = B.stats[u.uid];
      for (const k in h.stats) h.stats[k] += st[k] || 0;
      if (u.dead) { h.dead = true; h.fellAt = B.scen.name; fallen.push(h.build.name); return; }
      const fresh = unitOf(run, h);
      h.damage = Math.max(0, fresh.maxHp - Math.max(0, u.hp));
      h.surgesSpent = Math.max(0, fresh.surges - u.surges);
      h.daily = u.powers.filter(p => p.kind === 'daily' && u.used[p.id]).map(p => p.id);
      h.pack = u.powers.filter(p => p.kind === 'item' && (u.uses[p.id] || 0) < (p.uses || 1)).map(p => p.item);
    });
    const won = B.over === 'win';
    run.battles.push({ node: nodeId, scen: B.scen.id, name: B.scen.name, kind, act: run.act, won, rounds: B.round });
    if (!won) { end(run, 'defeat'); return { won, fallen, over: true }; }
    if (!run.path.includes(nodeId)) run.path.push(nodeId);
    run.event = null;
    const last = kind === 'boss' && run.act === ACTS.length - 1;
    makeCamp(run, kind, rand);
    if (last) end(run, 'victory');
    return { won, fallen, over: !!run.outcome };
  }

  // ---------- rewards ----------
  const randomItem = (r) => { const ids = Object.keys(G.Items); return ids[Math.floor(r() * ids.length)]; };
  // put a consumable in the emptiest pack; a full party sells it on for half price
  function giveItem(run, id, r = Math.random) {
    const room = living(run).filter(h => h.pack.length < PACK_MAX);
    if (!room.length) { const g = Math.floor(itemPrice(id) / 2); run.gold += g; return { item: id, hero: null, sold: g }; }
    const least = Math.min(...room.map(h => h.pack.length));
    const pick = room.filter(h => h.pack.length === least);
    const h = pick[Math.floor(r() * pick.length)];
    h.pack.push(id);
    return { item: id, hero: run.heroes.indexOf(h) };
  }
  function rollGear(r, tier, slot, exclude = []) {
    const owned = (id) => exclude.includes(id);
    let pool = Object.entries(G.Gear).filter(([id, g]) => g.tier <= tier && g.tier >= Math.max(1, tier - 1) && (!slot || g.slot === slot) && !owned(id)).map(([id]) => id);
    if (!pool.length) pool = Object.keys(G.Gear).filter(id => !slot || G.Gear[id].slot === slot);
    // favour the top tier
    const top = pool.filter(id => G.Gear[id].tier === tier);
    return (top.length && r() < 0.6) ? pickOf(r, top) : pickOf(r, pool);
  }
  const ownedGear = (run) => run.stash.concat(...run.heroes.map(h => Object.values(h.gear).filter(Boolean)));
  function gearChoices(run, r, tier, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rollGear(r, tier, null, ownedGear(run).concat(out)));
    return out;
  }

  // camp after a won fight: gold, loot, XP and level up, a short rest (or a full one after a boss)
  function makeCamp(run, kind, rand = Math.random) {
    const n = nodeOf(run, run.node);
    const r = rng(((n && n.seed) || 1) + 991);
    const A = ACTS[run.act];
    const gold = kind === 'boss' ? 70 + Math.floor(r() * 20) : kind === 'elite' ? 30 + Math.floor(r() * 12) : 10 + Math.floor(r() * 8) + run.act * 4;
    run.gold += gold;
    const found = [giveItem(run, randomItem(r), r)];
    if (kind !== 'combat' || r() < 0.35) found.push(giveItem(run, randomItem(r), r));
    const tier = Math.min(3, A.gearTier + (kind === 'boss' ? 1 : 0));
    const gear = kind === 'elite' ? gearChoices(run, r, tier, 2) : kind === 'boss' && run.act < ACTS.length - 1 ? gearChoices(run, r, tier, 3) : [];
    const from = run.level;
    run.xp += XP[kind] || 1;
    let to = Math.max(from, levelFor(run.xp));
    if (kind === 'boss' && A.minLevelAfter) to = Math.max(to, Math.min(MAX_LEVEL, A.minLevelAfter));
    if (to > from) run.xp = Math.max(run.xp, XP_LEVELS[to]);
    const before = run.heroes.map(h => h.dead ? null : unitOf(run, h));
    run.level = to;
    run.camp = {
      kind, gold, found, gear, gearTaken: null, from, to, actDone: kind === 'boss',
      before: before.map(u => u && { maxHp: u.maxHp, surges: u.surges, powers: u.powers.map(p => p.id), feats: u.feats.slice() }),
    };
    // a boss ends the act: the party takes an extended rest on the far side
    if (kind === 'boss') for (const h of living(run)) { h.damage = 0; h.surgesSpent = 0; h.daily = []; }
    run.stage = 'camp';
  }
  function takeGear(run, id) {
    const c = run.camp; if (!c || c.gearTaken || !c.gear.includes(id)) return false;
    c.gearTaken = id; run.stash.push(id); autoEquip(run, id); return true;
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
  // a feat or gear swap can change max HP or surges: never leave negative headroom
  function clampHero(run, h) {
    const u = unitOf(run, h);
    h.damage = Math.max(0, Math.min(h.damage, u.maxHp));
    h.surgesSpent = Math.max(0, Math.min(h.surgesSpent, u.surges));
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
  function wakeUp(run) {
    // a hero still at 0 HP with no surges left comes round at 1 HP
    for (const h of living(run)) { const u = unitOf(run, h); if (h.damage >= u.maxHp) h.damage = u.maxHp - 1; }
  }
  function breakCamp(run) {
    wakeUp(run);
    const actDone = run.camp && run.camp.actDone;
    run.camp = null; run.stage = 'map'; run.node = null;
    if (actDone && run.act < ACTS.length - 1) run.act++;
  }
  // back to the map from an event, shop, rest site or treasure
  function leave(run) { wakeUp(run); run.event = null; run.shop = null; run.rest = null; run.treasure = null; run.node = null; run.stage = 'map'; }

  // ---------- gear and packs ----------
  function equip(run, hi, id) {
    const h = run.heroes[hi], g = G.Gear[id]; const k = run.stash.indexOf(id);
    if (!g || k < 0 || h.dead) return false;
    run.stash.splice(k, 1);
    if (h.gear[g.slot]) run.stash.push(h.gear[g.slot]);
    h.gear[g.slot] = id; clampHero(run, h); return true;
  }
  function unequip(run, hi, slot) {
    const h = run.heroes[hi]; if (!h.gear[slot]) return false;
    run.stash.push(h.gear[slot]); h.gear[slot] = null; clampHero(run, h); return true;
  }
  // a fresh find goes to whoever gains most from it (an empty slot first, then the lowest tier in that slot)
  function autoEquip(run, id) {
    const g = G.Gear[id]; const hs = living(run);
    const cand = hs.filter(h => !h.gear[g.slot])[0] || hs.filter(h => G.Gear[h.gear[g.slot]].tier < g.tier || (G.Gear[h.gear[g.slot]].enh || 0) < (g.enh || 0)).sort((a, b) => G.Gear[a.gear[g.slot]].tier - G.Gear[b.gear[g.slot]].tier)[0];
    if (cand) return equip(run, run.heroes.indexOf(cand), id);
    return false;
  }
  function movePack(run, from, k, to) {
    const a = run.heroes[from], b = run.heroes[to];
    if (!a || !b || a.dead || b.dead || from === to || k < 0 || k >= a.pack.length || b.pack.length >= PACK_MAX) return false;
    b.pack.push(a.pack.splice(k, 1)[0]); return true;
  }

  // ---------- merchants ----------
  const itemPrice = (id) => PRICE[G.Items[id].cat] || 22;
  const gearPrice = (id) => GEAR_PRICE[G.Gear[id].tier];
  function makeShop(run, n) {
    const r = rng(n.seed + 5), tier = ACTS[run.act].gearTier;
    const ids = Object.keys(G.Items);
    const items = []; while (items.length < 4) { const id = pickOf(r, ids); if (!items.includes(id) || items.length >= ids.length) items.push(id); }
    const gear = gearChoices(run, r, tier, 3);
    const markup = 1 + run.act * 0.1;
    return {
      items: items.map(id => ({ id, price: Math.round(itemPrice(id) * markup), sold: false })),
      gear: gear.map(id => ({ id, price: Math.round(gearPrice(id) * markup), sold: false })),
      services: [
        { id: 'heal', name: 'Field surgeon', text: 'Every hero heals to full HP (no surges spent).', price: Math.round(30 * markup), used: false },
        { id: 'curse', name: 'Wandering priest', text: 'Lift every curse on the party.', price: Math.round(45 * markup), used: false },
        { id: 'raise', name: 'Rite of Return', text: 'Call a fallen hero back from death. They return at full HP, but the grave\'s chill clings to them (Bone-Weary: −1 healing surge).', price: Math.round(120 * markup), used: false },
      ],
    };
  }
  function buy(run, kind, k, hi) {
    const s = run.shop; if (!s) return { ok: false };
    if (kind === 'item') {
      const it = s.items[k]; if (!it || it.sold || run.gold < it.price) return { ok: false };
      let h = hi != null ? run.heroes[hi] : null;
      if (h && (h.dead || h.pack.length >= PACK_MAX)) return { ok: false, why: 'pack' };
      if (!h) { const room = living(run).filter(x => x.pack.length < PACK_MAX).sort((a, b) => a.pack.length - b.pack.length); h = room[0]; }
      if (!h) return { ok: false, why: 'pack' };
      run.gold -= it.price; it.sold = true; h.pack.push(it.id); return { ok: true };
    }
    if (kind === 'gear') {
      const it = s.gear[k]; if (!it || it.sold || run.gold < it.price) return { ok: false };
      run.gold -= it.price; it.sold = true; run.stash.push(it.id); autoEquip(run, it.id); return { ok: true };
    }
    if (kind === 'service') {
      const sv = s.services[k]; if (!sv || sv.used || run.gold < sv.price) return { ok: false };
      if (sv.id === 'heal') { if (!living(run).some(h => h.damage > 0)) return { ok: false, why: 'unhurt' }; for (const h of living(run)) h.damage = 0; }
      if (sv.id === 'curse') { if (!removeCurses(run)) return { ok: false, why: 'uncursed' }; }
      if (sv.id === 'raise') {
        const h = hi != null ? run.heroes[hi] : run.heroes.find(x => x.dead);
        if (!h || !h.dead) return { ok: false, why: 'nobody' };
        h.dead = false; h.fellAt = null; h.damage = 0; h.surgesSpent = 0; h.daily = [];
        if (!h.boons.includes('c_weary')) h.boons.push('c_weary');
        clampHero(run, h);
      }
      run.gold -= sv.price; sv.used = true; return { ok: true };
    }
    return { ok: false };
  }
  const sellPrice = (id) => Math.floor(gearPrice(id) * 0.4);
  function sell(run, k) { const id = run.stash[k]; if (!id) return false; run.stash.splice(k, 1); run.gold += sellPrice(id); return true; }

  // ---------- rest sites ----------
  // recover: everyone heals to full and regains 2 surges; meditate: every daily power comes back;
  // scavenge: a consumable for every hero with room, and a short-rest's worth of healing
  const REST_OPTIONS = {
    recover: { name: 'Rest and recover', icon: '🛏', text: 'Every hero heals to full HP and regains 2 spent healing surges.' },
    meditate: { name: 'Pray and meditate', icon: '🕯', text: 'Every hero regains all their spent daily powers.' },
    scavenge: { name: 'Forage and tinker', icon: '🎒', text: 'Every hero with room in their pack finds a consumable.' },
    vigil: { name: 'Hold a vigil for the fallen', icon: '🪦', text: 'Call one fallen hero back to the fire. They return at half HP with no daily powers, and the grave\'s chill clings to them (Bone-Weary: −1 healing surge).', need: (run) => run.heroes.some(h => h.dead) },
  };
  function restAt(run, opt, rand = Math.random) {
    if (!run.rest || run.rest.done) return null;
    const out = [];
    if (opt === 'recover') for (const h of living(run)) { h.damage = 0; h.surgesSpent = Math.max(0, h.surgesSpent - 2); }
    if (opt === 'meditate') for (const h of living(run)) h.daily = [];
    if (opt === 'vigil') {
      const h = run.heroes.find(x => x.dead); if (!h) return null;
      h.dead = false; h.fellAt = null; h.surgesSpent = 0;
      if (!h.boons.includes('c_weary')) h.boons.push('c_weary');
      const u = unitOf(run, h); h.damage = Math.floor(u.maxHp / 2); h.daily = u.powers.filter(p => p.kind === 'daily').map(p => p.id);
      out.push({ raised: run.heroes.indexOf(h) });
    }
    if (opt === 'scavenge') for (const h of living(run)) if (h.pack.length < PACK_MAX) { const id = randomItem(rand); h.pack.push(id); out.push({ item: id, hero: run.heroes.indexOf(h) }); }
    run.rest.done = opt; run.rest.found = out;
    return out;
  }

  // ---------- treasure ----------
  function openChest(run, careful, rand = Math.random) {
    if (!run.treasure || run.treasure.opened) return null;
    const n = nodeOf(run, run.node), r = rng(n.seed + 3);
    const res = { gold: 20 + Math.floor(r() * 20) + run.act * 10, gear: rollGear(r, ACTS[run.act].gearTier, null, ownedGear(run)) };
    if (careful) {
      res.check = skillCheck(run, 'thievery', 'easy', rand);
      if (!res.check.ok) { res.trap = 2 + Math.floor(rand() * 6) + Math.floor(rand() * 6) + run.act * 2; hurtHero(run, run.heroes[res.check.hero], res.trap); }
    } else { res.trap = 4 + Math.floor(rand() * 6) + run.act * 2; const h = living(run).sort((a, b) => status(run, b).hp - status(run, a).hp)[0]; res.hero = run.heroes.indexOf(h); hurtHero(run, h, res.trap); }
    run.gold += res.gold; run.stash.push(res.gear); autoEquip(run, res.gear);
    run.treasure.opened = res;
    return res;
  }

  // ---------- skill checks and event outcomes ----------
  function skillBonus(run, h, skill) {
    const u = unitOf(run, h), S = G.Skills[skill];
    let b = G.Engine.mod(u.abil[S.abil]) + Math.floor(run.level / 2);
    if ((G.SkillTraining[h.build.cls] || []).includes(skill)) b += 5;
    if ((G.SkillAncestry[h.build.ancestry] || []).includes(skill)) b += 2;
    return b;
  }
  function bestFor(run, skill) {
    let best = null;
    run.heroes.forEach((h, i) => { if (h.dead) return; const b = skillBonus(run, h, skill); if (!best || b > best.bonus) best = { hero: i, bonus: b }; });
    return best;
  }
  const dcOf = (run, dc) => (G.SkillDC[dc] || 15) + Math.floor(run.level / 2);
  function checkOdds(run, skill, dc) { const b = bestFor(run, skill), t = dcOf(run, dc); return Object.assign({}, b, { dc: t, chance: Math.max(0.05, Math.min(0.95, (21 - (t - b.bonus)) / 20)) }); }
  function skillCheck(run, skill, dc, rand = Math.random) {
    const b = bestFor(run, skill), t = dcOf(run, dc), roll = 1 + Math.floor(rand() * 20);
    return { skill, hero: b.hero, bonus: b.bonus, roll, total: roll + b.bonus, dc: t, ok: roll === 20 || (roll !== 1 && roll + b.bonus >= t) };
  }
  function hurtHero(run, h, amt) { const s = status(run, h); h.damage = Math.min(s.maxHp - 1, h.damage + amt); }
  function removeCurses(run) {
    let n = 0;
    for (const h of run.heroes) { const before = h.boons.length; h.boons = h.boons.filter(b => !(G.Boons[b] && G.Boons[b].curse)); n += before - h.boons.length; clampHero(run, h); }
    return n;
  }
  function whoOf(run, who, ctx, rand) {
    const hs = living(run);
    if (who === 'all') return hs;
    if (who === 'checker' && ctx.hero != null && !run.heroes[ctx.hero].dead) return [run.heroes[ctx.hero]];
    if (who === 'undrilled') { const c = hs.filter(h => !h.boons.includes('b_drilled')); return c.length ? [c[Math.floor(rand() * c.length)]] : []; }
    return hs.length ? [hs[Math.floor(rand() * hs.length)]] : [];
  }
  const nameOf = (h) => h.build.name;
  // apply an outcome; returns lines describing what changed
  function applyOutcome(run, out, ctx = {}, rand = Math.random) {
    const lines = [];
    if (out.gold) { const g = out.gold < 0 ? -Math.min(run.gold, -out.gold) : out.gold; run.gold += g; if (g) lines.push(`${g > 0 ? '+' : '−'}${Math.abs(g)} gold`); }
    if (out.loseItem) { const hs = living(run).filter(h => h.pack.length); if (hs.length) { const h = hs.sort((a, b) => b.pack.length - a.pack.length)[0]; const id = h.pack.pop(); lines.push(`${nameOf(h)} gives up a ${G.Items[id].name}`); } }
    if (out.item) for (let i = 0; i < out.item; i++) { const f = giveItem(run, randomItem(rand), rand); lines.push(f.hero != null ? `${G.Items[f.item].name} → ${nameOf(run.heroes[f.hero])}` : `${G.Items[f.item].name} (no room: sold for ${f.sold} gold)`); }
    if (out.gear) { const id = rollGear(rand, ACTS[run.act].gearTier, out.gear.slot, ownedGear(run)); run.stash.push(id); const eq = autoEquip(run, id); const who = run.heroes.find(h => Object.values(h.gear).includes(id)); lines.push(`Found ${G.Gear[id].name}${eq && who ? ` (equipped on ${nameOf(who)})` : ' (in the stash)'}`); }
    for (const k of ['boon', 'curse']) if (out[k]) for (const h of whoOf(run, out[k].who, ctx, rand)) { if (!h.boons.includes(out[k].id)) { h.boons.push(out[k].id); clampHero(run, h); } lines.push(`${nameOf(h)}: ${G.Boons[out[k].id].name} (${G.Boons[out[k].id].text})`); }
    if (out.damage) for (const h of whoOf(run, out.damage.who, ctx, rand)) { hurtHero(run, h, out.damage.amt); lines.push(`${nameOf(h)} takes ${out.damage.amt} damage`); }
    if (out.heal) for (const h of whoOf(run, out.heal.who, ctx, rand)) { const s = status(run, h); const amt = out.heal.amt === 'full' ? h.damage : out.heal.amt === 'surge' ? s.surgeValue : out.heal.amt; const got = Math.min(h.damage, amt); h.damage -= got; if (got) lines.push(`${nameOf(h)} heals ${got} HP`); }
    if (out.daily) for (const h of whoOf(run, out.daily.who, ctx, rand)) { if (h.daily.length) lines.push(`${nameOf(h)} regains ${h.daily.length === 1 ? 'a daily power' : h.daily.length + ' daily powers'}`); h.daily = []; }
    if (out.removeCurses) { const n = removeCurses(run); lines.push(n ? `${n === 1 ? 'A curse is' : n + ' curses are'} lifted` : 'No curses to lift'); }
    if (out.xp) { run.xp += out.xp; lines.push(`+${out.xp} XP`); const to = levelFor(run.xp); if (to > run.level) { run.pendingLevel = to; lines.push(`Level ${to} after the next fight!`); } }
    if (out.fight) { const n = nodeOf(run, run.node); run.event.fight = { kind: out.fight.kind, faction: out.fight.faction || pickOf(rng(n.seed + 9), ACTS[run.act].factions), first: !!out.fight.first }; lines.push('A fight!'); }
    return lines;
  }
  // can this event choice be picked right now?
  function choiceOpen(run, c) {
    if (c.cost && c.cost.gold > run.gold) return { ok: false, why: `Needs ${c.cost.gold} gold` };
    if (c.need && !c.need(run)) return { ok: false, why: c.needText || 'Not possible' };
    return { ok: true };
  }
  function resolveChoice(run, k, rand = Math.random) {
    const ev = run.event; if (!ev || ev.result) return null;
    const c = G.Events[ev.id].choices[k];
    if (!c || !choiceOpen(run, c).ok) return null;
    if (c.cost && c.cost.gold) run.gold -= c.cost.gold;
    let out = c.outcome, check = null;
    if (c.check) { check = skillCheck(run, c.check.skill, c.check.dc, rand); out = check.ok ? c.success : c.fail; }
    if (c.luck) { let x = rand(); out = c.luck[c.luck.length - 1].out; for (const l of c.luck) { if (x < l.p) { out = l.out; break; } x -= l.p; } }
    const lines = applyOutcome(run, out, { hero: check ? check.hero : null }, rand);
    ev.result = { choice: k, check, text: out.text, lines, costGold: c.cost && c.cost.gold };
    return ev.result;
  }

  // ---------- end of a run, and the Record of Heroes ----------
  function end(run, outcome) {
    run.outcome = outcome; run.stage = 'over'; run.ended = Date.now();
    const last = run.battles[run.battles.length - 1];
    const totals = run.heroes.reduce((t, h) => { for (const k in h.stats) t[k] = (t[k] || 0) + h.stats[k]; return t; }, {});
    const score = (h) => h.stats.dmg + h.stats.healed * 1.2 + h.stats.kills * 6 + h.stats.crits * 3;
    const mvp = run.heroes.slice().sort((a, b) => score(b) - score(a))[0];
    const rec = {
      id: run.id, started: run.started, ended: run.ended, outcome, difficulty: run.difficulty, partyName: run.partyName, map: 'The Road to Hollowmere',
      level: run.level, won: run.battles.filter(b => b.won).length, total: run.battles.length, act: run.act + 1, acts: ACTS.length,
      actName: ACTS[run.act].name, gold: run.gold,
      reached: last ? last.name : null, rounds: run.battles.reduce((t, b) => t + b.rounds, 0), totals,
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
  function loadRun() { const r = load(RUN_KEY, null); return r && r.v === 2 && !r.outcome ? r : null; }
  function saveRun(run) { save(RUN_KEY, run); }
  function clearRun() { try { const s = store(); if (s) { s.removeItem(RUN_KEY); s.removeItem('hexbound.run.v1'); } } catch (e) { } }
  function records() { return load(REC_KEY, []); }
  function addRecord(rec) { const list = records().filter(r => r.id !== rec.id); list.unshift(rec); save(REC_KEY, list.slice(0, 100)); }
  function clearRecords() { save(REC_KEY, []); }

  G.Campaign = {
    ACTS, NODE_TYPES, REST_OPTIONS, PACK_MAX, XP_LEVELS, MAX_LEVEL, genAct, newRun, available, living, status, unitOf, nextLevelXp, enter,
    battleSetup, fightPreview, recordBattle, makeCamp, takeGear, levelChoices, choose, unfilledChoices, spendSurge, autoRest, breakCamp, leave,
    equip, unequip, autoEquip, movePack, giveItem, buy, sell, sellPrice, itemPrice, gearPrice, restAt, openChest,
    skillBonus, bestFor, checkOdds, skillCheck, choiceOpen, resolveChoice, applyOutcome, removeCurses,
    end, abandon, loadRun, saveRun, clearRun, records, clearRecords, scenOf, nodeOf, mapOf,
  };
})();
if (typeof module !== 'undefined') module.exports = G;
