// Screens, battle controller and HUD.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const E = () => G.Engine, R = () => G.Render, Hex = G.Hex;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sgn = (n) => (n >= 0 ? '+' : '') + n;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms / (G.Settings.speed || 1)));

  G.Settings = Object.assign({ speed: 1, difficulty: 'normal', autoEndTurn: true }, (() => { try { return JSON.parse(localStorage.getItem('hexbound.settings') || '{}'); } catch (e) { return {}; } })());
  const SPEEDS = [0.5, 1, 2, 3];
  // older saves used 0.75 / 1.5 / 2.5: snap to the nearest current option
  if (!SPEEDS.includes(+G.Settings.speed)) G.Settings.speed = SPEEDS.reduce((a, b) => Math.abs(b - G.Settings.speed) < Math.abs(a - G.Settings.speed) ? b : a, 1);
  const saveSettings = () => { try { localStorage.setItem('hexbound.settings', JSON.stringify(G.Settings)); } catch (e) { } };
  const DIFF = { story: { hp: 0.75, atk: -2, label: 'Story' }, normal: { hp: 1, atk: 0, label: 'Normal' }, hard: { hp: 1.25, atk: 1, label: 'Hard' } };

  // ================= Screens =================
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
    if (id === 'battle') setTimeout(() => R().resize(), 0);
  }

  function menu() {
    show('menu');
    $('#menu').innerHTML = `
      <div class="menu-inner">
        <div class="logo"><span class="hexmark">⬢</span> HEXBOUND <small>Tactics · Combat Prototype</small></div>
        <p class="tag">A party of four. A hex grid. A truly unreasonable amount of pastry.</p>
        <div class="menu-btns">
          <button class="btn big" data-go="select">⚔ Play a Scenario</button>
          <button class="btn big" data-go="builder">✎ Party Builder</button>
          <button class="btn big ghost" data-go="help">? How to Play</button>
        </div>
        <div class="menu-opts">
          <label>Animation speed <select id="opt-speed">${SPEEDS.map(s => `<option value="${s}" ${+G.Settings.speed === s ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>
          <label><input type="checkbox" id="opt-sound" ${G.Audio.muted ? '' : 'checked'}> Sound</label>
        </div>
        <p class="fine">Mechanics inspired by classic tabletop tactics (at-will / encounter / daily powers, four defenses, healing surges, marks). All names, classes and monsters are original to this prototype.</p>
      </div>`;
    $('#menu').querySelectorAll('[data-go]').forEach(b => b.onclick = () => { G.Audio.unlock(); G.Audio.play('click'); go(b.dataset.go); });
    $('#opt-speed').onchange = (e) => { G.Settings.speed = +e.target.value; saveSettings(); };
    $('#opt-sound').onchange = () => G.Audio.toggle();
  }
  function go(where) {
    if (where === 'select') selectScreen();
    else if (where === 'builder') { show('builder'); G.Builder.open($('#builder'), menu); }
    else if (where === 'help') help();
    else menu();
  }

  function selectScreen() {
    show('select');
    const parties = G.Store.load();
    const best = (() => { try { return JSON.parse(localStorage.getItem('hexbound.best') || '{}'); } catch (e) { return {}; } })();
    let pIdx = 0; try { pIdx = Math.min(+(localStorage.getItem('hexbound.lastParty') || 0), parties.length - 1) || 0; } catch (e) { }
    const render = () => {
      $('#select').innerHTML = `
      <div class="sel">
        <header class="pb-head"><button class="btn ghost" id="sel-back">← Menu</button><h2>Choose a Battle</h2></header>
        <div class="sel-opts">
          <label>Party <select id="sel-party">${parties.map((p, i) => `<option value="${i}" ${i === pIdx ? 'selected' : ''}>${esc(p.name)} — ${p.heroes.map(h => G.Build.CLASSES[h.cls].name).join(', ')}</option>`).join('')}</select></label>
          <button class="btn sm" id="sel-edit">Edit parties</button>
          <span class="diff">${Object.entries(DIFF).map(([k, d]) => `<label class="radio ${G.Settings.difficulty === k ? 'on' : ''}"><input type="radio" name="diff" value="${k}" ${G.Settings.difficulty === k ? 'checked' : ''}>${d.label}</label>`).join('')}</span>
        </div>
        <div class="sel-party">${parties[pIdx].heroes.map(h => { const C = G.Build.CLASSES[h.cls]; const bad = G.validateHero(h); return `<div class="mini cls-${h.cls}"><span class="ico">${G.ICON[h.cls]}</span><b>${esc(h.name)}</b><small>${G.Build.ANCESTRIES[h.ancestry].name} ${C.subs[h.sub].name} ${C.name}</small>${bad.length ? `<em class="bad">${esc(bad[0])}</em>` : ''}</div>`; }).join('')}</div>
        <div class="scen-cards">${G.Scenarios.map((s, i) => `
          <div class="scen s-${s.id}">
            <div class="scen-art">${{ goblins: '🌲⚔🌲', bandits: '🔥🪓🛒', golem: '🎂👁👁🎂' }[s.id]}</div>
            <h3>${s.name}</h3><div class="scen-sub">${s.sub}</div>
            <p>${s.blurb}</p>
            <ul>${s.tips.map(t => `<li>${t}</li>`).join('')}</ul>
            ${best[s.id] ? `<div class="best">★ Cleared on ${best[s.id]}</div>` : ''}
            <button class="btn big" data-scen="${i}">Fight</button>
          </div>`).join('')}</div>
      </div>`;
      $('#sel-back').onclick = menu;
      $('#sel-edit').onclick = () => go('builder');
      $('#sel-party').onchange = (e) => { pIdx = +e.target.value; try { localStorage.setItem('hexbound.lastParty', pIdx); } catch (err) { } render(); };
      document.querySelectorAll('input[name=diff]').forEach(r => r.onchange = () => { G.Settings.difficulty = r.value; saveSettings(); render(); });
      document.querySelectorAll('[data-scen]').forEach(b => b.onclick = () => {
        const bad = parties[pIdx].heroes.some(h => G.validateHero(h).length);
        const goFight = () => { G.Audio.play('click'); startBattle(G.Scenarios[+b.dataset.scen], parties[pIdx]); };
        if (bad) G.Dialog.confirm('This party has build problems (see the warnings above). Fight anyway?', 'Fight anyway').then(ok => ok && goFight());
        else goFight();
      });
    };
    render();
  }

  function help() {
    const m = modal(`
      <h2>How to Play</h2>
      <div class="help-cols">
      <div>
      <h4>Your turn</h4>
      <p>Each hero gets a <b>Standard</b>, a <b>Move</b> and a <b>Minor</b> action. You can trade down: a standard can be used as a move or minor, a move as a minor.</p>
      <p><b>Move</b> up to your speed. Leaving a hex next to an enemy provokes an <b>opportunity attack</b> — path previews warn you (⚠). <b>Shift</b> 1 hex to step away safely. <b>Charge</b> moves and makes a basic attack (+1) as a single standard action.</p>
      <h4>Powers</h4>
      <p><span class="k k-atwill">At-Will</span> any time. <span class="k k-encounter">Encounter</span> once per fight. <span class="k k-daily">Daily</span> your big once-per-fight finisher. Attacks roll d20 + bonus against one of four defenses: <b>AC, Fortitude, Reflex, Will</b>.</p>
      <h4>Combat advantage (+2)</h4>
      <p>Flank an enemy (an ally directly opposite you — gold hexes while moving), or hit enemies that are prone, dazed, stunned or exposed. Rogues deal big Sneak Attack damage with it.</p>
      </div><div>
      <h4>Staying alive</h4>
      <p>Heroes have <b>healing surges</b>: Second Wind (once per fight) and leader heals spend one to restore ¼ of max HP. At 0 HP you fall <b>dying</b> and roll death saves; three failures and you're gone. Any heal brings you back.</p>
      <p><b>Action Point</b>: once per fight, take an extra standard action. <b>Momentum</b> (◆) is earned by kills and crits; spend 2 to reroll a missed attack.</p>
      <h4>Enemies</h4>
      <p><b>Minions</b> die to any hit but ignore damage on a miss. <b>Marked</b> creatures take −2 attacking anyone but whoever marked them, and Fighters punish them. Watch for hazards — fire, frosting, exploding barrels — and push enemies into them!</p>
      <h4>Controls</h4>
      <p>Left-click: select / act · Right-click or Esc: cancel · Drag: pan · Right-drag or Q/E: rotate · Wheel: zoom · WASD: pan · 1–9: powers · X: shift · C: charge · Space: end turn</p>
      </div></div>
      <div class="modal-btns"><button class="btn" data-close>Got it</button></div>`);
    return m;
  }
  function modal(html, cls = '') {
    const m = document.createElement('div'); m.className = 'modal-bg';
    m.innerHTML = `<div class="modal ${cls}">${html}</div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.remove());
    m.onclick = (e) => { if (e.target === m && !m.dataset.sticky) m.remove(); };
    return m;
  }

  // ================= Battle =================
  let B = null, scenRef = null, partyRef = null;
  let ui = { mode: null, power: null, hero: null, busy: false, choice: null, hover: null, deploying: false, deploySel: null };
  let logIdx = 0;

  function prepScenario(scen) {
    // fresh copy of events so "done" flags reset between runs
    return Object.assign({}, scen, { events: (scen.events || []).map(e => Object.assign({}, e, { done: false })) });
  }

  function startBattle(scen, party) {
    scenRef = scen; partyRef = party;
    B = E().newBattle(prepScenario(scen), party.heroes);
    const d = DIFF[G.Settings.difficulty] || DIFF.normal;
    for (const u of B.units) if (u.side === 'enemy') {
      if (!u.minion) { u.maxHp = u.hp = Math.round(u.maxHp * d.hp); }
      u.powers = u.powers.map(p => p.atk ? Object.assign({}, p, { atk: Object.assign({}, p.atk, { bonus: (p.atk.bonus || 0) + d.atk }) }) : p);
    }
    B.difficulty = G.Settings.difficulty;
    logIdx = 0; hiddenChips.clear();
    show('battle');
    buildHud();
    R().loadBattle(B);
    ui = { mode: 'deploy', power: null, hero: null, busy: false, choice: null, hover: null, deploySel: null };
    deployPhase();
  }

  function deployTiles() { return (B.spawns && B.spawns.hero) || []; }
  function deployPhase() {
    ui.mode = 'deploy';
    $('#hud-prompt').innerHTML = `<b>Deploy your party.</b> Click a hero, then a green hex to move them. Swap by clicking another hero. <button class="btn sm" id="btn-begin">Begin Battle ▶</button>`;
    $('#hud-prompt').classList.add('on');
    $('#btn-begin').onclick = beginBattle;
    $('#hud-bottom').classList.remove('on');
    story(`${scenRef.name}`, scenRef.intro, { sticky: true });
    refreshDeploy();
    updateHud();
  }
  function refreshDeploy() {
    R().setHighlights({ deploy: deployTiles(), hover: ui.deploySel ? [ui.deploySel.pos] : [] });
    R().setActive(ui.deploySel ? ui.deploySel.uid : null);
  }
  function deployClick(h) {
    if (!h) return;
    const u = E().unitAt(B, h);
    if (u && u.side === 'hero') {
      if (ui.deploySel && ui.deploySel !== u) { const p = ui.deploySel.pos; ui.deploySel.pos = u.pos; u.pos = p; ui.deploySel = null; R().syncAll(); }
      else ui.deploySel = (ui.deploySel === u) ? null : u;
    } else if (ui.deploySel && deployTiles().some(d => Hex.eq(d, h)) && !u) { ui.deploySel.pos = h; ui.deploySel = null; R().syncAll(); }
    G.Audio.play('click');
    refreshDeploy();
  }
  async function beginBattle() {
    $('#hud-prompt').classList.remove('on');
    dismissStory();
    ui.mode = null; R().setHighlights({}); R().setActive(null);
    await run(E().startBattle(B));
    updateHud();
    advance();
  }

  // ---- generator driver ----
  async function run(gen) {
    const myB = B;
    ui.busy = true; updateHud();
    let r = gen.next();
    while (true) {
      await drainFx();
      if (B !== myB) return null; // battle was restarted or abandoned
      if (r.done) { ui.busy = false; return r.value; }
      const ch = r.value;
      let ans;
      if (ch && ch.choice) {
        if (ch.unit && ch.unit.side === 'hero' && !G.Settings.autoHeroes) ans = await askChoice(ch);
        else ans = ch.auto ? ch.auto() : undefined;
      }
      r = gen.next(ans);
    }
  }
  async function drainFx() {
    const myB = B;
    while (B === myB && B.fx.length) {
      const ev = B.fx.shift();
      flushLog();
      try { await R().playFx(ev); } catch (e) { console.error(e); }
      updateHudLight();
    }
    flushLog(); R().syncAll(); updateHud();
  }

  async function advance() {
    const myB = B;
    while (!B.over) {
      const u = await run(E().nextTurn(B));
      if (B !== myB) return;
      if (!u) break;
      if (u.side === 'hero' && !G.Settings.autoHeroes) { startHeroTurn(u); return; }
      updateHud();
      // let the player see whose turn it is before the enemy acts
      await sleep(1000);
      if (B !== myB) return;
      await run(G.AI.takeTurn(B, u));
      await sleep(250);
      await run(E().endTurn(B, u));
      if (B !== myB) return;
    }
    if (B.over) finish();
  }

  function startHeroTurn(u) {
    ui.hero = u; ui.power = null;
    G.Audio.play('turn');
    R().setActive(u.uid); R().focus(u.pos);
    setMode('move');
    updateHud();
  }
  async function endHeroTurn() {
    if (ui.busy || !ui.hero) return;
    const u = ui.hero; ui.hero = null; ui.mode = null; R().setHighlights({}); updateHud();
    await run(E().endTurn(B, u));
    advance();
  }
  async function afterAction() {
    if (B.over) return finish();
    const u = ui.hero;
    if (!u) return;
    if (u.dead || E().isDying(u) || !E().canAct(u)) return endHeroTurn();
    const A = u.act;
    const anything = E().canSpend(u, 'minor') || E().canSpend(u, 'move') || E().canSpend(u, 'standard');
    if (!anything && G.Settings.autoEndTurn) { await sleep(450); return endHeroTurn(); }
    setMode(E().canSpend(u, 'move') && E().speedOf(u) > 0 && !E().hasCond(u, 'prone') ? 'move' : 'idle');
  }

  // ---- modes & highlights ----
  let reachCache = null;
  function setMode(m, power) {
    ui.mode = m; ui.power = power || null; reachCache = null;
    const u = ui.hero;
    if (!u) { R().setHighlights({}); return; }
    const hl = {};
    R().setTargetable(null);
    if (m === 'move' && E().canSpend(u, 'move')) {
      reachCache = E().reach(B, u, E().speedOf(u), 'move');
      hl.reach = [...reachCache.values()].filter(n => !n.noEnd && n.cost > 0).map(n => n.h);
      hl.flank = hl.reach.filter(h => E().enemiesOf(B, u).some(e => !e.object && Hex.dist(e.pos, h) === 1 && E().flanking(B, u, e, h)));
      // dash preview: standard used as a second move isn't auto-computed; show threatened danger
    } else if (m === 'shift') {
      reachCache = E().reach(B, u, 1 + (u.shiftBonus || 0), 'shift');
      hl.shift = [...reachCache.values()].filter(n => !n.noEnd && n.cost > 0).map(n => n.h);
    } else if (m === 'power') {
      const p = power;
      if (E().isArea(p)) {
        if (p.tgt === 'closeBurst') hl.area = E().areaHexes(B, u, p, u.pos);
        else if (p.tgt === 'areaBurst') hl.reach = Hex.within(u.pos, E().powerRange(u, p).range).filter(h => B.tiles.has(Hex.hk(h)) && E().los(B, u.pos, h));
        else hl.dash = Hex.within(u.pos, p.size).filter(h => B.tiles.has(Hex.hk(h)));
      } else if (p.tgt !== 'self') {
        const ts = B.units.filter(t => !t.dead && E().validTarget(B, u, p, t));
        hl[(p.targets || 'enemy') === 'enemy' ? 'target' : 'ally'] = ts.map(t => t.pos);
        R().setTargetable(ts.map(t => t.uid));
      }
    } else if (m === 'charge') {
      const ts = E().chargeOptions(B, u);
      hl.target = ts.map(t => t.pos); R().setTargetable(ts.map(t => t.uid));
    }
    ui.baseHL = hl;
    R().setHighlights(hl);
    updateHud();
    hoverAt(ui.hover);
  }

  function hoverAt(h) {
    ui.hover = h;
    if (ui.mode === 'deploy') return;
    const tip = $('#hud-tip');
    const hl = Object.assign({}, ui.baseHL || {});
    let tipHtml = '';
    const u = ui.hero;
    if (ui.choice) {
      hl.choice = ui.choice.hexes; if (h && ui.choice.hexes.some(x => Hex.eq(x, h))) hl.hover = [h];
    } else if (h && u && !ui.busy) {
      const occ = E().unitAt(B, h);
      if ((ui.mode === 'move' || ui.mode === 'shift') && reachCache) {
        const n = reachCache.get(Hex.hk(h));
        if (n && !n.noEnd && n.cost > 0) {
          hl.path = E().pathFrom(n).slice(1);
          if ((ui.baseHL.flank || []).some(x => Hex.eq(x, h))) tipHtml = '<b class="good">⚔ Flanking position</b> — combat advantage (+2) against the enemy opposite an ally.<br>';
          if (n.prov) { tipHtml += `<b class="warn">⚠ Provokes ${n.prov} opportunity attack${n.prov > 1 ? 's' : ''}</b><br><small>Shift (X) to step away safely.</small>`; hl.danger = E().enemiesOf(B, u).filter(e => n.provBy.includes(e.uid)).map(e => e.pos); }
          const t = E().terr(B, h); if (t && t.hazard) tipHtml += `<br><b class="warn">Hazard: ${t.name}</b>`;
        }
      }
      if (ui.mode === 'power' && ui.power) {
        const p = ui.power;
        if (E().isArea(p)) {
          let aim = h;
          if (p.tgt === 'closeBurst') aim = u.pos;
          if (p.tgt === 'closeBlast' && Hex.dist(u.pos, h) > p.size) aim = null;
          if (p.tgt === 'closeBlast' && aim && Hex.eq(aim, u.pos)) aim = null;
          if (aim) {
            const hexes = E().areaHexes(B, u, p, aim);
            if (hexes.length) {
              hl.area = hexes;
              const ts = E().areaTargets(B, u, p, hexes);
              tipHtml = areaPreview(u, p, ts);
              R().setTargetable(ts.map(t => t.uid));
            }
          }
        } else if (occ && E().validTarget(B, u, p, occ)) {
          hl.hover = [h];
          tipHtml = targetPreview(u, p, occ);
        }
      }
      if (ui.mode === 'charge' && occ && E().chargeOptions(B, u).includes(occ)) { hl.hover = [h]; tipHtml = targetPreview(u, Object.assign({}, u.powers.find(p => p.basicMelee)), occ, { charge: true }); }
      if (!tipHtml && occ) tipHtml = unitTip(occ);
    } else if (h) {
      const occ = E().unitAt(B, h); if (occ) tipHtml = unitTip(occ);
    }
    if (h && !tipHtml) { const t = E().terr(B, h); if (t && (t.hazard || t.difficult || t.block)) tipHtml = `<b>${t.name}</b><br><small>${t.block ? 'Blocks movement' + (t.los ? ' and line of sight' : '') : ''}${t.difficult ? 'Difficult terrain (2 movement)' : ''}${t.hazard ? (t.hazard.dmg ? ` · ${t.hazard.dmg} ${t.hazard.dtype} when entered or starting a turn here` : ` · ${t.hazard.cond} when entered`) : ''}</small>`; }
    if (h) { const tg = B.telegraphs.find(t => Hex.dist(t.center, h) <= t.size); if (tg) tipHtml += `<br><b class="warn">⚠ ${tg.name} lands here next Golem turn!</b>`; }
    R().setHighlights(hl);
    tip.innerHTML = tipHtml; tip.classList.toggle('on', !!tipHtml);
  }
  function dmgRange(u, p, t, ca) {
    const spec = E().damageSpec(B, u, p, t);
    let mn = spec.flat, mx = spec.flat;
    for (const [n, s] of spec.dice) { mn += n; mx += n * s; }
    const extras = [];
    if (ca && u.traits.includes('sneakAttack') && (p.weapon || p.basic) && u.sneakTurn !== B.turnNo) extras.push('+Sneak Attack');
    if (u.traits.includes('quarry') && t.conds.some(c => c.c === 'quarry' && c.src === u.uid) && u.quarryTurn !== B.turnNo) extras.push('+Quarry');
    return { mn, mx, extras };
  }
  function targetPreview(u, p, t, extra = {}) {
    if (!p.atk) {
      return `<b>${esc(p.name)}</b> → ${esc(t.name)}<br><small>${G.Build.describe(p, u).slice(1).map(esc).join('<br>')}</small>`;
    }
    const pr = E().powerRange(u, p);
    const ctx = Object.assign({ melee: pr.kind === 'melee', ranged: pr.kind === 'ranged' }, extra);
    ctx.ca = E().hasCA(B, u, t, ctx);
    const ab = E().attackBonus(B, u, p, t, ctx);
    const dv = t.object ? t.def[p.atk.vs] : E().defense(B, t, p.atk.vs, ctx);
    const need = Math.max(2, Math.min(20, dv - ab.total));
    const chance = Math.round(G.AI.hitChance(B, u, p, t, ctx) * 100);
    const dr = p.dmg ? dmgRange(u, p, t, ctx.ca) : null;
    const provoke = (pr.kind === 'ranged' || pr.kind === 'areaBurst') && !p.noProvoke && E().threatening(B, u).some(e => !e.oaUsed);
    return `<b>${esc(p.name)}</b> → ${esc(t.name)}${t.minion ? ' <i>(minion)</i>' : ''}
      <div class="tp-big ${chance >= 60 ? 'good' : chance >= 40 ? 'ok' : 'bad'}">${chance}% <small>to hit</small></div>
      <small>d20 ${sgn(ab.total)} vs ${p.atk.vs} ${dv} — need ${need}+<br>${ab.parts.map(([k, v]) => `${k} ${sgn(v)}`).join(' · ')}</small>
      ${ctx.ca ? '<div class="good">✔ Combat advantage</div>' : ''}
      ${dr ? `<div>Damage ${dr.mn}–${dr.mx}${p.hits > 1 ? ` ×${p.hits}` : ''} ${dr.extras.join(' ')}${t.minion ? ' <i>(kills)</i>' : ''}</div>` : ''}
      ${provoke ? '<div class="warn">⚠ Provokes opportunity attacks (enemy adjacent)</div>' : ''}
      ${t.object ? `<div class="warn">${esc(G.Monsters[t.id].desc)}</div>` : ''}`;
  }
  function areaPreview(u, p, ts) {
    const foes = ts.filter(t => t.side !== u.side);
    const lines = foes.slice(0, 6).map(t => {
      if (!p.atk) return `${esc(t.name)}`;
      const ctx = { ranged: p.tgt === 'areaBurst', area: true }; ctx.ca = E().hasCA(B, u, t, ctx);
      return `${esc(t.name)}: <b>${Math.round(G.AI.hitChance(B, u, p, t, ctx) * 100)}%</b>${t.minion ? ' (minion)' : ''}${t.object ? ' 💥' : ''}`;
    });
    const allies = ts.filter(t => t.side === u.side);
    return `<b>${esc(p.name)}</b> — ${foes.length ? foes.length + ' target' + (foes.length > 1 ? 's' : '') : (allies.length ? allies.length + ' all' + (allies.length > 1 ? 'ies' : 'y') : 'no targets')}<br><small>${lines.join('<br>')}</small>${p.dmg ? `<div>Damage ${dmgRange(u, p, ts[0] || u).mn}–${dmgRange(u, p, ts[0] || u).mx} each</div>` : ''}`;
  }
  function unitTip(t) {
    const conds = [...new Map(t.conds.map(c => [c.c + (c.label || ''), c])).values()].filter(c => !['dying'].includes(c.c));
    const durTxt = { eont: 'until end of next turn', save: 'save ends', sont: 'until start of next turn', enc: 'rest of fight', eot: 'this turn' };
    if (t.object) return `<b>${esc(t.name)}</b><br><small>${esc(G.Monsters[t.id].desc)}</small>`;
    const role = t.side === 'hero' ? `Level ${t.level} ${G.Build.CLASSES[t.cls].subs[t.sub].name} ${G.Build.CLASSES[t.cls].name}` : `Level ${t.level} ${t.role}${t.title ? ' · ' + t.title : ''}`;
    return `<b>${esc(t.name)}</b> <small>${esc(role)}</small>
      <div>HP ${Math.max(t.hp, t.side === 'hero' ? t.hp : 0)}/${t.maxHp}${t.tempHp ? ` (+${t.tempHp} temp)` : ''}${E().bloodied(t) && t.hp > 0 ? ' <b class="warn">Bloodied</b>' : ''}${t.side === 'hero' ? ` · Surges ${t.surges}` : ''}</div>
      <div class="defs">AC ${E().defense(B, t, 'AC')} · Fort ${E().defense(B, t, 'Fort')} · Ref ${E().defense(B, t, 'Ref')} · Will ${E().defense(B, t, 'Will')} · Speed ${E().speedOf(t)}</div>
      ${conds.length ? `<div class="conds">${conds.map(c => `<span>${esc(c.label || c.c)}${c.amt && !c.label ? ' ' + c.amt : ''} <i>(${durTxt[c.dur] || ''})</i></span>`).join('')}</div>` : ''}
      ${t.monster ? `<div class="mpows">${t.powers.map(p => `<span>${esc(p.name)}${p.recharge ? (t.recharge[p.id] === false ? ' <i>(recharging)</i>' : ` <i>(recharge ${p.recharge}+)</i>`) : ''}</span>`).join(' · ')}</div>${G.Monsters[t.id].desc ? `<small>${esc(G.Monsters[t.id].desc)}</small>` : ''}` : ''}
      ${E().isDying(t) ? `<div class="warn">Dying — death saves failed: ${t.deathFails || 0}/3</div>` : ''}`;
  }

  // ---- clicks ----
  async function onClick(h) {
    if (ui.mode === 'deploy') return deployClick(h);
    if (ui.choice) { if (h && ui.choice.hexes.some(x => Hex.eq(x, h))) { const res = ui.choice.resolve; ui.choice = null; $('#hud-prompt').classList.remove('on'); res(h); } return; }
    const u = ui.hero;
    if (!u || ui.busy || !h) return;
    const occ = E().unitAt(B, h);
    if (ui.mode === 'move' || ui.mode === 'shift') {
      const n = reachCache && reachCache.get(Hex.hk(h));
      if (n && !n.noEnd && n.cost > 0) {
        await run(E().doMove(B, u, h, ui.mode === 'shift' ? 'shift' : 'move'));
        return afterAction();
      }
      return;
    }
    if (ui.mode === 'power' && ui.power) {
      const p = ui.power;
      let aim = null;
      if (E().isArea(p)) {
        let a = p.tgt === 'closeBurst' ? u.pos : h;
        if (p.tgt === 'closeBlast' && (Hex.dist(u.pos, h) > p.size || Hex.eq(h, u.pos))) return;
        if (!E().areaHexes(B, u, p, a).length) return;
        aim = { hex: a };
      } else if (occ && E().validTarget(B, u, p, occ)) aim = { unit: occ };
      if (!aim) return;
      R().setTargetable(null);
      await run(E().usePower(B, u, p, aim));
      return afterAction();
    }
    if (ui.mode === 'charge' && occ && E().chargeOptions(B, u).includes(occ)) {
      R().setTargetable(null);
      await run(E().doCharge(B, u, occ));
      return afterAction();
    }
  }
  function askChoice(ch) {
    return new Promise(resolve => {
      if (ch.choice === 'reroll') {
        const opts = ch.options;
        const m = modal(`<h3>🎲 ${esc(ch.label)}</h3><div class="modal-btns">
          ${opts.includes('elf') ? '<button class="btn" data-r="elf">Reroll — Keen Eye (once per fight)</button>' : ''}
          ${opts.includes('momentum') ? `<button class="btn" data-r="momentum">Reroll — spend 2 Momentum (◆${Math.floor(B.momentum)})</button>` : ''}
          <button class="btn ghost" data-r="">Accept the miss</button></div>`, 'small');
        m.dataset.sticky = 1;
        m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { m.remove(); G.Audio.play('dice'); resolve(b.dataset.r || null); });
        return;
      }
      ui.choice = { hexes: ch.hexes, resolve };
      $('#hud-prompt').innerHTML = `<b>${esc(ch.label)}</b> — click a purple hex. ${ch.optional ? '<button class="btn sm" id="btn-skip">Skip</button>' : ''}`;
      $('#hud-prompt').classList.add('on');
      const sk = $('#btn-skip'); if (sk) sk.onclick = () => { ui.choice = null; $('#hud-prompt').classList.remove('on'); R().setHighlights(ui.baseHL || {}); resolve(null); };
      R().setHighlights({ choice: ch.hexes });
      if (ch.about) R().focus(ch.about.pos);
    });
  }

  // ---- actions from HUD ----
  function selectPower(p) {
    const u = ui.hero; if (!u || ui.busy) return;
    if (!E().canUse(B, u, p)) return;
    G.Audio.play('click');
    if (p.tgt === 'self') { (async () => { await run(E().usePower(B, u, p, {})); afterAction(); })(); return; }
    if (ui.mode === 'power' && ui.power === p) { setMode('move'); return; }
    setMode('power', p);
  }
  async function doSecondWind() { const u = ui.hero; if (!u || ui.busy) return; await run(E().secondWind(B, u)); afterAction(); }
  async function doActionPoint() { const u = ui.hero; if (!u || ui.busy) return; await run(E().actionPoint(B, u)); afterAction(); }
  async function doStand() { const u = ui.hero; if (!u || ui.busy) return; await run(E().doMove(B, u, u.pos)); afterAction(); }

  // ================= HUD =================
  function buildHud() {
    $('#battle-hud').innerHTML = `
      <div id="hud-top">
        <button class="btn sm ghost" id="hud-menu" title="Menu">☰</button>
        <div id="hud-round"></div>
        <div id="hud-init"></div>
        <div id="hud-mom" title="Momentum: earned by kills and critical hits. Spend 2 to reroll a missed attack."></div>
      </div>
      <div id="hud-party"></div>
      <div id="hud-log"><div class="log-h">Combat Log <button class="btn sm ghost" id="log-toggle">–</button></div><div class="log-b"></div></div>
      <div id="hud-bottom"></div>
      <div id="hud-tip"></div>
      <div id="hud-prompt"></div>
      <div id="hud-banner"></div>
      <div id="hud-turn"></div>
      <div id="hud-story"></div>
      <div id="hud-cam"><button class="btn sm ghost" data-cam="l" title="Rotate (Q)">⟲</button><button class="btn sm ghost" data-cam="r" title="Rotate (E)">⟳</button><button class="btn sm ghost" data-cam="i" title="Zoom in">＋</button><button class="btn sm ghost" data-cam="o" title="Zoom out">－</button><button class="btn sm ghost" data-cam="f" title="Focus active">◎</button></div>`;
    $('#hud-menu').onclick = battleMenu;
    $('#log-toggle').onclick = () => $('#hud-log').classList.toggle('min');
    document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => {
      const k = b.dataset.cam;
      if (k === 'l') R().rotate(-Math.PI / 6); if (k === 'r') R().rotate(Math.PI / 6);
      if (k === 'i') R().zoom(0.85); if (k === 'o') R().zoom(1.18);
      if (k === 'f' && (ui.hero || B.active)) R().focus((ui.hero || B.active).pos);
    });
  }
  function battleMenu() {
    const m = modal(`<h3>Paused</h3><div class="modal-btns col">
      <button class="btn" data-a="resume">Resume</button>
      <button class="btn" data-a="help">How to Play</button>
      <button class="btn" data-a="speed">Animation speed: ${G.Settings.speed}×</button>
      <button class="btn" data-a="auto">Auto-end turn: ${G.Settings.autoEndTurn ? 'on' : 'off'}</button>
      <button class="btn" data-a="ai">Autoplay heroes (watch the AI): ${G.Settings.autoHeroes ? 'on' : 'off'}</button>
      <button class="btn" data-a="restart">Restart battle</button>
      <button class="btn danger" data-a="quit">Quit to scenario select</button></div>`, 'small');
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a; m.remove();
      if (a === 'help') help();
      if (a === 'speed') { G.Settings.speed = SPEEDS[(SPEEDS.indexOf(+G.Settings.speed) + 1) % SPEEDS.length]; saveSettings(); battleMenu(); }
      if (a === 'auto') { G.Settings.autoEndTurn = !G.Settings.autoEndTurn; saveSettings(); battleMenu(); }
      if (a === 'ai') { G.Settings.autoHeroes = !G.Settings.autoHeroes; if (G.Settings.autoHeroes && ui.hero && !ui.busy) { const u = ui.hero; ui.hero = null; ui.mode = null; R().setHighlights({}); (async () => { await run(G.AI.takeTurn(B, u)); await run(E().endTurn(B, u)); advance(); })(); } }
      if (a === 'restart') { B.over = B.over || 'quit'; startBattle(scenRef, partyRef); }
      if (a === 'quit') { B.over = B.over || 'quit'; selectScreen(); }
    });
  }

  function flushLog() {
    const box = $('#hud-log .log-b'); if (!box || !B) return;
    let added = false;
    while (logIdx < B.log.length) {
      const l = B.log[logIdx++];
      const d = document.createElement('div'); d.className = 'l ' + (l.cls || ''); d.textContent = l.msg; box.appendChild(d); added = true;
    }
    if (added) { while (box.children.length > 300) box.removeChild(box.firstChild); box.scrollTop = box.scrollHeight; }
  }

  function updateHudLight() { updateParty(); updateTop(); }
  function updateHud() { if (!B) return; updateTop(); updateParty(); updateBottom(); }
  function updateTop() {
    $('#hud-round').innerHTML = B.round ? `Round <b>${B.round}</b>` : 'Deploy';
    renderTracker();
    const m = Math.floor(B.momentum);
    $('#hud-mom').innerHTML = `Momentum <b>${'◆'.repeat(m)}<span>${'◇'.repeat(Math.max(0, 6 - m))}</span></b>`;
  }
  // Turn tracker: rotates so the acting unit is always leftmost, with a marker where the next round begins.
  const chipKey = (e) => e.u.uid + (e.second ? 'b' : '');
  const hiddenChips = new Set();
  function renderTracker() {
    const box = $('#hud-init'); if (!box) return;
    const n = B.order.length, cur = B.order[B.turnIdx];
    const start = Math.max(0, B.turnIdx);
    const chip = (e) => `<span class="ichip ${e.u.side} ${cur === e ? 'cur' : ''} ${E().isDying(e.u) ? 'dying' : ''}" data-uid="${e.u.uid}" data-key="${chipKey(e)}" title="${esc(e.u.name)} · initiative ${Math.round(e.init)}${e.second ? ' (second turn)' : ''}">${e.u.side === 'hero' ? G.ICON[e.u.cls] : monIcon(e.u)}<i>${esc(shortName(e.u.name))}</i>${E().isDying(e.u) ? `<b class="ic-dying">☠${e.u.deathFails || 0}</b>` : ''}</span>`;
    let html = '';
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (k > 0 && i === 0) html += roundMark();
      if (!B.order[i].u.dead) html += chip(B.order[i]);
    }
    if (start === 0 && n) html += roundMark();
    // FLIP: slide chips from where they were to where they now are
    const before = new Map([...box.querySelectorAll('.ichip')].map(c => [c.dataset.key, c.getBoundingClientRect().left]));
    box.innerHTML = html;
    const w = box.clientWidth;
    box.querySelectorAll('.ichip').forEach(c => {
      if (hiddenChips.has(c.dataset.key)) c.style.opacity = 0;
      c.onclick = () => { const u = B.units.find(x => x.uid === +c.dataset.uid); if (u) R().focus(u.pos); };
      const was = before.get(c.dataset.key); if (was == null || !c.animate) return;
      const dx = was - c.getBoundingClientRect().left;
      if (Math.abs(dx) < 2) return;
      const dur = 380 / G.Settings.speed;
      if (Math.abs(dx) > w * 0.5) c.animate([{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], { duration: dur, easing: 'ease-out' });
      else c.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: dur, easing: 'ease-out' });
    });
    box.scrollLeft = 0;
  }
  function roundMark() { return `<span class="iround" title="Round ${B.round + 1} starts here">R${B.round + 1}</span>`; }

  // Fly a tracker chip in from a point on screen (above a unit) to its slot.
  function flyChip(key, from) {
    const c = $(`#hud-init .ichip[data-key="${key}"]`);
    if (!c) { hiddenChips.delete(key); return Promise.resolve(); }
    const reveal = () => { hiddenChips.delete(key); c.style.opacity = ''; };
    const to = c.getBoundingClientRect();
    if (!from || !c.animate) { reveal(); return Promise.resolve(); }
    const fl = c.cloneNode(true); fl.classList.add('flying'); fl.classList.remove('cur');
    Object.assign(fl.style, { position: 'fixed', left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', margin: 0, opacity: 1, zIndex: 40 });
    document.body.appendChild(fl);
    const dx = from.x - (to.left + to.width / 2), dy = from.y - (to.top + to.height / 2);
    const a = fl.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(1.3)`, opacity: 0.2 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.15)`, opacity: 1, offset: 0.45 },
      { transform: 'none', opacity: 1 }], { duration: 700 / G.Settings.speed, easing: 'ease-in-out' });
    return new Promise(res => { a.onfinish = () => { fl.remove(); reveal(); G.Audio.play('click'); res(); }; });
  }
  // A d20 that tumbles over a unit's head and lands on its initiative total.
  function initDie(uid, total, ms) {
    const p = R().unitPage(uid); if (!p) return null;
    const el = document.createElement('div'); el.className = 'initdie'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    el.innerHTML = `<span>?</span>`; document.body.appendChild(el);
    const sp = el.firstChild; const t0 = performance.now();
    const iv = setInterval(() => { if (performance.now() - t0 >= ms) { clearInterval(iv); sp.textContent = total; el.classList.add('landed'); } else sp.textContent = 1 + Math.floor(Math.random() * 20); }, 60);
    return { el, pos: p, done: () => { clearInterval(iv); el.remove(); } };
  }
  async function rollInitiative(ev) {
    turnBanner(null, 'Roll Initiative!');
    G.Audio.play('dice');
    for (const e of B.order) hiddenChips.add(chipKey(e));
    updateTop();
    await sleep(700);
    const dice = new Map();
    for (const r of ev.rolls) {
      const d = initDie(r.u, r.init, 900 / G.Settings.speed);
      if (d) dice.set(r.u, d);
      await sleep(90);
    }
    await sleep(1500);
    for (const e of B.order) {
      const d = dice.get(e.u.uid);
      flyChip(chipKey(e), d && d.pos);
      if (d && !e.second) { d.el.classList.add('out'); setTimeout(d.done, 300); }
      await sleep(220);
    }
    await sleep(600);
    for (const d of dice.values()) d.done();
    hiddenChips.clear();
  }
  async function joinInitiative(ev) {
    const e = B.order.find(x => x.u.uid === ev.u); if (!e) return;
    hiddenChips.add(chipKey(e)); renderTracker();
    const d = initDie(ev.u, ev.init.init, 700 / G.Settings.speed);
    G.Audio.play('dice');
    await sleep(1300);
    if (d) d.el.classList.add('out');
    await flyChip(chipKey(e), d && d.pos);
    if (d) d.done();
  }

  function shortName(n) { return n.replace(/^(Goblin|Bandit|The) /, '').split(' ')[0]; }
  function monIcon(u) { return { bandit_thug: '👊', bandit_cutthroat: '🗡', bandit_xbow: '🏹', bandit_bruiser: '🔨', bandit_captain: '👑', goblin_boss: '👑', goblin_hexer: '🔮', goblin_slinger: '🪨' }[u.id] || { goblin: '👺', wolf: '🐺', human: '🗡', golem: '🎂', ginger: '🍪', puff: '☁', macaron: '🍬', roll: '🌀' }[u.look && u.look.kind] || '●'; }
  function updateParty() {
    const heroes = B.units.filter(u => u.side === 'hero');
    $('#hud-party').innerHTML = heroes.map(u => {
      const hp = Math.max(0, u.hp), pct = hp / u.maxHp * 100;
      const dying = E().isDying(u);
      return `<div class="pcardh cls-${u.cls} ${ui.hero === u ? 'cur' : ''} ${u.dead ? 'dead' : ''} ${dying ? 'dying' : ''}" data-uid="${u.uid}">
        <div class="ph-top"><span class="ico">${G.ICON[u.cls]}</span><b>${esc(u.name)}</b><span class="ph-lv">${G.Build.CLASSES[u.cls].name}</span></div>
        <div class="bar"><i style="width:${pct}%" class="${pct <= 50 ? 'bl' : ''} ${pct <= 25 ? 'cr' : ''}"></i>${u.tempHp ? `<em style="width:${Math.min(100, u.tempHp / u.maxHp * 100)}%"></em>` : ''}<span>${u.dead ? 'DEAD' : dying ? `DYING (${u.deathFails || 0}/3)` : `${u.hp}/${u.maxHp}${u.tempHp ? ' +' + u.tempHp : ''}`}</span></div>
        <div class="ph-meta"><span title="Healing surges">♥${u.surges}</span><span class="${u.used.__sw ? 'off' : ''}" title="Second Wind">SW</span><span class="${u.used.__ap ? 'off' : ''}" title="Action Point">AP</span>${u.conds.filter(c => c.c !== 'dying').slice(0, 5).map(c => `<span class="cnd" title="${esc(c.label || c.c)}">${esc((c.label || c.c).split(' ')[0])}</span>`).join('')}</div>
      </div>`;
    }).join('');
    $('#hud-party').querySelectorAll('.pcardh').forEach(c => c.onclick = () => { const u = B.units.find(x => x.uid === +c.dataset.uid); if (u && !u.dead) R().focus(u.pos); });
  }
  function updateBottom() {
    const bot = $('#hud-bottom');
    const u = ui.hero;
    if (!u || B.over) { bot.classList.remove('on'); bot.innerHTML = ''; return; }
    bot.classList.add('on');
    const A = u.act;
    const pip = (k, n, l) => `<span class="pip ${n > 0 && !(A.single && A.spent) ? '' : 'off'}" title="${l}">${k}</span>`;
    const canMove = E().canSpend(u, 'move') && !ui.busy;
    const prone = E().hasCond(u, 'prone');
    const powers = u.powers.filter(p => !p.passive);
    const keyOf = (i) => i < 9 ? String(i + 1) : '';
    bot.innerHTML = `
      <div class="hb-left">
        <div class="hb-name cls-${u.cls}">${G.ICON[u.cls]} ${esc(u.name)}</div>
        <div class="hb-acts">${pip('Standard', A.std)}${pip('Move', A.move)}${pip('Minor', A.minor)}${A.single ? '<span class="pip warn">Dazed: 1 action</span>' : ''}</div>
        <div class="hb-btns">
          ${prone ? `<button class="btn act" id="b-stand" ${canMove ? '' : 'disabled'}>Stand Up</button>` : `<button class="btn act ${ui.mode === 'move' ? 'on' : ''}" id="b-move" ${canMove && E().speedOf(u) > 0 ? '' : 'disabled'}>Move <kbd>M</kbd></button>
          <button class="btn act ${ui.mode === 'shift' ? 'on' : ''}" id="b-shift" ${canMove && E().speedOf(u) > 0 ? '' : 'disabled'}>Shift <kbd>X</kbd></button>`}
          <button class="btn act ${ui.mode === 'charge' ? 'on' : ''}" id="b-charge" ${!ui.busy && !prone && E().chargeOptions(B, u).length ? '' : 'disabled'}>Charge <kbd>C</kbd></button>
          <button class="btn act" id="b-sw" ${!ui.busy && !u.used.__sw && u.surges > 0 && E().canSpend(u, u.secondWindAction) ? '' : 'disabled'} title="Spend a surge to heal ${u.surgeValue}, +2 defenses (${u.secondWindAction} action, once per fight)">Second Wind</button>
          <button class="btn act ap" id="b-ap" ${!ui.busy && !u.used.__ap ? '' : 'disabled'} title="Gain an extra standard action (once per fight)">Action Point</button>
          <button class="btn act end" id="b-end" ${ui.busy ? 'disabled' : ''}>End Turn <kbd>␣</kbd></button>
        </div>
      </div>
      <div class="hb-powers">${powers.map((p, i) => {
        const ok = E().canUse(B, u, p) && !ui.busy;
        const used = (p.kind === 'encounter' || p.kind === 'daily') && u.used[p.id];
        const usesLeft = p.uses ? p.uses - (u.uses[p.id] || 0) : null;
        const ab = p.atk ? E().attackBonus(B, u, p, { uid: -1, conds: [] }, {}) : null;
        return `<button class="pow k-${p.kind} ${ok ? '' : 'dis'} ${used ? 'used' : ''} ${ui.power === p ? 'on' : ''}" data-pi="${i}">
          <span class="pk">${keyOf(i)}</span><b>${esc(p.name)}</b>
          <small>${{ atwill: 'At-Will', encounter: 'Encounter', daily: 'Daily', basic: 'Basic' }[p.kind]} · ${p.action || 'standard'}${usesLeft != null ? ` · ${usesLeft} left` : ''}</small>
          ${ab ? `<em>${sgn(ab.total)} vs ${p.atk.vs}</em>` : ''}
          <div class="ptip">${G.Build.describe(p, u).map(esc).join('<br>')}</div></button>`;
      }).join('')}</div>`;
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on('#b-move', () => setMode('move'));
    on('#b-shift', () => setMode(ui.mode === 'shift' ? 'move' : 'shift'));
    on('#b-stand', doStand);
    on('#b-charge', () => setMode(ui.mode === 'charge' ? 'move' : 'charge'));
    on('#b-sw', doSecondWind);
    on('#b-ap', doActionPoint);
    on('#b-end', endHeroTurn);
    bot.querySelectorAll('[data-pi]').forEach(b => b.onclick = () => selectPower(powers[+b.dataset.pi]));
  }

  function powerBanner(u, name, kind) {
    const b = $('#hud-banner'); if (!b) return;
    b.className = 'on ' + (u.side === 'hero' ? 'hero' : 'enemy') + ' k-' + kind;
    b.innerHTML = `<small>${esc(u.name)}</small>${esc(name)}`;
    clearTimeout(powerBanner.t); powerBanner.t = setTimeout(() => b.classList.remove('on'), 1800 / G.Settings.speed);
  }
  // "X's turn" banner. It never blocks input: heroes can act right away, and enemies wait a beat in advance().
  function turnBanner(u, text) {
    const b = $('#hud-turn'); if (!b) return;
    b.className = 'on ' + (u ? u.side : 'neutral');
    b.innerHTML = u ? `<small>Round ${B.round}</small>${esc(u.name)}'s turn` : esc(text);
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(turnBanner.t); turnBanner.t = setTimeout(() => b.classList.remove('on'), 1600 / G.Settings.speed);
  }
  function roundBanner(n) { turnBanner(null, 'Round ' + n); G.Audio.play('turn'); }
  // Story text stays up until dismissed. Intro text is dismissed by Continue or Begin Battle; event text
  // pauses the battle until Continue (or auto-continues after a reading delay while the AI plays the heroes).
  let storyDone = null;
  function story(title, text, opts = {}) {
    const s = $('#hud-story'); if (!s) return Promise.resolve();
    dismissStory();
    s.innerHTML = `${title ? `<b>${esc(title)}</b>` : ''}${text ? `<p>${esc(text)}</p>` : ''}<div class="story-btns"><button class="btn sm" id="story-ok">Continue ▶</button></div>`;
    s.classList.add('on', 'sticky');
    return new Promise(res => {
      storyDone = res;
      $('#story-ok').onclick = () => { G.Audio.play('click'); dismissStory(); };
      if (opts.autoMs) story.t = setTimeout(dismissStory, opts.autoMs / G.Settings.speed);
    });
  }
  function dismissStory() {
    clearTimeout(story.t);
    const s = $('#hud-story'); if (s) s.classList.remove('on', 'sticky');
    const r = storyDone; storyDone = null; if (r) r();
  }
  function storyEvent(text) { return story('', text, { autoMs: G.Settings.autoHeroes ? Math.max(2500, text.length * 55) : 0 }); }
  function momentumPulse() { const m = $('#hud-mom'); if (m) { m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse'); } updateTop(); }

  function finish() {
    if (B.finished) return; B.finished = true;
    ui.hero = null; R().setHighlights({}); updateHud();
    const win = B.over === 'win';
    if (B.over === 'quit') return;
    G.Audio.play(win ? 'win' : 'lose');
    if (win) { try { const best = JSON.parse(localStorage.getItem('hexbound.best') || '{}'); const order = ['story', 'normal', 'hard']; const cur = best[scenRef.id]; const d = DIFF[B.difficulty].label; if (!cur || order.indexOf(B.difficulty) > order.indexOf(Object.keys(DIFF).find(k => DIFF[k].label === cur))) best[scenRef.id] = d; localStorage.setItem('hexbound.best', JSON.stringify(best)); } catch (e) { } }
    const heroes = B.units.filter(u => u.side === 'hero');
    const st = (u) => B.stats[u.uid];
    const score = (u) => st(u).dmg + st(u).healed * 1.2 + st(u).kills * 6 + st(u).crits * 3;
    const mvp = heroes.slice().sort((a, b) => score(b) - score(a))[0];
    const myB = B;
    setTimeout(() => {
      if (B !== myB || !$('#battle').classList.contains('on')) return;
      const m = modal(`
        <h2 class="${win ? 'win' : 'lose'}">${win ? 'Victory!' : 'Defeat'}</h2>
        <p>${esc(win ? scenRef.winText : 'The party has fallen. The ' + (scenRef.id === 'golem' ? 'bakery remains a confectionery horror.' : 'road remains closed.'))}</p>
        <p class="muted">${B.round} rounds · ${DIFF[B.difficulty].label} difficulty</p>
        <table class="stats"><tr><th></th><th>Damage</th><th>Kills</th><th>Crits</th><th>Healed</th><th>Taken</th></tr>
        ${heroes.map(u => `<tr class="${u === mvp ? 'mvp' : ''}"><td>${G.ICON[u.cls]} ${esc(u.name)}${u === mvp ? ' <b>★ MVP</b>' : ''}${u.dead ? ' ☠' : ''}</td><td>${st(u).dmg}</td><td>${st(u).kills}</td><td>${st(u).crits}</td><td>${st(u).healed}</td><td>${st(u).taken}</td></tr>`).join('')}</table>
        <div class="modal-btns"><button class="btn" data-a="retry">${win ? 'Fight again' : 'Try again'}</button><button class="btn" data-a="select">Scenarios</button><button class="btn ghost" data-a="builder">Party Builder</button></div>`, win ? 'result win' : 'result lose');
      m.dataset.sticky = 1;
      m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { m.remove(); const a = b.dataset.a; if (a === 'retry') startBattle(scenRef, partyRef); else if (a === 'select') selectScreen(); else go('builder'); });
    }, 900);
  }

  // ---- keyboard ----
  window.addEventListener('keydown', (e) => {
    if (!B || !$('#battle').classList.contains('on')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (document.querySelector('.modal-bg')) { if (e.key === 'Escape') { const m = document.querySelector('.modal-bg'); if (!m.dataset.sticky) m.remove(); } return; }
    if (storyDone && $('#hud-story.sticky') && (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); dismissStory(); return; }
    const u = ui.hero;
    if (e.key === 'Escape') { if (ui.choice) { const s = $('#btn-skip'); if (s) s.click(); } else if (u) setMode('move'); else battleMenu(); return; }
    if (!u || ui.busy) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { e.preventDefault(); endHeroTurn(); }
    else if (k === 'm') setMode('move');
    else if (k === 'x') setMode(ui.mode === 'shift' ? 'move' : 'shift');
    else if (k === 'c') setMode(ui.mode === 'charge' ? 'move' : 'charge');
    else if (/^[1-9]$/.test(k)) { const powers = u.powers.filter(p => !p.passive); const p = powers[+k - 1]; if (p) selectPower(p); }
  });

  function init() {
    G.Render.init($('#battle-view'));
    G.Render.onHover((h) => hoverAt(h));
    G.Render.onClick((h) => onClick(h));
    G.Render.onRight(() => { if (ui.choice) return; if (ui.mode === 'deploy') { ui.deploySel = null; refreshDeploy(); return; } if (ui.hero) setMode('move'); });
    G.UI = { powerBanner, roundBanner, turnBanner, story, event: storyEvent, rollInitiative, joinInitiative, momentumPulse, onRoll: (ev) => { } };
    menu();
    // debug/testing hooks
    G.App = { startBattle, get B() { return B; }, get ui() { return ui; }, beginBattle, menu, selectScreen, go };
  }
  G.Game = { init };
})();
