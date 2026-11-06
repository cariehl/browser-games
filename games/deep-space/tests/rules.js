// Rules tests for the simulation. Run: node --test tests/rules.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/core.js');
const D = require('../js/data.js');

const fresh = () => C.newState(0);

test('every talent requirement exists, and every branch has one capstone', () => {
  for (const t of D.TALENTS) for (const q of t.req) assert.ok(D.TALENT_BY_ID[q], `${t.id} needs missing ${q}`);
  for (let b = 0; b < D.BRANCHES.length; b++) assert.strictEqual(D.TALENTS.filter(t => t.b === b && t.t === 6).length, 1);
  assert.strictEqual(new Set(D.TALENTS.map(t => t.id)).size, D.TALENTS.length);
});

test('talents need points, their parents, and enough points in the branch', () => {
  const S = fresh();
  assert.match(C.learnBlock(S, 's_hands'), /No talent points/);
  S.level = 10;
  assert.strictEqual(C.learnBlock(S, 's_hands'), '');
  assert.match(C.learnBlock(S, 's_drone'), /Needs Steady Hands/);
  assert.ok(C.learn(S, 's_hands'));
  assert.ok(C.learn(S, 's_drone'));
  assert.match(C.learnBlock(S, 's_swarm'), /Spend 1 more point/);
  C.learn(S, 's_hands');
  assert.strictEqual(C.learnBlock(S, 's_swarm'), '');
  // cross-links need a talent from both sides
  assert.match(C.learnBlock(S, 'x_se'), /Thrifty Fabrication/);
  C.respec(S);
  assert.strictEqual(C.pointsSpent(S), 0);
  assert.strictEqual(C.pointsFree(S), 9);
});

test('power shortfalls slow every powered system down', () => {
  const S = fresh();
  S.res.scrap = 1000; C.doProject(S, 'scrub'); C.doProject(S, 'drones'); C.doProject(S, 'fab');
  let r = C.rates(S);
  assert.ok(r.draw > r.gen, 'reactor level 1 cannot run three systems');
  assert.ok(r.pe < 1);
  C.toggle(S, 'fab');
  r = C.rates(S);
  assert.strictEqual(r.pe, 1);
});

test('Wren switches systems off when the air runs low, and blacking out costs scrap', () => {
  const S = fresh();
  S.res.scrap = 1000; C.doProject(S, 'scrub'); C.doProject(S, 'drones'); C.doProject(S, 'fab');
  S.mods.scrubber.on = false; // the air will fall
  const ev = [];
  for (let i = 0; i < 70 && !S.wrenOff.length; i++) C.tick(S, 1, ev);
  assert.ok(S.wrenOff.length, 'Wren shed some load');
  S.mods.scrubber.lv = 0; S.res.o2 = 0.5; S.res.scrap = 100;
  C.tick(S, 1, ev);
  assert.ok(ev.some(e => e.type === 'blackout'));
  assert.ok(S.res.scrap < 100);
  assert.ok(S.res.o2 > 0);
});

test('jumping keeps talents and repairs and resets materials and levels', () => {
  const S = fresh();
  for (const p of D.PROJECTS.filter(p => p.sector === 1)) { Object.assign(S.res, { scrap: 1e6, alloy: 1e6, ice: 1e6, data: 1e6 }); assert.ok(C.doProject(S, p.id)); }
  S.mods.drones.lv = 12; S.level = 5; C.learn(S, 'g_study');
  for (let i = 0; i < 3; i++) { Object.assign(S.res, { scrap: 1e7, alloy: 1e7, ice: 1e7, data: 1e7 }); assert.ok(C.driveStage(S)); }
  assert.ok(!C.jumpReady(S));
  S.drive.charge = C.chargeNeed(S);
  const ev = [];
  assert.ok(C.jump(S, ev));
  assert.strictEqual(S.sector, 2);
  assert.strictEqual(S.mods.drones.lv, 1);
  assert.strictEqual(S.res.scrap, 0);
  assert.strictEqual(S.talents.g_study, 1);
  assert.ok(S.projects.probe);
  assert.strictEqual(S.bonusTP, D.JUMP_TP);
  assert.ok(ev.some(e => e.type === 'log' && e.id === 's2'));
});

test('time away is capped by Wren\'s watch and Long Watch extends it', () => {
  const S = fresh();
  S.res.scrap = 1000; C.doProject(S, 'scrub'); C.doProject(S, 'drones');
  const sum = C.catchUp(S, 30 * 3600);
  assert.ok(sum.capped);
  assert.strictEqual(sum.run, 8 * 3600);
  assert.ok(sum.gains.scrap > 0);
  S.level = 20; C.learn(S, 'l_breath'); C.learn(S, 'l_breath'); C.learn(S, 'l_tank'); C.learn(S, 'l_watch');
  assert.strictEqual(C.offlineCap(S), 10 * 3600);
});

test('probes land, pay out, and the first rare contact past sector 1 brings Biscuit', () => {
  const S = fresh();
  S.sector = 2; S.projects.scan = S.projects.probe = true; S.mods.scanner.lv = 1; S.res.data = 1000;
  S.contacts.push({ key: 1, id: 'wreck' });
  assert.ok(C.launchProbe(S, 1));
  const ev = [];
  C.catchUp(S, 3 * 3600);
  assert.ok(S.relics.includes('cat'));
  assert.ok(S.stats.probes >= 1);
});

test('the beacon ends the story and reopens the jump drive', () => {
  const S = fresh();
  S.sector = D.FINAL_SECTOR; S.projects.scan = true;
  assert.ok(!C.driveActive(S));
  Object.assign(S.res, D.BEACON.cost);
  const ev = [];
  assert.ok(C.answerBeacon(S, ev));
  assert.ok(S.ended && C.driveActive(S));
  assert.ok(ev.some(e => e.type === 'ending'));
});

test('a long casual game reaches the ending in about a week', () => {
  // A quick version of tests/sim.js: the bot must reach Meridian between 3 and 14 days.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [require('node:path').join(__dirname, 'sim.js'), 'casual'], { encoding: 'utf8' });
  const m = out.match(/ending reached at (?:(\d+)d )?(\d+)h/);
  assert.ok(m, 'the sim reaches the ending');
  const days = (+m[1] || 0) + (+m[2]) / 24;
  assert.ok(days > 3 && days < 14, `ending after ${days.toFixed(1)} days`);
});
