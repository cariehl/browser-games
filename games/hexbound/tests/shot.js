// Playwright smoke test: load the game, open builder, start each battle, screenshot.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(800);
  const out = process.argv[2] || '/tmp/shots';
  require('fs').mkdirSync(out, { recursive: true });
  await page.screenshot({ path: out + '/menu.png' });
  await page.click('[data-go=builder]'); await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/builder.png' });
  await page.click('[data-act=back]'); await page.click('[data-go=select]'); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/select.png' });
  for (const i of (process.argv[3] || '0,1,2').split(',').map(Number)) {
    await page.evaluate((i) => { G.Settings.speed = 4; G.App.startBattle(G.Scenarios[i], G.Store.load()[0]); }, i);
    await page.waitForTimeout(900);
    await page.screenshot({ path: out + `/deploy${i}.png` });
    await page.evaluate(() => G.App.beginBattle());
    for (let k = 0; k < 60; k++) { await page.waitForTimeout(500); if (await page.evaluate(() => !!G.App.ui.hero && !G.App.ui.busy)) break; }
    await page.waitForTimeout(700);
    await page.screenshot({ path: out + `/battle${i}.png` });
  }
  console.log(errs.join('\n') || 'no errors');
  await browser.close();
})();
