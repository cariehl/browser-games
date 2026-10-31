// Playwright walk through a campaign run: menu → party creation → act map → fights, events, merchants, rest sites,
// treasure and camps → Record of Heroes. Usage: node tests/campaign-ui.js [outDir] [steps] [full]. Without `full`,
// each fight autoplays for a few seconds and is then won on the spot (software WebGL is too slow for whole fights).
// One screenshot per kind of screen; reports page errors.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.evaluate(() => { localStorage.clear(); G.App.menu(); });
  await page.waitForTimeout(500);
  const out = process.argv[2] || '/tmp/shots'; const steps = +(process.argv[3] || 14);
  const full = process.argv[4] === 'full';
  require('fs').mkdirSync(out, { recursive: true });
  process.on('unhandledRejection', async (e) => { console.log('FAILED', e.message.split('\n')[0]); console.log(errs.join('\n') || 'no page errors'); await browser.close(); process.exit(1); });
  const shots = new Set();
  const shot = async (n, again) => { if (shots.has(n) && !again) return; shots.add(n); await page.screenshot({ path: `${out}/${n}.png` }); };
  const stage = () => page.evaluate(() => { const r = G.CampaignUI.run; return r ? (r.outcome && !r.camp ? 'over' : r.stage) : 'none'; });
  const click = (sel) => page.evaluate((s) => { const b = document.querySelector(s); if (b && !b.disabled) { b.click(); return true; } return false; }, sel);

  await page.click('[data-go=campaign]'); await page.waitForTimeout(400); await shot('c01-create');
  await page.click('[data-act=begin]'); await page.waitForTimeout(300); await shot('c02-begin');
  await page.click('#cp-setout'); await page.waitForTimeout(400); await shot('c03-map');
  await click('#cp-gear'); await page.waitForTimeout(300); await shot('c04-gear'); await click('.cp-gm [data-close]'); await page.waitForTimeout(200);

  for (let s = 0; s < steps; s++) {
    const st = await stage();
    if (st === 'map') {
      // prefer something we haven't seen yet, so one walk covers every kind of node
      const pick = await page.evaluate((seen) => {
        const r = G.CampaignUI.run; const ids = G.Campaign.available(r);
        const n = ids.map(id => G.Campaign.nodeOf(r, id)).sort((a, b) => (seen.includes(a.type) ? 1 : 0) - (seen.includes(b.type) ? 1 : 0))[0];
        document.querySelector(`[data-node="${n.id}"]`).click(); return n.type;
      }, [...shots].map(x => x.split('-')[1]));
      await page.waitForTimeout(250); await shot('c05-map-' + pick);
      await click('#cp-go'); await page.waitForTimeout(700);
      console.log('step', s + 1, pick);
      continue;
    }
    if (st === 'battle') {
      await page.evaluate(() => { G.Settings.speed = 25; G.Settings.autoHeroes = true; });
      await shot('c06-deploy');
      await page.evaluate(() => G.App.beginBattle());
      const t0 = Date.now(); let res;
      while (Date.now() - t0 < (full ? 600000 : 6000)) { await page.waitForTimeout(1000); res = await page.evaluate(() => ({ over: G.App.B.over, round: G.App.B.round })); if (res.over) break; }
      if (!res.over) res = await page.evaluate(() => { const B = G.App.B; for (const u of B.units) if (u.side === 'enemy') u.dead = true; G.Engine.checkEnd(B); return { over: B.over, round: B.round, forced: true }; });
      console.log('   fight', await page.evaluate(() => G.App.B.scen.name), JSON.stringify(res));
      await page.waitForSelector('[data-a=camp]', { timeout: 15000 }); await shot('c07-result');
      await click('[data-a=camp]'); await page.waitForTimeout(500);
      continue;
    }
    if (st === 'camp') {
      await shot('c08-camp');
      await click('[data-take]'); await page.waitForTimeout(200);
      // fill any feat picks with the first option
      await page.evaluate(() => document.querySelectorAll('[data-feat]').forEach(el => { if (!el.value) { el.value = el.options[1].value; el.onchange(); } }));
      await page.waitForTimeout(200);
      const act = await page.evaluate(() => G.CampaignUI.run.camp && G.CampaignUI.run.camp.actDone);
      if (act) await shot('c09-act-done');
      await click('#cp-rest'); await page.waitForTimeout(200);
      await click('#cp-break'); await page.waitForTimeout(400);
      continue;
    }
    if (st === 'event') {
      await shot('c10-event');
      await click('.cp-choice:not([disabled])'); await page.waitForTimeout(300); await shot('c11-event-result');
      if (!await click('#ev-done')) await click('#ev-fight');
      await page.waitForTimeout(600); continue;
    }
    if (st === 'shop') {
      await shot('c12-shop');
      await page.evaluate(() => { G.CampaignUI.run.gold += 200; G.CampaignUI.shopScreen(); });
      await click('[data-buy^="gear"]'); await page.waitForTimeout(200); await click('[data-buy^="item"]'); await page.waitForTimeout(200);
      await shot('c13-shop-bought');
      await click('#sh-done'); await page.waitForTimeout(300); continue;
    }
    if (st === 'rest') { await shot('c14-rest'); await click('[data-rest]'); await page.waitForTimeout(200); await shot('c15-rest-done'); await click('#rs-done'); await page.waitForTimeout(300); continue; }
    if (st === 'treasure') { await shot('c16-treasure'); await click('#tr-open'); await page.waitForTimeout(200); await shot('c17-treasure-open'); await click('#tr-done'); await page.waitForTimeout(300); continue; }
    if (st === 'over' || st === 'none') { await shot('c18-over'); break; }
  }
  await click('#cp-gear'); await page.waitForTimeout(300); await shot('c19-gear-later'); await click('.cp-gm [data-close]');
  await page.evaluate(() => G.App.menu()); await page.waitForTimeout(300); await shot('c20-menu');
  await click('[data-go=continue]'); await page.waitForTimeout(400); await shot('c21-resumed');
  await page.evaluate(() => G.App.menu()); await page.waitForTimeout(200);
  await page.click('[data-go=record]'); await page.waitForTimeout(300); await shot('c22-record');
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await browser.close();
})();
