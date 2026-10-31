// Playwright walk through the campaign: menu → party creation → map → autoplayed fights → camp → end → Record of Heroes.
// Usage: node tests/campaign-ui.js [outDir] [fights]
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
  const out = process.argv[2] || '/tmp/shots'; const fights = +(process.argv[3] || 3);
  require('fs').mkdirSync(out, { recursive: true });
  process.on('unhandledRejection', async (e) => { console.log('FAILED', e.message.split('\n')[0]); console.log(errs.join('\n') || 'no page errors'); await browser.close(); process.exit(1); });
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  await page.click('[data-go=campaign]'); await page.waitForTimeout(400); await shot('c1-create');
  await page.click('[data-act=begin]'); await page.waitForTimeout(300); await shot('c2-begin');
  await page.click('#cp-setout'); await page.waitForTimeout(400); await shot('c3-map');
  for (let f = 0; f < fights; f++) {
    await page.evaluate(() => { G.Settings.speed = 25; G.Settings.autoHeroes = true; });
    await page.evaluate(() => document.querySelector('#cp-fight').click()); await page.waitForTimeout(800);
    if (f === 0) await shot('c4-deploy');
    await page.evaluate(() => G.App.beginBattle());
    const t0 = Date.now(); let res;
    while (Date.now() - t0 < 300000) { await page.waitForTimeout(1000); res = await page.evaluate(() => ({ over: G.App.B.over, round: G.App.B.round })); if (res.over) break; }
    console.log('fight', f + 1, await page.evaluate(() => G.App.B.scen.id), JSON.stringify(res), Math.round((Date.now() - t0) / 1000) + 's');
    await page.waitForSelector('[data-a=camp]', { timeout: 15000 }); await shot(`c5-result${f + 1}`);
    await page.evaluate(() => document.querySelector('[data-a=camp]').click()); await page.waitForTimeout(500);
    if (await page.$('#cp-go')) {
      await shot(`c6-camp${f + 1}`);
      await page.click('#cp-rest'); await page.waitForTimeout(200); await shot(`c7-rested${f + 1}`);
      await page.click('#cp-go'); await page.waitForTimeout(400); await shot(`c8-map${f + 2}`);
    } else { await shot('c9-over'); break; }
  }
  await page.evaluate(() => G.App.menu()); await page.waitForTimeout(300); await shot('c10-menu');
  await page.click('[data-go=record]'); await page.waitForTimeout(300); await shot('c11-record');
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await browser.close();
})();
