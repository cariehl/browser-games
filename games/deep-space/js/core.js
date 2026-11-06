// Deep Space: the simulation. No DOM in here, so tests/sim.js can run it under Node.
// Time is the game clock S.clock, in seconds, which also advances while you are away.
(function (root) {
'use strict';
const D = (typeof module === 'object' && module.exports) ? require('./data.js') : root.DSData;
const { MODS, MOD_ORDER, TALENT_BY_ID, TALENTS, BRANCHES, TIER_GATE, RELICS, CONTACTS } = D;

const RES_KEYS = ['o2', 'scrap', 'alloy', 'ice', 'data'];
const BASE_OFFLINE_H = 8;

function newState(now) {
  const mods = {};
  for (const k of MOD_ORDER) mods[k] = { lv: k === 'reactor' ? 1 : 0, on: true };
  return {
    v: 1, t: now || Date.now(), clock: 0, sector: 1, jumps: 0,
    res: { o2: 80, scrap: 0, alloy: 0, ice: 0, data: 0 },
    mods, projects: {}, drive: { stage: 0, charge: 0 }, beacon: false, ended: false,
    xp: 0, level: 1, bonusTP: 0, talents: {}, relics: [],
    probes: [], contacts: [], contactT: 45, contactN: 0,
    ab: { overclock: { until: 0, ready: 0 }, spacewalk: { until: 0, ready: 0 } },
    combo: { n: 0, t: -9 },
    log: [], unread: 0, wrenOff: [], powerWait: [], shedT: 0,
    stats: { taps: 0, blackouts: 0, made: { scrap: 0, alloy: 0, ice: 0, data: 0, o2: 0 }, relicChunks: 0, probes: 0, playSecs: 0 },
    settings: { sound: true, buyMax: false },
  };
}

// ---------- derived numbers ----------
function sectorInfo(s) {
  if (s <= D.FINAL_SECTOR) return D.SECTORS[s];
  const m = D.BEYOND_MODS[(s * 7) % D.BEYOND_MODS.length];
  const hueSeed = s * 47;
  return { name: D.BEYOND_NAMES[(s - 8) % D.BEYOND_NAMES.length] + (s >= 18 ? ' ' + (Math.floor((s - 8) / 10) + 1) : ''),
    sub: 'Sector ' + s + ', past the edge of the charts', mod: m.mod, note: m.note,
    hue: [80 + (hueSeed % 120), 70 + ((hueSeed * 3) % 90), 140 + ((hueSeed * 7) % 100)] };
}

function bonuses(S) {
  const b = {};
  const add = (fx, n) => { for (const k in fx) b[k] = (b[k] || 0) + fx[k] * n; };
  for (const id in S.talents) { const t = TALENT_BY_ID[id]; if (t && S.talents[id] > 0) add(t.fx, S.talents[id]); }
  for (const id of S.relics) { const r = RELICS.find(x => x.id === id); if (r) add(r.fx, 1); }
  for (const p of D.PROJECTS) if (S.projects[p.id] && p.fx) add(p.fx, 1);
  const sec = sectorInfo(S.sector); if (sec.mod) add(sec.mod, 1);
  return b;
}

const lvEff = (lv, free) => { if (lv <= 0) return 0; const L = lv + (free || 0); return L * Math.pow(2, Math.floor(L / 10)); };

// All the per-second numbers the UI shows and the tick uses.
function rates(S, b) {
  b = b || bonuses(S);
  const y = D.sectorYield(S.sector);
  const free = b.freeLv || 0;
  const oc = S.clock < S.ab.overclock.until;
  const tank = 100 + (b.tank || 0);
  const fresh = S.res.o2 > tank * 0.8 ? (b.fresh || 0) : 0;
  const all = (1 + (b.allMult || 0) + (b.perJump || 0) * S.jumps + fresh) * (1 + (b.allX || 0)) * y;
  const M = S.mods;
  const on = k => M[k].lv > 0 && M[k].on;
  let gen = D.reactorGen(M.reactor.lv + free) * Math.pow(2, Math.floor((M.reactor.lv + free) / 10));
  gen *= (1 + (b.reactorMult || 0)) * (1 + (b.reactorX || 0)) * (oc ? 2 : 1);
  if (M.garden.lv > 0 && M.garden.on) gen += (b.gardenPower || 0) * M.garden.lv;
  const drawMul = Math.max(0.2, 1 + (b.draw || 0));
  const drawOf = k => k === 'reactor' || M[k].lv <= 0 ? 0 : MODS[k].draw * M[k].lv * drawMul * (k === 'drones' ? Math.max(0.2, 1 + (b.droneDraw || 0)) : 1);
  const draws = {}; let draw = 0;
  for (const k of MOD_ORDER) { draws[k] = drawOf(k); if (on(k)) draw += draws[k]; }
  const pe = draw > 0 ? Math.min(1, gen / draw) : 1;
  const scrapM = (1 + (b.scrapMult || 0)) * (1 + (b.scrapX || 0));
  // full-power output of each system, before power shortfalls and inputs
  const raw = {
    scrubber: MODS.scrubber.out * lvEff(M.scrubber.lv, free) * (1 + (b.scrubMult || 0)),
    drones: MODS.drones.out * lvEff(M.drones.lv, free) * (1 + (b.droneMult || 0)) * scrapM * all,
    fab: MODS.fab.out * lvEff(M.fab.lv, free) * (1 + (b.fabMult || 0)) * all,
    drill: MODS.drill.out * lvEff(M.drill.lv, free) * (1 + (b.iceMult || 0)) * all,
    garden: MODS.garden.out * lvEff(M.garden.lv, free) * (1 + (b.gardenMult || 0)),
    scanner: MODS.scanner.out * lvEff(M.scanner.lv, free) * (1 + (b.dataMult || 0)) * all,
  };
  const fabRatio = 6 * Math.max(0.3, 1 - (b.fabEff || 0));
  const gardenIce = 0.12 * lvEff(M.garden.lv, free) * Math.max(0.2, 1 + (b.gardenIce || 0));
  const breath = Math.max(0.3, 1 + (b.breath || 0));
  const run = k => (on(k) ? pe : 0);
  // net per-second flows at the current power, ignoring whether inputs run out
  const flow = {
    o2: raw.scrubber * run('scrubber') + raw.garden * run('garden') - breath,
    scrap: raw.drones * run('drones') - raw.fab * run('fab') * fabRatio,
    alloy: raw.fab * run('fab'),
    ice: raw.drill * run('drill') - gardenIce * run('garden'),
    data: raw.scanner * run('scanner'),
  };
  return { b, y, all, gen, draw, draws, pe, raw, fabRatio, gardenIce, breath, tank, flow, oc, scrapM, free };
}

// ---------- gains, XP and levels ----------
function gain(S, res, amt, ev, b) {
  if (!(amt > 0)) return;
  S.res[res] += amt;
  if (res !== 'o2') { S.stats.made[res] = (S.stats.made[res] || 0) + amt; addXp(S, amt * D.XP_VALUE[res] / D.sectorYield(S.sector), ev, b); }
}
function xpNeed(S, b) { return D.xpToNext(S.level) * Math.max(0.3, 1 + ((b || bonuses(S)).levelCost || 0)); }
function addXp(S, base, ev, b) {
  b = b || bonuses(S);
  S.xp += base * (1 + (b.xpMult || 0));
  let need = xpNeed(S, b);
  while (S.xp >= need) {
    S.xp -= need; S.level++;
    ev && ev.push({ type: 'level', level: S.level });
    if (S.level === 2) addLog(S, 'level', ev);
    need = xpNeed(S, b);
  }
}
function addLog(S, id, ev) {
  if (S.log.includes(id) || !D.LOG[id]) return;
  S.log.push(id); S.unread++;
  ev && ev.push({ type: 'log', id });
}

// ---------- talents ----------
function pointsTotal(S, b) { return S.level - 1 + S.bonusTP + ((b || bonuses(S)).tp || 0); }
function pointsSpent(S) { let n = 0; for (const id in S.talents) n += S.talents[id] * TALENT_BY_ID[id].cost; return n; }
function pointsFree(S) { return pointsTotal(S) - pointsSpent(S); }
function spentInBranch(S, bi) {
  let n = 0;
  for (const id in S.talents) { const t = TALENT_BY_ID[id]; if (t.b === bi) n += S.talents[id] * t.cost; }
  return n;
}
// Why a talent can't be learned yet, or '' if it can.
function learnBlock(S, id) {
  const t = TALENT_BY_ID[id]; const r = S.talents[id] || 0;
  if (r >= t.max) return 'Fully learned';
  const missing = t.req.filter(q => !(S.talents[q] > 0));
  if (missing.length) return 'Needs ' + missing.map(q => TALENT_BY_ID[q].name).join(' and ');
  if (!Array.isArray(t.b)) {
    const gate = TIER_GATE[Math.floor(t.t)] || 0;
    const sp = spentInBranch(S, t.b);
    if (sp < gate) return `Spend ${gate - sp} more point${gate - sp > 1 ? 's' : ''} in ${BRANCHES[t.b].name}`;
  }
  if (pointsFree(S) < t.cost) return t.cost > 1 ? `Costs ${t.cost} points` : 'No talent points left';
  return '';
}
function learn(S, id) {
  if (learnBlock(S, id)) return false;
  S.talents[id] = (S.talents[id] || 0) + 1;
  return true;
}
function respec(S) { S.talents = {}; }

// ---------- systems and repairs ----------
function upgradeCost(S, k, lv, b) {
  b = b || bonuses(S);
  const m = Math.max(0.3, 1 + (b.costMult || 0));
  const c = MODS[k].cost(lv == null ? S.mods[k].lv : lv);
  for (const r in c) c[r] = Math.ceil(c[r] * m);
  return c;
}
const canPay = (S, c) => Object.keys(c).every(r => S.res[r] >= c[r] - 1e-9);
const pay = (S, c) => { for (const r in c) S.res[r] = Math.max(0, S.res[r] - c[r]); };
function buyUpgrade(S, k, max) {
  const m = S.mods[k]; if (!m || m.lv <= 0) return 0;
  const b = bonuses(S); let n = 0;
  do {
    const c = upgradeCost(S, k, null, b);
    if (!canPay(S, c)) break;
    pay(S, c); m.lv++; n++;
  } while (max && n < 500);
  return n;
}
function toggle(S, k) {
  const m = S.mods[k]; if (!m || m.lv <= 0 || k === 'reactor') return;
  m.on = !m.on; S.wrenOff = S.wrenOff.filter(x => x !== k); S.powerWait = (S.powerWait || []).filter(x => x !== k);
}
function projectAvailable(S, p) { return !S.projects[p.id] && S.sector >= p.sector && (!p.req || S.projects[p.req]); }
function doProject(S, id, ev) {
  const p = D.PROJECTS.find(x => x.id === id);
  if (!p || !projectAvailable(S, p) || !canPay(S, p.cost)) return false;
  pay(S, p.cost); S.projects[id] = true;
  if (p.unlock) { S.mods[p.unlock].lv = Math.max(1, S.mods[p.unlock].lv); S.mods[p.unlock].on = true; }
  addXp(S, 30 * Math.pow(1.6, D.PROJECTS.indexOf(p)), ev);
  addLog(S, id, ev);
  if (id === 'probe') S.contactT = 3;
  ev && ev.push({ type: 'project', id });
  return true;
}

// ---------- the jump drive ----------
function driveActive(S) { return S.projects.scan && !(S.sector === D.FINAL_SECTOR && !S.ended); }
function driveCost(S, i, b) {
  b = b || bonuses(S);
  const m = Math.pow(D.DRIVE_GROWTH, S.sector - 1) * Math.max(0.3, 1 + (b.driveCost || 0));
  const c = { ...D.DRIVE_STAGES[i].cost };
  for (const r in c) c[r] = Math.ceil(c[r] * m);
  return c;
}
function chargeNeed(S) { return D.CHARGE_BASE * Math.pow(D.CHARGE_GROWTH, S.sector - 1); }
function driveStage(S, ev) {
  if (!driveActive(S) || S.drive.stage >= D.DRIVE_STAGES.length) return false;
  const c = driveCost(S, S.drive.stage);
  if (!canPay(S, c)) return false;
  pay(S, c); S.drive.stage++;
  addXp(S, 60 * Math.pow(1.5, S.sector) , ev);
  if (S.drive.stage === D.DRIVE_STAGES.length) addLog(S, 'jumpready', ev);
  return true;
}
function jumpReady(S) { return driveActive(S) && S.drive.stage >= D.DRIVE_STAGES.length && S.drive.charge >= chargeNeed(S); }
function beaconCost(S) { return { ...D.BEACON.cost }; }
function answerBeacon(S, ev) {
  if (S.sector !== D.FINAL_SECTOR || S.ended || !canPay(S, D.BEACON.cost)) return false;
  pay(S, D.BEACON.cost); S.ended = true; S.beacon = true;
  addLog(S, 'ending', ev); ev && ev.push({ type: 'ending' });
  return true;
}
function jump(S, ev) {
  if (!jumpReady(S)) return false;
  const b = bonuses(S);
  S.sector++; S.jumps++;
  S.bonusTP += D.JUMP_TP + (b.jumpTP || 0);
  S.powerWait = [];
  for (const k of MOD_ORDER) {
    const m = S.mods[k]; if (m.lv <= 0) continue;
    m.lv = b.keepLv ? Math.max(1, Math.floor(m.lv / 3)) : 1;
    // The jump leaves the reactor weak: air and drones come straight back, and Wren
    // switches the rest on as soon as the reactor can carry them.
    m.on = b.keepLv || ['reactor', 'scrubber', 'garden', 'drones'].includes(k);
    if (!m.on) S.powerWait.push(k);
  }
  const tank = 100 + (bonuses(S).tank || 0);
  S.res = { o2: tank, scrap: 0, alloy: 0, ice: 0, data: 0 };
  S.drive = { stage: 0, charge: 0 };
  S.contacts = []; S.contactT = 30; S.wrenOff = [];
  S.ab.overclock.until = 0; S.ab.spacewalk.until = 0;
  addLog(S, S.sector <= D.FINAL_SECTOR ? 's' + S.sector : 'beyond', ev);
  ev && ev.push({ type: 'jump', sector: S.sector });
  return true;
}

// ---------- abilities ----------
function abilityInfo(S, id, b) {
  b = b || bonuses(S);
  const A = D.ABILITIES[id];
  const has = (b[A.needs] || 0) > 0;
  const cdMul = Math.max(0.3, 1 + (b.abilityCd || 0));
  return { has, dur: A.dur + (b[A.durKey] || 0), cd: A.cd * cdMul, active: S.clock < S.ab[id].until, ready: S.clock >= S.ab[id].ready,
    left: Math.max(0, S.ab[id].until - S.clock), wait: Math.max(0, S.ab[id].ready - S.clock) };
}
function useAbility(S, id) {
  const a = abilityInfo(S, id);
  if (!a.has || !a.ready) return false;
  S.ab[id].until = S.clock + a.dur; S.ab[id].ready = S.clock + a.cd;
  return true;
}

// ---------- chunks you tap ----------
// kind: scrap | ice | data | relic. size 1..3. who: 'you' | 'wren' | 'drone'.
function chunkValue(S, kind, size, r) {
  r = r || rates(S);
  const b = r.b;
  const tap = (1 + (b.tap || 0));
  if (kind === 'ice') return { res: 'ice', amt: (size * 1.2 * r.y + r.raw.drill * 2) * tap * (1 + (b.iceMult || 0) * 0.5) };
  if (kind === 'data') return { res: 'data', amt: (size * 0.6 * r.y + r.raw.scanner * 25) * tap };
  const base = (size * 2 * r.y * r.scrapM + r.raw.drones * 1.4) * tap;
  return { res: 'scrap', amt: kind === 'relic' ? base * 12 : base };
}
function collect(S, kind, size, who, ev) {
  const r = rates(S); const b = r.b;
  const v = chunkValue(S, kind, size, r);
  const personal = who === 'you' || (who === 'wren' && b.wrenFull);
  let mult = 1, crit = false;
  if (personal) {
    if (S.clock - S.combo.t < 1.2) S.combo.n++; else S.combo.n = 1;
    S.combo.t = S.clock;
    if (b.combo) mult *= 1 + b.combo * Math.min(1, (S.combo.n - 1) / 10);
    if (b.crit && Math.random() < b.crit) { mult *= 5; crit = true; }
  }
  if (who === 'you' && S.clock < S.ab.spacewalk.until) mult *= 2;
  if (who === 'you') S.stats.taps++;
  if (kind === 'relic') { S.stats.relicChunks++; addXp(S, 20, ev, b); }
  const amt = v.amt * mult;
  gain(S, v.res, amt, ev, b);
  return { res: v.res, amt, crit, combo: personal ? S.combo.n : 0 };
}

// ---------- probes ----------
function probeSlots(S, b) { return 1 + ((b || bonuses(S)).slots || 0); }
function contactCost(S, c) { return Math.ceil(c.cost * Math.pow(D.sectorYield(S.sector), 0.85)); }
function probeDuration(S, c, b) { return c.mins * 60 * Math.max(0.3, 1 - ((b || bonuses(S)).probeSpeed || 0)); }
function spawnContact(S, b) {
  const rare = 1 + (b.rare || 0);
  // The very first contact is always something quick, so the first probe comes back while you are still here.
  const pool = S.contactN === 0 ? [CONTACTS[0]] : CONTACTS;
  const tot = pool.reduce((s, c) => s + c.w * (c.rare ? rare : 1), 0);
  let x = Math.random() * tot, pick = pool[0];
  for (const c of pool) { x -= c.w * (c.rare ? rare : 1); if (x <= 0) { pick = c; break; } }
  S.contactN++;
  S.contacts.push({ key: S.contactN, id: pick.id });
}
function launchProbe(S, key, ev) {
  const i = S.contacts.findIndex(c => c.key === key);
  if (i < 0 || S.probes.length >= probeSlots(S)) return false;
  const c = CONTACTS.find(x => x.id === S.contacts[i].id);
  const cost = contactCost(S, c);
  if (S.res.data < cost) return false;
  const r = rates(S);
  const mult = (1 + (r.b.probeReward || 0)) * (Math.random() < (r.b.probeDouble || 0) ? 2 : 1);
  const loot = {};
  for (const res in c.rewards) {
    const flow = { scrap: r.raw.drones, alloy: r.raw.fab, ice: r.raw.drill, data: r.raw.scanner }[res] || 0;
    loot[res] = (flow * 60 * c.rewards[res] + c.rewards[res] * 3 * r.y) * mult;
  }
  S.res.data -= cost;
  S.contacts.splice(i, 1);
  S.probes.push({ id: c.id, ends: S.clock + probeDuration(S, c, r.b), dur: probeDuration(S, c, r.b), loot, doubled: mult > 1 + (r.b.probeReward || 0) + 1e-9 });
  ev && ev.push({ type: 'launch', id: c.id });
  return true;
}
function landProbe(S, p, ev, b) {
  const c = CONTACTS.find(x => x.id === p.id);
  for (const res in p.loot) gain(S, res, p.loot[res], ev, b);
  addXp(S, c.mins * 2, ev, b);
  S.stats.probes++;
  let relic = null;
  const left = RELICS.filter(x => !S.relics.includes(x.id));
  if (left.length) {
    if (!S.relics.includes('cat') && c.rare && S.sector >= 2) relic = RELICS[0];
    else {
      const chance = (c.relic || (S.sector >= 2 ? 0.03 : 0)) * (1 + (b.relicFind || 0));
      if (Math.random() < chance) relic = left.filter(x => x.id !== 'cat')[Math.floor(Math.random() * left.filter(x => x.id !== 'cat').length)] || null;
    }
  }
  if (relic) {
    S.relics.push(relic.id);
    addLog(S, relic.id === 'cat' ? 'cat' : 'relic', ev);
  }
  ev && ev.push({ type: 'probe', id: p.id, loot: p.loot, relic: relic && relic.id, doubled: p.doubled });
}

// ---------- the tick ----------
// Advances the ship by dt seconds. away: true while simulating time you were gone.
function tick(S, dt, ev, away) {
  S.clock += dt;
  if (!away) S.stats.playSecs += dt;
  const r = rates(S); const b = r.b; const M = S.mods;
  const offM = away ? 1 + (b.offlineMult || 0) : 1;
  const on = k => M[k].lv > 0 && M[k].on;
  // producers
  if (on('drones')) gain(S, 'scrap', r.raw.drones * r.pe * dt * offM, ev, b);
  if (on('drill')) gain(S, 'ice', r.raw.drill * r.pe * dt * offM, ev, b);
  if (on('scanner')) gain(S, 'data', r.raw.scanner * r.pe * dt * offM, ev, b);
  // converters only run on what they have
  if (on('fab')) {
    const want = r.raw.fab * r.pe * dt * offM;
    const made = Math.min(want, S.res.scrap / r.fabRatio);
    if (made > 0) { S.res.scrap -= made * r.fabRatio; gain(S, 'alloy', made, ev, b); }
  }
  let o2in = 0;
  if (on('scrubber')) o2in += r.raw.scrubber * r.pe * dt;
  if (on('garden')) {
    const need = r.gardenIce * r.pe * dt;
    const f = need > 0 ? Math.min(1, S.res.ice / need) : 1;
    S.res.ice = Math.max(0, S.res.ice - need * f);
    o2in += r.raw.garden * r.pe * dt * f;
  }
  S.res.o2 = Math.min(r.tank, S.res.o2 + o2in - r.breath * dt);
  // Wren's safety protocol: shed load when the air runs low, restore it when it recovers.
  S.shedT -= dt;
  if (S.shedT <= 0) {
    if (S.res.o2 < r.tank * 0.25 && r.flow.o2 < 0) {
      const k = D.SHED_ORDER.find(x => on(x));
      if (k) { M[k].on = false; S.wrenOff.push(k); S.shedT = 4; ev && ev.push({ type: 'shed', mod: k }); }
    } else if (S.res.o2 > r.tank * 0.7 && S.wrenOff.length) {
      const k = S.wrenOff.pop(); if (M[k].lv > 0) { M[k].on = true; S.shedT = 8; ev && ev.push({ type: 'unshed', mod: k }); }
    }
  }
  // after a jump, systems waiting for power come back once the reactor has room for them
  if (S.powerWait && S.powerWait.length && S.res.o2 > r.tank * 0.3) {
    const k = S.powerWait[0];
    if (r.gen - r.draw >= r.draws[k] - 1e-9) { M[k].on = true; S.powerWait.shift(); ev && ev.push({ type: 'powered', mod: k }); }
  }
  if (S.res.o2 <= 0) {
    if (b.noBlackout) S.res.o2 = 0;
    else {
      S.res.o2 = r.tank * 0.3; S.res.scrap *= 0.85; S.stats.blackouts++;
      addLog(S, 'blackout', ev); ev && ev.push({ type: 'blackout' });
    }
  }
  // the jump drive soaks up spare power
  if (driveActive(S) && S.drive.stage >= D.DRIVE_STAGES.length) {
    const need = chargeNeed(S);
    if (S.drive.charge < need) {
      S.drive.charge = Math.min(need, S.drive.charge + Math.max(0, r.gen - r.draw) * dt * (1 + (b.charge || 0)));
      if (S.drive.charge >= need) ev && ev.push({ type: 'charged' });
    }
  }
  // probes
  if (S.projects.probe) {
    S.contactT -= dt * (1 + (b.contactRate || 0));
    if (S.contactT <= 0) {
      S.contactT += D.CONTACT_EVERY;
      if (S.contacts.length < D.MAX_CONTACTS) { spawnContact(S, b); ev && ev.push({ type: 'contact' }); }
    }
    for (let i = S.probes.length - 1; i >= 0; i--) {
      if (S.clock >= S.probes[i].ends) { const p = S.probes.splice(i, 1)[0]; landProbe(S, p, ev, b); }
    }
  }
}

// Catch up on time spent away. Wren runs the ship for a capped number of hours.
function offlineCap(S, b) { b = b || bonuses(S); return (BASE_OFFLINE_H + (b.offlineH || 0)) * 3600; }
function catchUp(S, secs) {
  const cap = offlineCap(S);
  const run = Math.max(0, Math.min(secs, cap));
  const before = { ...S.res }; const lv = S.level; const ev = [];
  let left = run;
  while (left > 0) { const dt = Math.min(left, run > 600 ? 5 : 1); tick(S, dt, ev, true); left -= dt; }
  const gains = {};
  for (const k of RES_KEYS) gains[k] = S.res[k] - before[k];
  if (run >= 600) addLog(S, 'away', ev);
  return { secs, run, capped: secs > cap, gains, levels: S.level - lv, events: ev };
}

const API = {
  newState, sectorInfo, bonuses, rates, gain, addXp, xpNeed, addLog, pointsTotal, pointsSpent, pointsFree, spentInBranch,
  learnBlock, learn, respec, upgradeCost, canPay, buyUpgrade, toggle, projectAvailable, doProject, driveActive, driveCost,
  chargeNeed, driveStage, jumpReady, jump, beaconCost, answerBeacon, abilityInfo, useAbility, chunkValue, collect, probeSlots,
  contactCost, probeDuration, launchProbe, tick, offlineCap, catchUp, RES_KEYS, lvEff,
};
if (typeof module === 'object' && module.exports) module.exports = API;
else root.DSCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
