// Browser smoke test: plays the opening, fast-forwards through a few sectors, opens every screen and
// takes screenshots at phone and desktop sizes. Fails on any page error.
//   node tests/play.js [outDir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'shots');
require('fs').mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve(__dirname, '../index.html');

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function page(viewport, opts = {}) {
    const p = await browser.newPage({ viewport, deviceScaleFactor: 1, ...opts });
    p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.goto(url);
    await p.waitForTimeout(400);
    return p;
  }
  const shot = (p, name) => p.screenshot({ path: path.join(out, name + '.png') });

  // --- phone: a fresh game
  const p = await page({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await shot(p, '01-intro');
  await p.click('#go');
  await p.waitForTimeout(300);
  await shot(p, '02-wren');
  await p.click('#ok');
  // tap until the scrubber can be patched
  for (let i = 0; i < 40 && await p.evaluate(() => __ds.S.res.scrap < 10); i++) { await p.evaluate(() => __ds.F.tapNearest()); await p.waitForTimeout(120); }
  await shot(p, '03-first-taps');
  await p.click('.tab[data-tab="repairs"]');
  await p.click('[data-act="proj:scrub"]');
  await p.waitForTimeout(300);
  if (await p.isVisible('#ok')) await p.click('#ok');
  await p.click('.tab[data-tab="systems"]');
  await shot(p, '04-systems');
  // fast-forward a bot through the early game
  await p.evaluate(() => {
    const { S, C, D } = __ds;
    for (let m = 0; m < 60 * 40; m++) {
      C.tick(S, 1, []);
      for (let k = 0; k < 2; k++) C.collect(S, 'scrap', 2, 'you');
      for (const pr of D.PROJECTS) C.doProject(S, pr.id, []);
      for (const k of ['reactor', 'scrubber', 'drones', 'fab', 'drill', 'scanner']) { const c = C.upgradeCost(S, k); if (S.mods[k].lv > 0 && Object.keys(c).every(r => c[r] <= S.res[r] * 0.3)) C.buyUpgrade(S, k); }
      for (const ct of [...S.contacts]) C.launchProbe(S, ct.key, []);
    }
  });
  await p.waitForTimeout(500);
  while (await p.isVisible('#ok')) { await p.click('#ok'); await p.waitForTimeout(150); }
  await shot(p, '05-systems-later');
  await p.click('.tab[data-tab="repairs"]'); await p.waitForTimeout(250); await shot(p, '06-repairs');
  await p.click('.tab[data-tab="probes"]'); await p.waitForTimeout(250); await shot(p, '07-probes');
  await p.click('.tab[data-tab="log"]'); await p.waitForTimeout(250); await shot(p, '08-log');
  await p.click('.tab[data-tab="talents"]'); await p.waitForTimeout(400); await shot(p, '09-tree');
  // learn a few talents through the UI
  for (const id of ['s_hands', 's_hands', 'l_breath', 'e_wire', 'g_study', 'g_wren']) { await p.click(`[data-t="${id}"]`); if (await p.isEnabled('#tlearn')) await p.click('#tlearn'); }
  await p.click('[data-t="e_oc"]');
  await shot(p, '10-tree-learned');
  await p.click('#tclose');
  // jump ahead several sectors with a generous cheat, then check the away summary
  await p.evaluate(() => {
    const { S, C, D } = __ds;
    S.relics.push('cat', 'harmonica', 'postcard');
    for (let s = 0; s < 3; s++) {
      for (const pr of D.PROJECTS) { for (const r in pr.cost) S.res[r] += pr.cost[r]; C.doProject(S, pr.id, []); }
      for (let i = 0; i < 3; i++) { const c = C.driveCost(S, i); for (const r in c) S.res[r] += c[r]; C.driveStage(S, []); }
      S.drive.charge = C.chargeNeed(S); C.jump(S, []);
    }
    for (let i = 0; i < 12; i++) { S.level++; }
    S.talents = { e_wire: 1, e_circ: 1, e_oc: 1, g_study: 1, g_rhythm: 1, g_walk: 1, s_hands: 1, s_magnet: 1, s_tractor: 1 };
    __ds.save(); window.__nosave = true;
    const saved = JSON.parse(localStorage.getItem('deepspace.v1')); saved.t = Date.now() - 3 * 3600 * 1000;
    localStorage.setItem('deepspace.v1', JSON.stringify(saved));
  });
  await p.reload(); await p.waitForTimeout(600);
  await shot(p, '11-away');
  while (await p.isVisible('#ok')) { await p.click('#ok'); await p.waitForTimeout(150); }
  await p.click('[data-ab="spacewalk"]'); await p.waitForTimeout(900);
  await shot(p, '12-sector4-spacewalk');
  await p.close();

  // --- desktop
  const d = await page({ width: 1366, height: 800 });
  await d.evaluate(() => { localStorage.clear(); });
  await d.reload(); await d.waitForTimeout(300); await d.click('#go'); await d.click('#ok');
  await d.evaluate(() => { const { S, C, D } = __ds; S.res.scrap = 5000; S.res.alloy = 200; S.res.ice = 100; S.res.data = 50; for (const pr of D.PROJECTS.slice(0, 7)) C.doProject(S, pr.id, []); });
  await d.waitForTimeout(500);
  while (await d.isVisible('#ok')) { await d.click('#ok'); await d.waitForTimeout(150); }
  await shot(d, '13-desktop');
  await d.click('.tab[data-tab="talents"]'); await d.waitForTimeout(400); await shot(d, '14-desktop-tree');
  await d.close();

  // --- small phone, landscape-ish short screen
  const s = await page({ width: 360, height: 640 }, { hasTouch: true, isMobile: true });
  await s.click('#go'); await s.click('#ok');
  await shot(s, '15-small-phone');
  await s.close();

  await browser.close();
  if (errs.length) { console.log(errs.slice(0, 10).join('\n')); process.exit(1); }
  console.log('ok, screenshots in', out);
})();
