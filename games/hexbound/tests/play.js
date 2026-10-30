// Scripted human-style play: real mouse clicks on the canvas for move, power targeting and choices.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(400);
  await page.click('[data-go=select]');
  await page.click('[data-scen="0"]');
  await page.waitForTimeout(800);
  await page.click('#btn-begin');
  const waitHero = async () => { for (let k = 0; k < 120; k++) { await page.waitForTimeout(250); const ok = await page.evaluate(() => { const st = document.querySelector('#story-ok'); if (st && st.offsetParent) st.click(); return G.App.B.over || (!!G.App.ui.hero && !G.App.ui.busy); }); if (ok) return true; } return false; };
  const out = '/tmp/shots';
  for (let turn = 0; turn < 6; turn++) {
    if (!await waitHero()) { console.log('timeout waiting for hero'); break; }
    if (await page.evaluate(() => G.App.B.over)) break;
    const info = await page.evaluate(() => { const u = G.App.ui.hero; return { name: u.name, pos: u.pos }; });
    // 1) move toward nearest enemy via a click on a reachable hex
    const tgtHex = await page.evaluate(() => {
      const u = G.App.ui.hero, B = G.App.B, E = G.Engine;
      const r = E.reach(B, u, E.speedOf(u), 'move');
      const foes = E.enemiesOf(B, u);
      let best = null, bd = 99;
      for (const n of r.values()) { if (n.noEnd || n.cost === 0) continue; const d = Math.min(...foes.map(f => G.Hex.dist(f.pos, n.h))); if (d < bd && d >= 1) { bd = d; best = n.h; } }
      return best;
    });
    const clickHex = async (h) => { const p = await page.evaluate((h) => G.Render.hexScreen(h), h); await page.mouse.click(p.x, p.y); };
    if (tgtHex) await clickHex(tgtHex);
    await page.waitForTimeout(600);
    // 2) pick the first usable attack power with a valid target and click the target
    const did = await page.evaluate(async () => {
      const u = G.App.ui.hero; if (!u) return 'no hero';
      const B = G.App.B, E = G.Engine;
      const powers = u.powers.filter(p => !p.passive && p.atk && E.canUse(B, u, p));
      for (const p of powers) {
        if (E.isArea(p)) continue;
        const t = B.units.find(t => !t.dead && t.side === 'enemy' && E.validTarget(B, u, p, t));
        if (t) { document.querySelectorAll('.pow')[u.powers.filter(x => !x.passive).indexOf(p)].click(); return { p: p.name, t: t.name, pos: t.pos }; }
      }
      return null;
    });
    if (did) { await page.waitForTimeout(200); await clickHex(did.pos); }
    console.log('turn', turn, info.name, did ? did.p + ' -> ' + did.t : 'no attack');
    // answer any hex choice by clicking its first hex, any reroll modal by accepting
    for (let k = 0; k < 30; k++) {
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({ choice: !!G.App.ui.choice, modal: !!document.querySelector('.modal [data-r]'), busy: G.App.ui.busy }));
      if (st.modal) { await page.click('.modal [data-r]'); console.log('  rerolled'); continue; }
      if (st.choice) { const lbl = await page.evaluate(() => document.querySelector('#hud-prompt').textContent); console.log('  choice:', lbl.slice(0, 60)); const h = await page.evaluate(() => G.App.ui.choice.hexes[0]); await clickHex(h); continue; }
      if (!st.busy) break;
    }
    if (turn === 1) await page.screenshot({ path: out + '/play.png' });
    await page.evaluate(() => { const b = document.querySelector('#b-end'); if (b && G.App.ui.hero) b.click(); });
  }
  console.log(errs.join('\n') || 'no errors');
  await browser.close();
})();
