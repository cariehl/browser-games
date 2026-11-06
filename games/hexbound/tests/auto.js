// Full UI autoplay: AI plays both sides through the real render/fx pipeline. Reports JS errors.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(500);
  const out = process.argv[2] || '/tmp/shots';
  for (const i of (process.argv[3] || '0,1,2,3').split(',').map(Number)) {
    await page.evaluate((i) => { G.Settings.speed = 25; G.Settings.autoHeroes = true; G.App.startBattle(G.Scenarios[i], G.Store.load()[+(new URLSearchParams(location.search).get('p') || 0)]); G.App.beginBattle(); }, i);
    const t0 = Date.now();
    let res;
    while (Date.now() - t0 < 240000) { await page.waitForTimeout(1000); res = await page.evaluate(() => ({ over: G.App.B.over, round: G.App.B.round })); if (res.over) break; if (Math.random() < 0.06) console.log('  ...round', res.round); }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out + `/auto${i}.png` });
    console.log('scenario', i, JSON.stringify(res), Math.round((Date.now() - t0) / 1000) + 's');
    await page.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => m.remove()));
  }
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await browser.close();
})();
