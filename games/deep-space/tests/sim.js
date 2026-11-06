// Pacing simulation: a bot plays Deep Space on a casual schedule and reports how long each sector takes.
//   node tests/sim.js [style]   style: casual (default) | keen | idle
// casual: a 25 minute first session, then 10 minutes every 4 waking hours, and 8 hours of sleep.
// keen:   20 minutes every hour while awake.
// idle:   5 minutes every 8 hours.
const C = require('../js/core.js');
const D = require('../js/data.js');

const style = process.argv[2] || 'casual';
const SCHED = {
  casual: { first: 25 * 60, active: 10 * 60, gap: 4 * 3600, perDay: 4 },
  keen: { first: 40 * 60, active: 20 * 60, gap: 3600, perDay: 16 },
  idle: { first: 15 * 60, active: 5 * 60, gap: 8 * 3600, perDay: 2 },
}[style];

const S = C.newState(0);
const PRIORITY = ['s_hands', 'l_breath', 'e_wire', 'g_study', 's_drone', 'g_wren', 'e_thrift', 'e_circ', 'n_signal', 'l_filter', 'l_tank',
  'n_tele', 'n_slot2', 'x_se', 'e_fast', 'e_oc', 's_magnet', 'g_ingen', 'l_watch', 'x_ln', 'e_parts', 'e_cap', 'n_range', 'n_charts',
  'n_star', 'l_green', 'x_el', 'g_rhythm', 'g_walk', 'l_fresh', 's_swarm', 's_spot', 's_tractor', 's_junk', 'e_fusion', 'g_nerve', 'g_vet',
  'n_echo', 'n_slot3', 'l_bio', 'e_red', 'g_tether', 's_lucky', 's_sweep', 'l_calm', 'l_compost', 'n_anom', 'g_keep', 'x_ng', 'x_gs',
  's_cap', 'e_capst', 'l_cap', 'n_cap', 'g_cap'];

function think(ev) {
  for (const id of PRIORITY) while (C.learn(S, id));
  for (const p of D.PROJECTS) C.doProject(S, p.id, ev);
  while (C.driveStage(S, ev));
  C.answerBeacon(S, ev);
  if (C.jumpReady(S)) C.jump(S, ev);
  for (const c of [...S.contacts]) C.launchProbe(S, c.key, ev);
  for (const a of ['overclock', 'spacewalk']) C.useAbility(S, a);
  const r = C.rates(S);
  // spend at most a quarter of what we hold on any one upgrade, so repairs still get saved for
  const order = [];
  if (r.draw > r.gen * 0.9) order.push('reactor');
  if (r.flow.o2 < 0.4) order.push(S.mods.garden.lv > 0 && S.res.ice > 50 ? 'garden' : 'scrubber');
  order.push('drones', 'fab', 'drill', 'scanner', 'reactor', 'garden', 'scrubber');
  for (const k of order) {
    if (S.mods[k].lv <= 0) continue;
    const c = C.upgradeCost(S, k);
    const share = k === 'reactor' || k === 'scrubber' ? 0.6 : 0.25;
    if (Object.keys(c).every(res => c[res] <= S.res[res] * share)) {
      const before = C.rates(S);
      C.buyUpgrade(S, k);
      const after = C.rates(S);
      if (after.draw > after.gen && k !== 'reactor') { /* power shortfall: fix it next think */ }
      void before;
    }
  }
}

// Chunks drift by about every 1.6 s while you are looking. The bot taps most of them.
function tapAround(dt) {
  const b = C.bonuses(S);
  const rate = (1 / 1.6) * Math.max(0.2, 1 + (b.spawn || 0)) * (S.clock < S.ab.spacewalk.until ? 4 : 1) * 0.85;
  const n = Math.floor(rate * dt + Math.random());
  for (let i = 0; i < n; i++) {
    const x = Math.random();
    const relic = 0.02 * (1 + (b.relicChunks || 0));
    const ice = (S.projects.drill ? 0.15 : 0) * (1 + (b.iceChunks || 0) * 0.5);
    const kind = x < relic ? 'relic' : x < relic + ice ? 'ice' : x < relic + ice + (S.projects.scan ? 0.04 : 0) ? 'data' : 'scrap';
    C.collect(S, kind, 1 + Math.floor(Math.random() * 3), 'you');
  }
}

const marks = []; let lastSector = 1; let real = 0; let session = 0; let day = 0;
const log = [];
function play(secs) {
  const step = 2;
  for (let t = 0; t < secs; t += step) {
    const ev = [];
    C.tick(S, step, ev, false); tapAround(step);
    if (t % 6 === 0) think(ev);
    for (const e of ev) if (e.type === 'blackout') log.push(`blackout at ${fmt(real + t)}`);
    if (S.sector !== lastSector) { marks.push({ sector: lastSector, real: real + t, level: S.level }); lastSector = S.sector; }
  }
  real += secs;
}
function away(secs) {
  const before = S.sector;
  C.catchUp(S, secs);
  real += secs;
  if (S.sector !== before) lastSector = S.sector;
}
function fmt(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + String(m).padStart(2, '0') + 'm'; }

const firstAt = [];
play(SCHED.first);
const snap = () => `lvl ${S.level}, sector ${S.sector}, stage ${S.drive.stage}, mods ${D.MOD_ORDER.map(k => k[0] + S.mods[k].lv).join(' ')}, res ${Object.entries(S.res).map(([k, v]) => k + ' ' + Math.round(v)).join(' ')}`;
console.log('after first session:', snap(), 'projects', Object.keys(S.projects).join(','));
while (real < 30 * 86400 && !(S.ended && S.sector > 9)) {
  session++;
  if (session % SCHED.perDay === 0) { away(8 * 3600); day++; }
  else away(SCHED.gap);
  // On waking, the bot thinks before tapping (spends what Wren gathered).
  think([]);
  play(SCHED.active);
  if (process.env.TRACE && real < 4 * 86400) {
    const r = C.rates(S);
    console.log(fmt(real).padEnd(10), 's' + S.sector, 'L' + S.level, 'stage', S.drive.stage, 'charge', Math.round(S.drive.charge) + '/' + Math.round(C.chargeNeed(S)),
      'gen', r.gen.toFixed(0), 'draw', r.draw.toFixed(0), '| /s scrap', r.flow.scrap.toFixed(1), 'alloy', r.flow.alloy.toFixed(2), 'ice', r.flow.ice.toFixed(2), 'data', r.flow.data.toFixed(2));
  }
  if (S.ended && !firstAt.ended) { firstAt.ended = real; console.log('ending reached at', fmt(real)); }
  if (session % SCHED.perDay === 0) console.log(`day ${day}: ${snap()}`);
}
console.log('\nsector  finished at      level');
for (const m of marks) console.log(String(m.sector).padEnd(8), fmt(m.real).padEnd(16), m.level);
console.log('\nrelics:', S.relics.join(', '), '| probes:', S.stats.probes, '| blackouts:', S.stats.blackouts, '| talents spent:', C.pointsSpent(S), 'free:', C.pointsFree(S));
console.log(log.slice(0, 5).join('\n'));
