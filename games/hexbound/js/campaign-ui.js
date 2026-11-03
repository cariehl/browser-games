// Campaign screens: party creation hand-off, the act map, camp (spoils, level up, short rest), events, merchants,
// rest sites, treasure, the party's gear, the end of a run and the Record of Heroes. Run state and rules live in
// campaign.js.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const C = () => G.Campaign, A = () => G.App;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SLOT_LABEL = { util2: 'utility power', enc3: 'encounter attack', daily5: 'daily attack', enc1: 'encounter attack', daily1: 'daily attack', atwill: 'at-will attack' };
  const OUTCOME = { victory: ['Victory', 'good'], defeat: ['Defeat', 'bad'], abandoned: ['Abandoned', 'muted'] };
  const ROMAN = ['I', 'II', 'III'];
  let run = null, sel = null;

  const heroLine = (b) => `${G.Build.ANCESTRIES[b.ancestry].name} ${G.Build.CLASSES[b.cls].subs[b.sub].name} ${G.Build.CLASSES[b.cls].name}`;
  const itemTip = (id) => { const it = G.Items[id]; return it ? `${it.name}: ${it.power.text || ''}` : ''; };
  const itemChip = (id) => { const it = G.Items[id]; return it ? `<span class="cp-item" title="${esc(itemTip(id))}">${it.icon}</span>` : ''; };
  const gearTip = (id) => { const g = G.Gear[id]; return g ? `${g.name} (${G.GEAR_SLOTS[g.slot].name}): ${g.text}` : ''; };
  const gearChip = (id, slot) => id ? `<span class="cp-gear t${G.Gear[id].tier}" title="${esc(gearTip(id))}">${G.Gear[id].icon}</span>` : `<span class="cp-gear empty" title="${esc(G.GEAR_SLOTS[slot].name)}: empty">${G.GEAR_SLOTS[slot].icon}</span>`;
  const boonChip = (id) => { const b = G.Boons[id]; return b ? `<span class="cp-boon ${b.curse ? 'curse' : ''}" title="${esc(b.name + ': ' + b.text)}">${b.icon}</span>` : ''; };
  const gold = () => `<span class="cp-gold" title="Gold">🪙 ${run.gold}</span>`;
  const save = () => C().saveRun(run);

  // ---------- starting and resuming ----------
  async function start() {
    const cur = C().loadRun();
    if (cur && !await G.Dialog.confirm(`Abandon the current campaign with ${cur.partyName}? It goes into the Record of Heroes as abandoned.`, 'Abandon and start over')) return;
    if (cur) C().abandon(cur);
    A().show('builder');
    G.Builder.open($('#builder'), A().menu, { onBegin: begin });
  }
  function begin(party) {
    const bad = party.heroes.filter(h => G.validateHero(h).length);
    const D = A().DIFF;
    let diff = D[G.Settings.difficulty] ? G.Settings.difficulty : 'normal';
    const m = A().modal(`
      <h3>Begin the Campaign</h3>
      <p><b>${esc(party.name)}</b> sets out on the road to Hollowmere: three acts, each ending in a boss. Pick your path through each act's map.</p>
      ${bad.length ? `<p class="bad">${bad.length === 1 ? 'One hero has' : bad.length + ' heroes have'} build problems (${esc(bad.map(h => h.name).join(', '))}). You can still go.</p>` : ''}
      <div class="cp-diff">${Object.entries(D).map(([k, d]) => `<label class="radio ${diff === k ? 'on' : ''}"><input type="radio" name="cpdiff" value="${k}" ${diff === k ? 'checked' : ''}>${d.label}<small>${d.desc}</small></label>`).join('')}</div>
      <ul class="cp-rules">
        <li>Wounds, spent healing surges, used daily powers and items carry from fight to fight. Rest sites, merchants and act bosses let you recover.</li>
        <li>Fights earn gold, loot and XP. Elites and bosses drop magic gear: weapons, armor, amulets and trinkets.</li>
        <li>❓ nodes are encounters on the road, settled with skill checks. 💰 merchants sell gear, consumables and services.</li>
        <li>A hero who dies stays dead, unless you can pay for the Rite of Return or hold a vigil at a rest site.</li>
      </ul>
      <div class="modal-btns"><button class="btn big" id="cp-setout">Set out ▶</button><button class="btn ghost" data-close>Back</button></div>`, 'small');
    m.querySelectorAll('input[name=cpdiff]').forEach(r => r.onchange = () => { diff = r.value; m.querySelectorAll('.cp-diff .radio').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); });
    $('#cp-setout', m).onclick = () => {
      m.remove(); G.Audio.play('click');
      run = C().newRun(party, diff); save(); sel = null; mapScreen();
    };
  }
  function resume() {
    run = C().loadRun(); sel = null;
    if (!run) return A().menu();
    route();
  }
  // show whatever screen the run is on
  function route() {
    const st = run.stage;
    if (st === 'camp') campScreen();
    else if (st === 'event') eventScreen();
    else if (st === 'shop') shopScreen();
    else if (st === 'rest') restScreen();
    else if (st === 'treasure') treasureScreen();
    // a fight quit midway starts over: back to the map, or to the event that started it
    else if (st === 'battle' && run.event && run.event.fight) { run.stage = 'event'; save(); eventScreen(); }
    else { if (st === 'battle') { run.stage = 'map'; run.node = null; save(); } mapScreen(); }
  }

  // ---------- shared bits: header and party panel ----------
  function head(title, sub, right = '') {
    const xpNext = C().nextLevelXp(run);
    return `<header class="pb-head"><button class="btn ghost" id="cp-menu">← Menu</button><h2>${esc(title)}</h2><span class="muted">${esc(sub || '')}</span>
      <div class="pb-head-r">${gold()}<span class="cp-xp" title="Party level and experience">Level ${run.level}${xpNext ? ` · XP ${run.xp}/${xpNext}` : ' (max)'}</span><button class="btn ghost" id="cp-gear">🎒 Gear & packs</button>${right}</div></header>`;
  }
  function wireHead() {
    $('#cp-menu').onclick = A().menu;
    $('#cp-gear').onclick = gearModal;
  }
  function heroCard(h, i, extra = '') {
    const b = h.build;
    if (h.dead) return `<div class="cp-hero fallen cls-${b.cls}"><div class="cp-h"><span class="ico ic-${b.cls}">${G.ICON[b.cls]}</span><b>${esc(b.name)}</b></div><small>${heroLine(b)}</small><div class="cp-fell">☠ Fell at ${esc(h.fellAt || '?')}</div>${extra}</div>`;
    const s = C().status(run, h);
    const pct = Math.round(s.hp / s.maxHp * 100);
    return `<div class="cp-hero cls-${b.cls}" data-hero="${i}">
      <div class="cp-h"><span class="ico ic-${b.cls}">${G.ICON[b.cls]}</span><b>${esc(b.name)}</b><span class="cp-lv">Lv ${run.level}</span></div>
      <small>${heroLine(b)} · AC ${s.def.AC}</small>
      <div class="cp-bar ${pct <= 50 ? 'bloodied' : ''}"><i style="width:${pct}%"></i><span>${s.hp} / ${s.maxHp} HP</span></div>
      <div class="cp-row"><span title="Healing surges left: each one heals ${s.surgeValue} HP during a short rest">✚ ${s.surges}/${s.maxSurges} surges</span><span class="cp-pack" title="Pack">${h.pack.map(itemChip).join('') || '<span class="muted">empty pack</span>'}</span></div>
      <div class="cp-row"><span class="cp-gears">${Object.keys(G.GEAR_SLOTS).map(sl => gearChip(h.gear[sl], sl)).join('')}</span><span>${(h.boons || []).map(boonChip).join('')}</span></div>
      <div class="cp-dailies">${s.dailies.map(d => `<span class="cp-daily ${d.used ? 'used' : ''}" title="Daily power: ${d.used ? 'spent until you rest' : 'ready'}">${esc(d.name)}</span>`).join('')}</div>
      ${extra}
    </div>`;
  }
  const partyAside = () => `<aside class="cp-party"><h3>The Party <span class="muted">Level ${run.level}</span></h3>${run.heroes.map((h, i) => heroCard(h, i)).join('')}</aside>`;

  // ---------- the map ----------
  const ROW_H = 104, PAD = 70, COL_W = 120;
  function mapLayout() {
    const m = C().mapOf(run), A0 = C().ACTS[run.act];
    const nodes = m.nodes;
    const W = Math.max(520, A0.width * COL_W + 160), H = (A0.rows + 1) * ROW_H + PAD * 2;
    const pos = {};
    for (const n of nodes) {
      // a little seeded wobble so the grid reads as a map
      const jx = n.type === 'boss' ? 0 : ((n.seed % 23) - 11), jy = n.type === 'boss' ? 0 : ((n.seed % 17) - 8);
      pos[n.id] = { x: W / 2 + (n.col - (A0.width - 1) / 2) * COL_W + jx, y: H - PAD - n.row * ROW_H - 10 + jy };
    }
    return { nodes, W, H, pos };
  }
  function nodeLabel(n) {
    if (n.type === 'boss') return C().scenOf(n.scen).name;
    if (n.type === 'elite' && n.scen) return C().scenOf(n.scen).name;
    return C().NODE_TYPES[n.type].name;
  }
  function mapScreen() {
    A().show('campaign');
    const avail = C().available(run);
    if (!sel || !avail.includes(sel)) sel = avail[0];
    const { nodes, W, H, pos } = mapLayout();
    const done = new Set(run.path);
    const st = (n) => done.has(n.id) ? 'done' : avail.includes(n.id) ? 'open' : 'locked';
    const edges = [];
    for (const n of nodes) for (const t of n.next) {
      const a = pos[n.id], b = pos[t]; const walked = done.has(n.id) && (done.has(t) || avail.includes(t));
      edges.push(`<path d="M${a.x},${a.y - 26} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y + (C().nodeOf(run, t).type === 'boss' ? 40 : 26)}" class="${walked ? 'walked' : ''}"/>`);
    }
    const A0 = C().ACTS[run.act];
    const node = C().nodeOf(run, sel);
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head(`Act ${ROMAN[run.act]}: ${A0.name}`, `${run.partyName} · ${(A().DIFF[run.difficulty] || A().DIFF.normal).label}`, '<button class="btn ghost danger" id="cp-abandon">Abandon run</button>')}
        <div class="cp-body">
          ${partyAside()}
          <main class="cp-mapwrap"><div class="cp-map act${run.act + 1}" style="width:${W}px;height:${H}px">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges.join('')}</svg>
            <div class="cp-acts">${C().ACTS.map((a, i) => `<span class="${i === run.act ? 'on' : i < run.act ? 'done' : ''}">${ROMAN[i]}</span>`).join('')}</div>
            ${nodes.map(n => `<button class="cp-node t-${n.type} ${st(n)} ${n.id === sel ? 'sel' : ''}" data-node="${n.id}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px" ${st(n) === 'open' ? '' : 'tabindex="-1"'} aria-label="${esc(nodeLabel(n))}${st(n) === 'done' ? ', visited' : ''}" title="${esc(nodeLabel(n))}"><span class="cp-ic">${n.type === 'boss' ? (G.SCEN_ART[n.scen] || '👑').slice(0, 2) : C().NODE_TYPES[n.type].icon}</span>${st(n) === 'done' ? '<span class="cp-tick">✓</span>' : ''}${n.type === 'boss' ? `<span class="cp-lbl">${esc(nodeLabel(n))}<small>Act boss</small></span>` : ''}</button>`).join('')}
          </div>
          <div class="cp-legend">${Object.entries(C().NODE_TYPES).filter(([k]) => k !== 'boss').map(([k, t]) => `<span>${t.icon} ${t.name}</span>`).join('')}</div></main>
          <aside class="cp-detail">${node ? nodeDetail(node) : ''}
            <p class="muted fine-c">${esc(A0.blurb)}</p>
          </aside>
        </div>
      </div>`;
    wireHead();
    $('#cp-abandon').onclick = async () => {
      if (!await G.Dialog.confirm('Abandon this campaign? It goes into the Record of Heroes as abandoned.', 'Abandon run')) return;
      C().abandon(run); const rec = run.record; run = null; overScreen(rec);
    };
    document.querySelectorAll('.cp-node.open').forEach(b => b.onclick = () => { sel = b.dataset.node; G.Audio.play('click'); mapScreen(); });
    // keep the next step of the path in view
    const wrap = $('.cp-mapwrap'), cur = sel && $(`[data-node="${sel}"]`);
    if (wrap && cur) wrap.scrollTop = Math.max(0, cur.offsetTop - wrap.clientHeight * 0.6);
    const f = $('#cp-go'); if (f) f.onclick = () => go(sel);
  }
  function scenCard(scen, level, extra = '') {
    return `<div class="scen s-${scen.id}"><div class="scen-art">${G.SCEN_ART[scen.id] || '⚔'}</div>
      <h3>${esc(scen.name)}</h3><div class="scen-sub">Level ${level} · ${esc(scen.sub.split('·').slice(1).join('·').trim())}</div>${extra}<p>${esc(scen.blurb)}</p>
      <ul>${scen.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }
  function nodeDetail(n) {
    const T = C().NODE_TYPES[n.type];
    const btn = (label) => `<button class="btn big" id="cp-go">${label}</button>`;
    if (n.type === 'boss' || (n.type === 'elite' && n.scen)) {
      const p = C().fightPreview(run, n.id);
      return scenCard(p.scen, p.level, `<p class="cp-tag ${n.type}">${n.type === 'boss' ? '👑 Act boss: beat it to finish the act, rest fully, and pick from three pieces of gear.' : '💀 Elite fight: a choice of two pieces of gear if you win.'}</p>`) + btn('Enter battle ▶');
    }
    if (n.type === 'combat' || n.type === 'elite') {
      const F = G.Encounters.FACTIONS[n.faction];
      return `<div class="cp-nodecard"><div class="cp-big">${T.icon}</div><h3>${n.type === 'elite' ? 'Elite: ' : ''}${esc(F.name)}</h3><div class="scen-sub">Level ${run.level} · ${n.type === 'elite' ? 'a powerful foe and its retinue' : 'a fight on the road'}</div>
        <p>${n.type === 'elite' ? 'Win for gold, a consumable and a choice of two pieces of magic gear.' : 'Win for gold, XP and a consumable or two.'}</p>
        <ul>${F.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>${btn('Enter battle ▶')}`;
    }
    const about = {
      event: 'Something waits on the road: a stranger, a shrine, a choice. Most are settled by skill checks; a few turn into fights.',
      shop: 'A travelling merchant with consumables, magic gear and a few services, including the Rite of Return for the fallen.',
      rest: 'A safe campfire. Recover your wounds, regain your daily powers, or forage for supplies. You can only pick one.',
      treasure: 'A chest, half buried. Magic gear and gold for whoever opens it, if the trap doesn\'t get them first.',
    }[n.type];
    return `<div class="cp-nodecard"><div class="cp-big">${T.icon}</div><h3>${esc(T.name)}</h3><p>${esc(about)}</p></div>${btn('Go ▶')}`;
  }

  function go(nodeId) {
    G.Audio.play('click');
    const stage = C().enter(run, nodeId);
    save();
    if (stage === 'battle') fight(nodeId); else route();
  }
  function fight(nodeId) {
    const setup = C().battleSetup(run, nodeId);
    run.stage = 'battle'; save();
    const myRun = run;
    A().startBattle(setup.scen, setup.party, {
      difficulty: run.difficulty, items: setup.opts.items, carry: setup.opts.carry, gear: setup.opts.gear, level: setup.opts.level, lvAdj: setup.opts.lvAdj,
      campaign: {
        onEnd(B) {
          const r = C().recordBattle(myRun, nodeId, B);
          if (myRun.outcome) C().clearRun(); else C().saveRun(myRun);
          return { fallen: r.fallen, over: r.over, next: () => { run = myRun; if (myRun.outcome && !myRun.camp) overScreen(myRun.record); else campScreen(); } };
        },
      },
    });
  }

  // ---------- camp: spoils, level up, short rest ----------
  function campScreen() {
    A().show('campaign');
    const cp = run.camp;
    const last = run.battles[run.battles.length - 1];
    const lvUp = cp.to > cp.from;
    const describe = (id) => esc(G.Build.describe(G.Build.POWERS[id]).join('\n'));
    const cards = run.heroes.map((h, i) => {
      if (h.dead) return heroCard(h, i);
      const s = C().status(run, h), before = cp.before[i];
      const u = C().unitOf(run, h);
      const gained = before ? u.powers.filter(p => !before.powers.includes(p.id) && p.kind !== 'item') : [];
      const choices = C().levelChoices(run, i);
      const lv = lvUp ? `<div class="cp-lvup"><b>Level ${cp.to}</b> <span class="good">+${Math.max(0, s.maxHp - (before ? before.maxHp : s.maxHp))} max HP</span>
        ${choices.map((c, k) => c.kind === 'power'
          ? `<div class="cp-pick"><small>New ${SLOT_LABEL[c.slot] || 'power'}</small><div class="chips">${c.options.map(id => `<button class="chip ${id === c.pick ? 'on' : ''}" data-pick="${i}:${k}:${id}" title="${describe(id)}">${esc(G.Build.POWERS[id].name)}</button>`).join('')}</div></div>`
          : `<div class="cp-pick"><small>New feat</small><select data-feat="${i}:${k}"><option value="">Choose a feat…</option>${c.options.map(id => `<option value="${id}" ${c.pick === id ? 'selected' : ''}>${esc(G.Build.FEATS[id].name)}</option>`).join('')}</select>${c.pick ? `<p class="muted">${esc(G.Build.FEATS[c.pick].text)}</p>` : ''}</div>`).join('')}
        ${!choices.length && gained.length ? `<div class="cp-pick"><small>New</small> ${gained.map(p => esc(p.name)).join(', ')}</div>` : ''}</div>` : '';
      const rest = cp.actDone ? '' : `<div class="cp-rest"><button class="btn sm" data-surge="${i}" ${s.surges > 0 && s.hp < s.maxHp ? '' : 'disabled'}>Spend a surge (+${Math.min(s.surgeValue, s.maxHp - s.hp)} HP)</button>${s.hp === 0 ? `<small class="warn">${s.surges ? 'Unconscious: spend a surge to wake.' : 'Unconscious: wakes at 1 HP.'}</small>` : ''}</div>`;
      return heroCard(h, i, lv + rest);
    }).join('');
    const found = cp.found.map(f => f.hero != null ? `${itemChip(f.item)} ${esc(G.Items[f.item].name)} <span class="muted">→ ${esc(run.heroes[f.hero].build.name)}</span>` : `${itemChip(f.item)} ${esc(G.Items[f.item].name)} <span class="muted">(packs full: sold for ${f.sold} gold)</span>`);
    const gearPick = cp.gear.length ? `<div class="cp-loot"><h4>${cp.gearTaken ? 'You took' : `Choose one of ${cp.gear.length === 2 ? 'two' : 'three'} pieces of gear`}</h4><div class="cp-cards">${cp.gear.map(id => gearCard(id, cp.gearTaken ? (cp.gearTaken === id ? '<span class="good">✓ Taken</span>' : '<span class="muted">Left behind</span>') : `<button class="btn" data-take="${id}">Take</button>`)).join('')}</div>${cp.gearTaken ? '<p class="muted fine-c">New gear goes to whoever gains the most from it. Swap it around under 🎒 Gear & packs.</p>' : ''}</div>` : '';
    const blocked = C().unfilledChoices(run) || (cp.gear.length && !cp.gearTaken);
    const final = run.outcome === 'victory';
    $('#campaign').innerHTML = `
      <div class="cp camp">
        ${head(cp.actDone ? `Act ${ROMAN[run.act]} complete` : 'Camp', `after ${last.name}`)}
        <div class="camp-body">
          <div class="camp-intro">
            ${cp.actDone ? `<h3 class="good">${final ? 'Hollowmere is saved!' : `${esc(C().ACTS[run.act].name)} is behind you.`}</h3><p>${final ? 'The last boss falls. Claim your victory below.' : `<b>An extended rest:</b> every hero is back to full HP, healing surges and daily powers. Next: Act ${ROMAN[run.act + 1]}, ${esc(C().ACTS[run.act + 1].name)}.`}</p>` : ''}
            ${lvUp ? `<h3 class="good">The party reaches Level ${cp.to}!</h3>` : ''}
            ${cp.actDone ? '' : '<p>A short rest: spend healing surges to recover. Encounter powers, Second Wind and Action Points come back for the next fight. <b>Daily powers stay spent</b> until a rest site or the end of the act.</p>'}
            <div class="cp-spoils"><b>Spoils:</b> <span class="cp-gold">🪙 +${cp.gold} gold</span>${found.length ? ' · ' + found.join(' · ') : ''}</div>
            ${gearPick}
          </div>
          <div class="camp-heroes">${cards}</div>
          <div class="camp-foot">${cp.actDone ? '' : '<button class="btn" id="cp-rest">Rest everyone</button>'}<button class="btn big" id="cp-break" ${blocked ? `disabled title="${cp.gear.length && !cp.gearTaken ? 'Take a piece of gear first' : 'Choose a feat for every hero first'}"` : ''}>${final ? 'Claim victory ▶' : cp.actDone ? `On to Act ${ROMAN[run.act + 1]} ▶` : 'Break camp ▶'}</button></div>
        </div>
      </div>`;
    wireHead();
    document.querySelectorAll('[data-surge]').forEach(b => b.onclick = () => { if (C().spendSurge(run, +b.dataset.surge)) { G.Audio.play('heal'); save(); campScreen(); } });
    document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const [i, k, id] = b.dataset.pick.split(':'); C().choose(run, +i, C().levelChoices(run, +i)[+k], id); save(); campScreen(); });
    document.querySelectorAll('[data-feat]').forEach(el => el.onchange = () => { if (!el.value) return; const [i, k] = el.dataset.feat.split(':'); C().choose(run, +i, C().levelChoices(run, +i)[+k], el.value); save(); campScreen(); });
    document.querySelectorAll('[data-take]').forEach(b => b.onclick = () => { if (C().takeGear(run, b.dataset.take)) { G.Audio.play('buff'); save(); campScreen(); } });
    const r = $('#cp-rest'); if (r) r.onclick = () => { let n = 0; run.heroes.forEach((h, i) => n += C().autoRest(run, i)); if (n) G.Audio.play('heal'); save(); campScreen(); };
    $('#cp-break').onclick = () => {
      G.Audio.play('click');
      if (final) { run.camp = null; C().clearRun(); overScreen(run.record); return; }
      C().breakCamp(run); save(); sel = null; mapScreen();
    };
  }
  function gearCard(id, action = '', extra = '') {
    const g = G.Gear[id];
    return `<div class="cp-card gear t${g.tier}"><div class="cp-card-ic">${g.icon}</div><b>${esc(g.name)}</b><small>${esc(G.GEAR_SLOTS[g.slot].name)} · ${['', 'Common', 'Uncommon', 'Rare'][g.tier]}</small><p>${esc(g.text)}</p><p class="muted flavor">${esc(g.flavor || '')}</p>${extra}<div class="cp-card-act">${action}</div></div>`;
  }
  function itemCard(id, action = '', extra = '') {
    const it = G.Items[id];
    return `<div class="cp-card item"><div class="cp-card-ic">${it.icon}</div><b>${esc(it.name)}</b><small>${{ potion: 'Potion · minor action', throwable: 'Throwable · standard action', gear: 'Field gear · standard action' }[it.cat] || ''}</small><p>${esc(it.power.text || '')}</p>${extra}<div class="cp-card-act">${action}</div></div>`;
  }

  // ---------- events ----------
  function eventScreen(rolled) {
    A().show('campaign');
    const ev = run.event, E0 = G.Events[ev.id], res = ev.result;
    const choiceBtn = (c, k) => {
      const open = C().choiceOpen(run, c);
      let info = '';
      if (c.check) { const o = C().checkOdds(run, c.check.skill, c.check.dc), pc = Math.round(o.chance * 100); info = `<span class="ev-odds ${pc >= 70 ? 'good' : pc >= 45 ? 'ok' : 'bad'}">${pc}%</span>${G.Skills[c.check.skill].name} DC ${o.dc} · ${esc(run.heroes[o.hero].build.name)} +${o.bonus}`; }
      else if (c.luck) info = 'A gamble';
      if (c.cost && c.cost.gold) info = `🪙 ${c.cost.gold}${info ? ' · ' + info : ''}`;
      return `<button class="btn cp-choice" data-choice="${k}" ${open.ok ? '' : 'disabled'}><b>${esc(c.label)}</b>${info ? `<small>${info}</small>` : ''}${open.ok ? '' : `<small class="warn">${esc(open.why)}</small>`}</button>`;
    };
    let body;
    if (!res) body = `<div class="cp-choices">${E0.choices.map(choiceBtn).join('')}</div>`;
    else {
      const ck = res.check;
      // a fresh skill check rolls a d20 on screen before the outcome shows
      const die = ck ? `<div class="ev-check ${rolled ? 'rolling' : ''} ${ck.ok ? 'ok' : 'fail'}"><div class="ev-die" data-roll="${ck.roll}"><span>${ck.roll}</span></div><div class="ev-sum"><b>${ck.total}</b> <small>vs DC</small> <b>${ck.dc}</b><em>${ck.ok ? 'Success' : 'Failure'}</em></div></div>` : '';
      body = `${die}<div class="cp-result ${ck && rolled ? 'reveal' : ''}">
        ${ck ? `<p class="cp-roll ${ck.ok ? 'good' : 'bad'}">${esc(run.heroes[ck.hero].build.name)} rolls ${G.Skills[ck.skill].name}: d20 ${ck.roll} + ${ck.bonus} = ${ck.total} vs DC ${ck.dc}: <b>${ck.ok ? 'success' : 'failure'}</b></p>` : ''}
        <p>${esc(res.text)}</p>
        ${res.lines.length ? `<ul>${res.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="modal-btns">${ev.fight ? '<button class="btn big" id="ev-fight">To battle ▶</button>' : '<button class="btn big" id="ev-done">Continue ▶</button>'}</div></div>`;
    }
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head(E0.title, `Act ${ROMAN[run.act]}: ${C().ACTS[run.act].name}`)}
        <div class="cp-body two">${partyAside()}
          <main class="cp-scene"><div class="cp-event"><div class="cp-big">${E0.icon}</div><h2>${esc(E0.title)}</h2><p class="cp-text">${esc(E0.text)}</p>${body}</div></main>
        </div>
      </div>`;
    wireHead();
    document.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => {
      const r = C().resolveChoice(run, +b.dataset.choice); if (!r) return;
      save();
      if (!r.check) { G.Audio.play('click'); eventScreen(); return; }
      G.Audio.play('dice'); eventScreen(true);
      const d = $('.ev-die span'), t0 = performance.now();
      const iv = setInterval(() => {
        if (!d.isConnected) return clearInterval(iv);
        if (performance.now() - t0 > 850) { clearInterval(iv); d.textContent = r.check.roll; G.Audio.play(r.check.ok ? 'buff' : 'miss'); }
        else d.textContent = 1 + Math.floor(Math.random() * 20);
      }, 55);
    });
    const d = $('#ev-done'); if (d) d.onclick = () => { C().leave(run); save(); sel = null; mapScreen(); };
    const f = $('#ev-fight'); if (f) f.onclick = () => { G.Audio.play('click'); fight(run.node); };
  }

  // ---------- merchants ----------
  function shopScreen(msg = '') {
    A().show('campaign');
    const s = run.shop;
    const price = (p, sold) => sold ? '<span class="muted">Sold</span>' : `<span class="cp-price">🪙 ${p}</span>`;
    const roomy = C().living(run).some(h => h.pack.length < C().PACK_MAX);
    const items = s.items.map((it, k) => itemCard(it.id, it.sold ? '<span class="muted">Sold</span>' : `${price(it.price)} <button class="btn sm" data-buy="item:${k}" ${run.gold >= it.price && roomy ? '' : 'disabled'} ${roomy ? '' : 'title="Every pack is full"'}>Buy</button>`)).join('');
    const gear = s.gear.map((it, k) => gearCard(it.id, it.sold ? '<span class="muted">Sold</span>' : `${price(it.price)} <button class="btn sm" data-buy="gear:${k}" ${run.gold >= it.price ? '' : 'disabled'}>Buy</button>`)).join('');
    const dead = run.heroes.map((h, i) => h.dead ? i : null).filter(i => i != null);
    const services = s.services.map((sv, k) => {
      const ok = !sv.used && run.gold >= sv.price;
      const btn = sv.id === 'raise'
        ? (dead.length ? dead.map(i => `<button class="btn sm" data-buy="service:${k}:${i}" ${ok ? '' : 'disabled'}>Raise ${esc(run.heroes[i].build.name)}</button>`).join(' ') : '<span class="muted">Nobody to raise</span>')
        : `<button class="btn sm" data-buy="service:${k}" ${ok ? '' : 'disabled'}>Pay</button>`;
      return `<div class="cp-card service ${sv.used ? 'used' : ''}"><b>${esc(sv.name)}</b><p>${esc(sv.text)}</p><div class="cp-card-act">${sv.used ? '<span class="muted">Done</span>' : `${price(sv.price)} ${btn}`}</div></div>`;
    }).join('');
    const sell = run.stash.length ? run.stash.map((id, k) => `<div class="cp-sell">${G.Gear[id].icon} ${esc(G.Gear[id].name)} <button class="btn sm ghost" data-sell="${k}">Sell for 🪙 ${C().sellPrice(id)}</button></div>`).join('') : '<p class="muted">Your stash is empty. Unequip gear under 🎒 Gear & packs to sell it here.</p>';
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('The Merchant', `Act ${ROMAN[run.act]}: ${C().ACTS[run.act].name}`)}
        <div class="cp-body two">${partyAside()}
          <main class="cp-shop">
            <p class="cp-text">"Come in, come in! Everything's priced to move, much like yourselves."</p>${msg ? `<p class="warn">${esc(msg)}</p>` : ''}
            <h4>Magic gear</h4><div class="cp-cards">${gear}</div>
            <h4>Consumables <small class="muted">(go into the emptiest pack)</small></h4><div class="cp-cards">${items}</div>
            <h4>Services</h4><div class="cp-cards">${services}</div>
            <h4>Sell from your stash</h4><div class="cp-sells">${sell}</div>
            <div class="camp-foot"><button class="btn big" id="sh-done">Leave the shop ▶</button></div>
          </main>
        </div>
      </div>`;
    wireHead();
    document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
      const [kind, k, hi] = b.dataset.buy.split(':');
      const r = C().buy(run, kind, +k, hi != null ? +hi : null);
      if (r.ok) { G.Audio.play(kind === 'service' ? 'heal' : 'buff'); save(); shopScreen(); }
      else shopScreen({ pack: 'Every pack is full.', unhurt: 'Nobody needs healing.', uncursed: 'Nobody is cursed.', nobody: 'Nobody to raise.' }[r.why] || 'Not enough gold.');
    });
    document.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => { if (C().sell(run, +b.dataset.sell)) { G.Audio.play('click'); save(); shopScreen(); } });
    $('#sh-done').onclick = () => { C().leave(run); save(); sel = null; mapScreen(); };
  }

  // ---------- rest sites ----------
  function restScreen() {
    A().show('campaign');
    const R = run.rest, opts = C().REST_OPTIONS;
    const body = R.done ? `<div class="cp-result"><p><b>${opts[R.done].icon} ${esc(opts[R.done].name)}.</b> ${esc(opts[R.done].text)}</p>
        ${R.found && R.found.length ? `<ul>${R.found.map(f => f.raised != null ? `<li>${esc(run.heroes[f.raised].build.name)} returns to the living.</li>` : `<li>${itemChip(f.item)} ${esc(G.Items[f.item].name)} → ${esc(run.heroes[f.hero].build.name)}</li>`).join('')}</ul>` : ''}
        <div class="modal-btns"><button class="btn big" id="rs-done">Continue ▶</button></div></div>`
      : `<div class="cp-choices">${Object.entries(opts).filter(([, o]) => !o.need || o.need(run)).map(([k, o]) => `<button class="btn cp-choice" data-rest="${k}"><b>${o.icon} ${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join('')}</div>`;
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('Rest Site', `Act ${ROMAN[run.act]}: ${C().ACTS[run.act].name}`)}
        <div class="cp-body two">${partyAside()}
          <main class="cp-scene"><div class="cp-event"><div class="cp-big">🔥</div><h2>A Safe Campfire</h2><p class="cp-text">For once, nothing is trying to kill you. There is time for one thing before you move on.</p>${body}</div></main>
        </div>
      </div>`;
    wireHead();
    document.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { C().restAt(run, b.dataset.rest); G.Audio.play('heal'); save(); restScreen(); });
    const d = $('#rs-done'); if (d) d.onclick = () => { C().leave(run); save(); sel = null; mapScreen(); };
  }

  // ---------- treasure ----------
  function treasureScreen() {
    A().show('campaign');
    const T = run.treasure;
    let body;
    if (!T.opened) {
      const o = C().checkOdds(run, 'thievery', 'easy');
      body = `<div class="cp-choices"><button class="btn cp-choice" id="tr-open"><b>Open the chest</b><small>Thievery DC ${o.dc} to spot the trap · ${esc(run.heroes[o.hero].build.name)} +${o.bonus} · ${Math.round(o.chance * 100)}%</small></button></div>`;
    } else {
      const r = T.opened, ck = r.check;
      body = `<div class="cp-result">${ck ? `<p class="cp-roll ${ck.ok ? 'good' : 'bad'}">${esc(run.heroes[ck.hero].build.name)} rolls Thievery: d20 ${ck.roll} + ${ck.bonus} = ${ck.total} vs DC ${ck.dc}: <b>${ck.ok ? 'trap disarmed' : 'the trap goes off'}</b>${r.trap ? ` (${r.trap} damage)` : ''}</p>` : ''}
        <p>Inside: <span class="cp-gold">🪙 ${r.gold} gold</span> and</p><div class="cp-cards">${gearCard(r.gear)}</div>
        <div class="modal-btns"><button class="btn big" id="tr-done">Continue ▶</button></div></div>`;
    }
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('Treasure', `Act ${ROMAN[run.act]}: ${C().ACTS[run.act].name}`)}
        <div class="cp-body two">${partyAside()}
          <main class="cp-scene"><div class="cp-event"><div class="cp-big">🧰</div><h2>A Half-Buried Chest</h2><p class="cp-text">Iron-banded oak, green with age. The lock is intact. So, probably, is whatever the last owner left to guard it.</p>${body}</div></main>
        </div>
      </div>`;
    wireHead();
    const o = $('#tr-open'); if (o) o.onclick = () => { const r = C().openChest(run, true); G.Audio.play(r && r.trap ? 'hit' : 'buff'); save(); treasureScreen(); };
    const d = $('#tr-done'); if (d) d.onclick = () => { C().leave(run); save(); sel = null; mapScreen(); };
  }

  // ---------- gear and packs ----------
  function gearModal() {
    const m = A().modal('<div id="gm"></div>', 'cp-gm');
    m.dataset.sticky = 1;
    const draw = () => {
      const hs = run.heroes.map((h, i) => h.dead ? '' : `<div class="gm-hero cls-${h.build.cls}"><h4><span class="ic-${h.build.cls}">${G.ICON[h.build.cls]}</span> ${esc(h.build.name)}</h4>
        ${Object.entries(G.GEAR_SLOTS).map(([sl, S]) => { const id = h.gear[sl]; return `<div class="gm-slot ${id ? '' : 'empty'}" title="${esc(id ? gearTip(id) : S.hint)}"><span>${id ? G.Gear[id].icon : S.icon}</span><div><b>${id ? esc(G.Gear[id].name) : `No ${S.name.toLowerCase()}`}</b><small>${esc(id ? G.Gear[id].text : S.hint)}</small></div>${id ? `<button class="btn sm ghost" data-unequip="${i}:${sl}">Remove</button>` : ''}</div>`; }).join('')}
        ${(h.boons || []).length ? `<div class="gm-boons">${h.boons.map(b => `<span class="cp-boon ${G.Boons[b].curse ? 'curse' : ''}">${G.Boons[b].icon} ${esc(G.Boons[b].name)}</span>`).join('')}</div>` : ''}
        <div class="gm-pack"><small>Pack (${h.pack.length}/${C().PACK_MAX})</small>${h.pack.map((id, k) => `<div class="gm-item" title="${esc(itemTip(id))}">${G.Items[id].icon} ${esc(G.Items[id].name)} <select data-give="${i}:${k}"><option value="">Give to…</option>${run.heroes.map((o, j) => !o.dead && j !== i && o.pack.length < C().PACK_MAX ? `<option value="${j}">${esc(o.build.name)}</option>` : '').join('')}</select></div>`).join('') || '<div class="muted">Empty</div>'}</div>
      </div>`).join('');
      const stash = run.stash.length ? run.stash.map((id, k) => `<div class="gm-stash-i">${gearCard(id, run.heroes.map((h, i) => h.dead ? '' : `<button class="btn sm" data-equip="${i}:${k}">${esc(h.build.name)}</button>`).join(''))}</div>`).join('') : '<p class="muted">Nothing in the stash. Gear you remove, or that has nobody to wear it, waits here.</p>';
      $('#gm', m).innerHTML = `<h3>Gear & packs ${gold()}</h3><div class="gm-heroes">${hs}</div><h4>Stash <small class="muted">equip on…</small></h4><div class="cp-cards">${stash}</div><div class="modal-btns"><button class="btn" data-close>Done</button></div>`;
      m.querySelectorAll('[data-unequip]').forEach(b => b.onclick = () => { const [i, sl] = b.dataset.unequip.split(':'); C().unequip(run, +i, sl); save(); draw(); });
      m.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.equip.split(':'); C().equip(run, +i, run.stash[+k]); G.Audio.play('buff'); save(); draw(); });
      m.querySelectorAll('[data-give]').forEach(s => s.onchange = () => { if (s.value === '') return; const [i, k] = s.dataset.give.split(':'); C().movePack(run, +i, +k, +s.value); save(); draw(); });
      m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { m.remove(); route(); });
    };
    draw();
  }

  // ---------- end of a run ----------
  function overScreen(rec) {
    A().show('campaign');
    const [label, cls] = OUTCOME[rec.outcome];
    $('#campaign').innerHTML = `
      <div class="cp over"><div class="over-inner">
        <h2 class="${cls}">${rec.outcome === 'victory' ? 'Hollowmere is saved!' : rec.outcome === 'defeat' ? 'The party has fallen' : 'Run abandoned'}</h2>
        <p class="muted">${esc(rec.partyName)} · ${label} · ${runLine(rec)}</p>
        ${recordHeroes(rec)}
        <div class="modal-btns"><button class="btn" id="ov-rec">📜 Record of Heroes</button><button class="btn ghost" id="ov-menu">Main menu</button></div>
      </div></div>`;
    $('#ov-rec').onclick = record;
    $('#ov-menu').onclick = A().menu;
  }
  const runLine = (r) => `${r.acts ? `Act ${ROMAN[(r.act || 1) - 1]} of ${ROMAN[r.acts - 1]}${r.actName ? ` (${esc(r.actName)})` : ''} · ` : ''}won ${r.won} fight${r.won === 1 ? '' : 's'}${r.reached && r.outcome !== 'victory' ? ` · ${r.outcome === 'defeat' ? 'fell at' : 'last fought at'} ${esc(r.reached)}` : ''}`;
  function recordHeroes(r) {
    return `<div class="rec-heroes">${r.heroes.map(h => `<div class="rec-h ${h.fell ? 'fallen' : ''} cls-${h.cls}"><div><span class="ic-${h.cls}">${G.ICON[h.cls]}</span> <b>${esc(h.name)}</b>${r.mvp === h.name ? ' <span class="mvp-b">★ MVP</span>' : ''}</div><small>${G.Build.CLASSES[h.cls].name} · ${h.kills} kills · ${h.dmg} dmg</small>${h.fell ? `<small class="bad">☠ Fell at ${esc(h.fellAt)}</small>` : '<small class="good">Survived</small>'}</div>`).join('')}</div>`;
  }

  // ---------- Record of Heroes ----------
  function record() {
    A().show('record');
    const list = C().records();
    const wins = list.filter(r => r.outcome === 'victory').length;
    const date = (t) => { try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
    $('#record').innerHTML = `
      <div class="rec">
        <header class="pb-head"><button class="btn ghost" id="rec-back">← Menu</button><h2>Record of Heroes</h2>
          <span class="muted">${list.length ? `${list.length} run${list.length === 1 ? '' : 's'} · ${wins} victor${wins === 1 ? 'y' : 'ies'}` : ''}</span>
          <div class="pb-head-r">${list.length ? '<button class="btn ghost danger" id="rec-clear">Clear record</button>' : ''}</div></header>
        <div class="rec-list">${list.length ? list.map(r => { const [label, cls] = OUTCOME[r.outcome] || ['?', 'muted']; const D = A().DIFF[r.difficulty]; return `
          <article class="rec-run ${r.outcome}">
            <div class="rec-top"><span class="rec-badge ${cls}">${label}</span><b>${esc(r.partyName)}</b><span class="muted">${esc(r.map)} · ${D ? D.label : ''} · ${date(r.ended || r.started)}</span></div>
            <div class="rec-sum">${runLine(r)} · reached Level ${r.level} · ${r.rounds} rounds · ${r.totals.kills || 0} kills${r.gold != null ? ` · ${r.gold} gold` : ''}</div>
            ${recordHeroes(r)}
          </article>`; }).join('') : '<p class="muted rec-empty">No runs yet. Start a campaign from the main menu, and every run, won or lost, is written down here.</p>'}</div>
      </div>`;
    $('#rec-back').onclick = A().menu;
    const c = $('#rec-clear'); if (c) c.onclick = async () => { if (await G.Dialog.confirm('Erase every run from the Record of Heroes? This can\'t be undone.', 'Erase')) { C().clearRecords(); record(); } };
  }

  G.CampaignUI = { start, resume, record, mapScreen, campScreen, eventScreen, shopScreen, restScreen, treasureScreen, gearModal, get run() { return run; } };
})();
