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
  const M = () => G.Menu;
  const actTrack = () => `<ol class="act-track" aria-label="Acts">${C().ACTS.map((a, i) => `<li class="${i === run.act ? 'on' : i < run.act ? 'done' : ''}" ${i === run.act ? 'aria-current="step"' : ''}><i>${i < run.act ? '✓' : ROMAN[i]}</i><span>${esc(a.name)}</span></li>`).join('')}</ol>`;
  function head(title, sub, right = '') {
    const xpNext = C().nextLevelXp(run), xpPrev = C().XP_LEVELS[run.level] || 0;
    const xpTip = xpNext ? `Level ${run.level}: ${run.xp} XP, next level at ${xpNext}` : `Level ${run.level}, the highest`;
    const lv = `<span class="tb-pill lv" title="${xpTip}"><span><b>Level ${run.level}</b> ${xpNext ? `<span class="muted">· ${run.xp}/${xpNext} XP</span>` : '<span class="muted">· max</span>'}</span>${M().meter(xpNext ? run.xp - xpPrev : 1, xpNext ? xpNext - xpPrev : 1, 'xp')}</span>`;
    return M().topbar({ backId: 'cp-menu', eyebrow: esc(sub || ''), title: esc(title), mid: actTrack(),
      right: `<span class="tb-pill gold" title="Gold">🪙 ${run.gold}</span>${lv}<button class="btn ghost" id="cp-gear" title="Equip gear and move items between packs">🎒<span class="lbl"> Gear & packs</span></button>${right}` });
  }
  function wireHead() {
    $('#cp-menu').onclick = A().menu;
    $('#cp-gear').onclick = gearModal;
  }
  function heroCard(h, i, extra = '') {
    const b = h.build;
    if (h.dead) return `<div class="cp-hero fallen cls-${b.cls}"><div class="cp-h">${M().hexpor(b.cls, { size: 'sm', dead: true })}<div class="cp-id"><b>${esc(b.name)}</b><small>${heroLine(b)}</small></div></div><div class="cp-fell">☠ Fell at ${esc(h.fellAt || '?')}</div>${extra}</div>`;
    const s = C().status(run, h);
    const pct = Math.round(s.hp / s.maxHp * 100);
    const items = h.pack.map(itemChip).join('') + Array.from({ length: C().PACK_MAX - h.pack.length }, () => '<span class="cp-item empty" title="Empty pack slot"></span>').join('');
    return `<div class="cp-hero cls-${b.cls}" data-hero="${i}">
      <div class="cp-h">${M().hexpor(b.cls, { size: 'sm' })}<div class="cp-id"><b>${esc(b.name)}</b><small>${heroLine(b)}</small></div><span class="cp-ac" title="Armor Class">AC <b>${s.def.AC}</b></span></div>
      <div class="cp-bar ${pct <= 50 ? 'bloodied' : ''} ${s.hp === 0 ? 'down' : ''}"><i style="width:${pct}%"></i><span>${s.hp} / ${s.maxHp} HP</span></div>
      <div class="cp-row"><span class="cp-surges" title="Healing surges left: each heals ${s.surgeValue} HP when you rest">✚ ${M().pips(s.surges, s.maxSurges)} <small>${s.surges}/${s.maxSurges}</small></span></div>
      <div class="cp-row cp-kit"><span class="cp-gears">${Object.keys(G.GEAR_SLOTS).map(sl => gearChip(h.gear[sl], sl)).join('')}</span><span class="cp-pack" title="Pack">${items}</span></div>
      ${(h.boons || []).length ? `<div class="cp-row">${h.boons.map(boonChip).join('')}</div>` : ''}
      <div class="cp-dailies">${s.dailies.map(d => `<span class="cp-daily ${d.used ? 'used' : ''}" title="Daily power: ${d.used ? 'spent until you rest' : 'ready'}">${esc(d.name)}</span>`).join('')}</div>
      ${extra}
    </div>`;
  }
  const partyAside = () => `<aside class="cp-party"><h3>The Party <span class="muted">${C().living(run).length} of ${run.heroes.length} standing</span></h3>${run.heroes.map((h, i) => heroCard(h, i)).join('')}</aside>`;
  // a centred scene (event, rest site, treasure) beside the party
  const scene = (icon, crestCls, title, text, body) => `<main class="cp-scene"><div class="cp-event">${M().crest(icon, crestCls)}<h2>${esc(title)}</h2><p class="cp-text">${esc(text)}</p>${body}</div></main>`;

  // ---------- the map ----------
  const ROW_H = 104, PAD = 80, COL_W = 120;
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
    if ((n.type === 'combat' || n.type === 'elite') && n.faction) return (n.type === 'elite' ? 'Elite: ' : '') + G.Encounters.FACTIONS[n.faction].name;
    return C().NODE_TYPES[n.type].name;
  }
  function mapScreen() {
    A().show('campaign');
    const avail = C().available(run);
    if (!sel || !avail.includes(sel)) sel = avail[0];
    const { nodes, W, H, pos } = mapLayout();
    const done = new Set(run.path);
    const byId = {}; nodes.forEach(n => byId[n.id] = n);
    // everything still reachable from here, so the rest of the map can fade back
    const reach = new Set(avail), q = avail.slice();
    while (q.length) { const n = byId[q.shift()]; if (n) for (const t of n.next) if (!reach.has(t)) { reach.add(t); q.push(t); } }
    const here = [...run.path].reverse().find(id => byId[id]);
    const st = (n) => done.has(n.id) ? 'done' : avail.includes(n.id) ? 'open' : reach.has(n.id) ? 'locked' : 'locked far';
    const edges = [];
    for (const n of nodes) for (const t of n.next) {
      const a = pos[n.id], b = pos[t];
      const walked = done.has(n.id) && done.has(t), next = n.id === here && avail.includes(t), ahead = reach.has(n.id) && reach.has(t);
      edges.push(`<path d="M${a.x},${a.y - 26} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y + (byId[t].type === 'boss' ? 42 : 26)}" class="${walked ? 'walked' : next ? 'next' : ahead ? 'ahead' : ''}"/>`);
    }
    const A0 = C().ACTS[run.act];
    const node = C().nodeOf(run, sel);
    const icon = (n) => n.type === 'boss' ? (G.SCEN_ART[n.scen] || '👑').slice(0, 2) : C().NODE_TYPES[n.type].icon;
    $('#campaign').innerHTML = `
      <div class="cp mapview">
        ${head(A0.name, `${A0.sub} · ${run.partyName} · ${(A().DIFF[run.difficulty] || A().DIFF.normal).label}`)}
        <div class="cp-body">
          ${partyAside()}
          <main class="cp-mapwrap"><div class="cp-map act${run.act + 1}" style="width:${W}px;height:${H}px">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges.join('')}</svg>
            <div class="cp-cart"><small>${A0.sub}</small>${esc(A0.name)}</div>
            ${nodes.map(n => `<button class="cp-node t-${n.type} ${st(n)} ${n.id === sel ? 'sel' : ''} ${n.id === here ? 'here' : ''}" data-node="${n.id}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px" ${st(n) === 'open' ? '' : 'tabindex="-1"'} aria-label="${esc(nodeLabel(n))}${st(n) === 'done' ? ', visited' : ''}"><span class="cp-ic">${icon(n)}</span>${st(n) === 'done' ? '<span class="cp-tick">✓</span>' : ''}${n.id === here ? '<span class="cp-token" title="Your party is here">⚑</span>' : ''}${n.type === 'boss' ? `<span class="cp-lbl">${esc(nodeLabel(n))}<small>Act boss</small></span>` : `<span class="cp-tip">${esc(nodeLabel(n))}${st(n) === 'open' ? '<small>Click to choose</small>' : st(n) === 'done' ? '<small>Visited</small>' : st(n).includes('far') ? '<small>Out of reach</small>' : ''}</span>`}</button>`).join('')}
          </div>
          <div class="cp-legend">${Object.entries(C().NODE_TYPES).filter(([k]) => k !== 'boss').map(([k, t]) => `<span class="lg t-${k}"><i>${t.icon}</i>${t.name}</span>`).join('')}</div></main>
          <aside class="cp-detail">
            <h3 class="cp-h3">${avail.length > 1 ? `Next stop <span class="muted">${avail.length} roads</span>` : 'Next stop'}</h3>
            ${avail.length > 1 ? `<div class="cp-forks">${avail.map(id => { const n = byId[id]; return `<button class="cp-fork t-${n.type} ${id === sel ? 'on' : ''}" data-pick="${id}" title="${esc(nodeLabel(n))}"><i>${icon(n)}</i><span>${esc(nodeLabel(n).replace(/^Elite: /, ''))}<small>${n.type === 'boss' ? 'Act boss' : C().NODE_TYPES[n.type].name}</small></span></button>`; }).join('')}</div>` : ''}
            ${node ? nodeDetail(node) : ''}
            <p class="muted fine-c">${esc(A0.blurb)}</p>
            <button class="btn sm ghost danger cp-abandon" id="cp-abandon">Abandon run</button>
          </aside>
        </div>
      </div>`;
    wireHead();
    $('#cp-abandon').onclick = async () => {
      if (!await G.Dialog.confirm('Abandon this campaign? It goes into the Record of Heroes as abandoned.', 'Abandon run')) return;
      C().abandon(run); const rec = run.record; run = null; overScreen(rec);
    };
    const pick = (id) => { if (id === sel) return; sel = id; G.Audio.play('click'); mapScreen(); };
    document.querySelectorAll('.cp-node.open').forEach(b => { b.onclick = () => pick(b.dataset.node); b.ondblclick = () => go(b.dataset.node); });
    document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pick(b.dataset.pick));
    // keep the next step of the path in view
    const wrap = $('.cp-mapwrap'), cur = sel && $(`[data-node="${sel}"]`);
    if (wrap && cur) wrap.scrollTop = Math.max(0, cur.offsetTop - wrap.clientHeight * 0.6);
    const f = $('#cp-go'); if (f) f.onclick = () => go(sel);
  }
  const rewards = (list) => `<div class="cp-rewards">${list.map(([ic, t]) => `<span><i>${ic}</i>${t}</span>`).join('')}</div>`;
  function nodeDetail(n) {
    const T = C().NODE_TYPES[n.type];
    const btn = (label) => `<button class="btn big cp-go" id="cp-go">${label}</button>`;
    const card = (icon, cls, eyebrow, title, sub, body) => `<div class="cp-nodecard t-${n.type}">${M().crest(icon, cls)}<small class="cp-eyebrow">${eyebrow}</small><h3>${title}</h3>${sub ? `<div class="scen-sub">${sub}</div>` : ''}${body}</div>`;
    if (n.type === 'boss' || (n.type === 'elite' && n.scen)) {
      const p = C().fightPreview(run, n.id), boss = n.type === 'boss';
      return card((G.SCEN_ART[p.scen.id] || '👑').slice(0, 2), boss ? 'gold' : 'red', boss ? '👑 Act boss' : '💀 Elite', esc(p.scen.name), `Level ${p.level}`,
        rewards(boss ? [['🛏', 'Full rest'], ['⚙', 'Pick 1 of 3 gear'], ['🪙', 'Gold']] : [['⚙', 'Pick 1 of 2 gear'], ['🪙', 'Gold'], ['🧪', 'Consumable']])
        + `<p class="cp-flavor">${esc(p.scen.blurb)}</p><ul class="cp-tips">${p.scen.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`) + btn('Enter battle ▶');
    }
    if (n.type === 'combat' || n.type === 'elite') {
      const F = G.Encounters.FACTIONS[n.faction], elite = n.type === 'elite';
      return card(T.icon, elite ? 'red' : '', elite ? 'Elite fight' : 'Fight', esc(F.name), `Level ${run.level} · ${elite ? 'a powerful foe and its retinue' : 'a fight on the road'}`,
        rewards(elite ? [['⚙', 'Pick 1 of 2 gear'], ['🪙', 'Gold'], ['✦', '2 XP']] : [['🪙', 'Gold'], ['🧪', 'Consumable'], ['✦', '1 XP']])
        + `<ul class="cp-tips">${F.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`) + btn('Enter battle ▶');
    }
    const about = {
      event: ['Something waits on the road: a stranger, a shrine, a choice. Most are settled by skill checks; a few turn into fights.', [['🎲', 'Skill checks'], ['❔', 'Anything']]],
      shop: ['A travelling merchant with consumables, magic gear and a few services, including the Rite of Return for the fallen.', [['⚙', 'Gear'], ['🧪', 'Consumables'], ['✚', 'Healing']]],
      rest: ['A safe campfire. Recover your wounds, regain your daily powers, or forage for supplies. You can only pick one.', [['🛏', 'Heal'], ['🕯', 'Dailies'], ['🎒', 'Supplies']]],
      treasure: ['A chest, half buried. Magic gear and gold for whoever opens it, if the trap doesn\'t get them first.', [['⚙', 'Gear'], ['🪙', 'Gold']]],
    }[n.type];
    const crestCls = { event: 'violet', shop: 'gold', rest: 'ember', treasure: 'green' }[n.type] || '';
    return card(T.icon, crestCls, 'On the road', esc(T.name), '', rewards(about[1]) + `<p class="cp-flavor">${esc(about[0])}</p>`) + btn('Go ▶');
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
      const todo = choices.some(c => !c.pick);
      const lv = lvUp ? `<div class="cp-lvup ${todo ? 'todo' : ''}"><div class="cp-lvh"><b>Level ${cp.to}</b> <span class="good">+${Math.max(0, s.maxHp - (before ? before.maxHp : s.maxHp))} max HP</span>${todo ? '<em>Choose</em>' : choices.length ? '<em class="ok">✓</em>' : ''}</div>
        ${choices.map((c, k) => c.kind === 'power'
          ? `<div class="cp-pick"><small>New ${SLOT_LABEL[c.slot] || 'power'}</small><div class="cp-pows">${c.options.map(id => { const P = G.Build.POWERS[id], d = G.Build.describe(P); return `<button class="cp-pow k-${P.kind} ${id === c.pick ? 'on' : ''}" data-pick="${i}:${k}:${id}" title="${describe(id)}"><b>${esc(P.name)}</b><small>${esc(P.text || d.slice(1).join(' · '))}</small></button>`; }).join('')}</div></div>`
          : `<div class="cp-pick"><small>New feat</small><select data-feat="${i}:${k}"><option value="">Choose a feat…</option>${c.options.map(id => `<option value="${id}" ${c.pick === id ? 'selected' : ''}>${esc(G.Build.FEATS[id].name)}</option>`).join('')}</select>${c.pick ? `<p class="muted">${esc(G.Build.FEATS[c.pick].text)}</p>` : ''}</div>`).join('')}
        ${!choices.length && gained.length ? `<div class="cp-pick"><small>New</small> ${gained.map(p => esc(p.name)).join(', ')}</div>` : ''}</div>` : '';
      const heal = Math.min(s.surgeValue, s.maxHp - s.hp);
      const rest = cp.actDone ? '' : `<div class="cp-rest"><button class="btn sm" data-surge="${i}" ${s.surges > 0 && s.hp < s.maxHp ? '' : 'disabled'}>${s.hp >= s.maxHp ? 'Unhurt' : s.surges ? `✚ Spend a surge <b class="good">+${heal} HP</b>` : 'No surges left'}</button>${s.hp === 0 ? `<small class="warn">${s.surges ? 'Unconscious: spend a surge to wake.' : 'Unconscious: wakes at 1 HP.'}</small>` : ''}</div>`;
      return heroCard(h, i, lv + rest);
    }).join('');
    const found = cp.found.map((f, k) => `<div class="spoil" style="animation-delay:${0.1 + k * 0.08}s">${f.item && G.Items[f.item] ? `<i>${G.Items[f.item].icon}</i>` : ''}<span><b>${esc(G.Items[f.item].name)}</b><small>${f.hero != null ? `→ ${esc(run.heroes[f.hero].build.name)}` : `Packs full: sold for ${f.sold} gold`}</small></span></div>`);
    const gearPick = cp.gear.length ? `<section class="cp-loot ${cp.gearTaken ? 'taken' : 'open'}"><h4>${cp.gearTaken ? 'Gear taken' : `Choose one of ${cp.gear.length === 2 ? 'two' : 'three'} pieces of gear`}</h4><div class="cp-cards">${cp.gear.map(id => gearCard(id, cp.gearTaken ? (cp.gearTaken === id ? '<span class="good">✓ Taken</span>' : '<span class="muted">Left behind</span>') : `<button class="btn" data-take="${id}">Take</button>`, '', cp.gearTaken ? (cp.gearTaken === id ? 'chosen' : 'left') : 'pickable')).join('')}</div>${cp.gearTaken ? '<p class="muted fine-c">New gear goes to whoever gains the most from it. Swap it around under 🎒 Gear & packs.</p>' : ''}</section>` : '';
    const needGear = cp.gear.length && !cp.gearTaken, needFeat = C().unfilledChoices(run);
    const blocked = needFeat || needGear;
    const final = run.outcome === 'victory';
    const hurt = run.heroes.some(h => { if (h.dead) return false; const s = C().status(run, h); return s.hp < s.maxHp && s.surges > 0; });
    const title = cp.actDone ? (final ? 'Hollowmere is saved!' : `Act ${ROMAN[run.act]} complete`) : 'Camp';
    const intro = cp.actDone
      ? (final ? 'The last boss falls. Claim your victory.' : `<b>An extended rest:</b> every hero is back to full HP, healing surges and daily powers. Next: Act ${ROMAN[run.act + 1]}, ${esc(C().ACTS[run.act + 1].name)}.`)
      : 'A short rest. Spend healing surges to recover; encounter powers, Second Wind and Action Points come back for the next fight. <b>Daily powers stay spent</b> until a rest site or the end of the act.';
    $('#campaign').innerHTML = `
      <div class="cp camp">
        ${head(title, `After ${last.name}`)}
        <div class="camp-body">
          <section class="camp-banner">${M().crest(cp.actDone ? '👑' : '🔥', cp.actDone ? 'gold' : 'ember')}<div><h2>${cp.actDone ? esc(final ? 'Hollowmere is saved!' : `${C().ACTS[run.act].name} is behind you`) : 'You make camp'}</h2><p>${intro}</p></div></section>
          <section class="camp-spoils"><h4>Spoils</h4><div class="spoils"><div class="spoil gold"><i>🪙</i><span><b>+${cp.gold} gold</b><small>${run.gold} in the purse</small></span></div>${found.join('')}</div></section>
          ${gearPick}
          ${lvUp ? `<div class="camp-lvl"><span>✦</span> The party reaches <b>Level ${cp.to}</b>${needFeat ? ': choose new powers and feats below' : ''}</div>` : ''}
          <section><h4>The party</h4><div class="camp-heroes">${cards}</div></section>
        </div>
        <footer class="cp-foot"><span class="cp-foot-note ${blocked ? 'warn' : ''}">${needGear ? 'Take a piece of gear to move on.' : needFeat ? 'Choose a feat for every hero to move on.' : cp.actDone ? '' : hurt ? 'Wounds carry into the next fight.' : 'Everyone is fit to travel.'}</span>
          ${cp.actDone ? '' : `<button class="btn" id="cp-rest" ${hurt ? '' : 'disabled'} title="Spend surges until everyone is near full HP">✚ Rest everyone</button>`}<button class="btn big" id="cp-break" ${blocked ? `disabled title="${needGear ? 'Take a piece of gear first' : 'Choose a feat for every hero first'}"` : ''}>${final ? 'Claim victory ▶' : cp.actDone ? `On to Act ${ROMAN[run.act + 1]} ▶` : 'Break camp ▶'}</button></footer>
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
  const TIER = ['', 'Common', 'Uncommon', 'Rare'];
  function gearCard(id, action = '', extra = '', cls = '') {
    const g = G.Gear[id];
    return `<div class="cp-card gear t${g.tier} ${cls}"><div class="cp-card-top"><span class="cp-card-ic">${g.icon}</span><span><b>${esc(g.name)}</b><small>${esc(G.GEAR_SLOTS[g.slot].name)} · <span class="tier t${g.tier}">${TIER[g.tier]}</span></small></span></div><p>${esc(g.text)}</p>${g.flavor ? `<p class="muted flavor">${esc(g.flavor)}</p>` : ''}${extra}<div class="cp-card-act">${action}</div></div>`;
  }
  function itemCard(id, action = '', extra = '') {
    const it = G.Items[id];
    return `<div class="cp-card item"><div class="cp-card-top"><span class="cp-card-ic">${it.icon}</span><span><b>${esc(it.name)}</b><small>${{ potion: 'Potion · minor action', throwable: 'Throwable · standard action', gear: 'Field gear · standard action' }[it.cat] || ''}</small></span></div><p>${esc(it.power.text || '')}</p>${extra}<div class="cp-card-act">${action}</div></div>`;
  }

  // ---------- events ----------
  function eventScreen(rolled) {
    A().show('campaign');
    const ev = run.event, E0 = G.Events[ev.id], res = ev.result;
    const choiceBtn = (c, k) => {
      const open = C().choiceOpen(run, c);
      let info = '', odds = '';
      if (c.check) { const o = C().checkOdds(run, c.check.skill, c.check.dc), pc = Math.round(o.chance * 100); odds = `<span class="ev-odds ${pc >= 70 ? 'good' : pc >= 45 ? 'ok' : 'bad'}" title="Chance of success">${pc}%</span>`; info = `🎲 ${G.Skills[c.check.skill].name} DC ${o.dc} · ${esc(run.heroes[o.hero].build.name)} +${o.bonus}`; }
      else if (c.luck) { odds = '<span class="ev-odds luck" title="Pure chance">?</span>'; info = 'A gamble'; }
      if (c.cost && c.cost.gold) info = `🪙 ${c.cost.gold}${info ? ' · ' + info : ''}`;
      return `<button class="btn cp-choice" data-choice="${k}" ${open.ok ? '' : 'disabled'}>${odds || '<span class="ev-odds sure" title="No roll">✓</span>'}<span><b>${esc(c.label)}</b>${info ? `<small>${info}</small>` : ''}${open.ok ? '' : `<small class="warn">${esc(open.why)}</small>`}</span></button>`;
    };
    let body;
    if (!res) body = `<div class="cp-choices">${E0.choices.map(choiceBtn).join('')}</div>`;
    else {
      const ck = res.check;
      // a fresh skill check rolls a d20 on screen before the outcome shows
      const die = ck ? `<div class="ev-check ${rolled ? 'rolling' : ''} ${ck.ok ? 'ok' : 'fail'}"><div class="ev-die" data-roll="${ck.roll}"><span>${ck.roll}</span></div><div class="ev-sum"><b>${ck.total}</b> <small>vs DC</small> <b>${ck.dc}</b><em>${ck.ok ? 'Success' : 'Failure'}</em></div></div>` : '';
      body = `${die}<div class="cp-result ${ck && rolled ? 'reveal' : ''}">
        ${ck ? `<p class="cp-roll ${ck.ok ? 'good' : 'bad'}">${esc(run.heroes[ck.hero].build.name)} rolls ${G.Skills[ck.skill].name}: d20 ${ck.roll} + ${ck.bonus} = ${ck.total} vs DC ${ck.dc}</p>` : ''}
        <p>${esc(res.text)}</p>
        ${res.lines.length ? `<ul class="cp-lines">${res.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="modal-btns">${ev.fight ? '<button class="btn big" id="ev-fight">To battle ▶</button>' : '<button class="btn big" id="ev-done">Continue ▶</button>'}</div></div>`;
    }
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head(E0.title, `${C().ACTS[run.act].sub} · ${C().ACTS[run.act].name} · Event`)}
        <div class="cp-body two">${partyAside()}${scene(E0.icon, 'violet', E0.title, E0.text, body)}</div>
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
    const price = (p) => `<span class="cp-price ${run.gold >= p ? '' : 'short'}">🪙 ${p}</span>`;
    const roomy = C().living(run).some(h => h.pack.length < C().PACK_MAX);
    const items = s.items.map((it, k) => itemCard(it.id, it.sold ? '<span class="muted">Sold</span>' : `${price(it.price)} <button class="btn sm" data-buy="item:${k}" ${run.gold >= it.price && roomy ? '' : 'disabled'} ${roomy ? '' : 'title="Every pack is full"'}>Buy</button>`)).join('');
    const gear = s.gear.map((it, k) => gearCard(it.id, it.sold ? '<span class="muted">Sold</span>' : `${price(it.price)} <button class="btn sm" data-buy="gear:${k}" ${run.gold >= it.price ? '' : 'disabled'}>Buy</button>`, '', it.sold ? 'sold' : '')).join('');
    const dead = run.heroes.map((h, i) => h.dead ? i : null).filter(i => i != null);
    const services = s.services.map((sv, k) => {
      const ok = !sv.used && run.gold >= sv.price;
      const btn = sv.id === 'raise'
        ? (dead.length ? dead.map(i => `<button class="btn sm" data-buy="service:${k}:${i}" ${ok ? '' : 'disabled'}>Raise ${esc(run.heroes[i].build.name)}</button>`).join(' ') : '<span class="muted">Nobody to raise</span>')
        : `<button class="btn sm" data-buy="service:${k}" ${ok ? '' : 'disabled'}>Pay</button>`;
      return `<div class="cp-card service ${sv.used ? 'used' : ''}"><div class="cp-card-top"><span class="cp-card-ic">${sv.id === 'raise' ? '🕊' : '✚'}</span><span><b>${esc(sv.name)}</b><small>Service</small></span></div><p>${esc(sv.text)}</p><div class="cp-card-act">${sv.used ? '<span class="muted">Done</span>' : `${price(sv.price)} ${btn}`}</div></div>`;
    }).join('');
    const sell = run.stash.length ? run.stash.map((id, k) => `<div class="cp-sell">${G.Gear[id].icon} <span>${esc(G.Gear[id].name)}</span> <button class="btn sm ghost" data-sell="${k}">Sell for 🪙 ${C().sellPrice(id)}</button></div>`).join('') : '<p class="muted">Your stash is empty. Unequip gear under 🎒 Gear & packs to sell it here.</p>';
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('The Merchant', `${C().ACTS[run.act].sub} · ${C().ACTS[run.act].name} · Shop`)}
        <div class="cp-body two">${partyAside()}
          <main class="cp-shop">
            <div class="shop-banner">${M().crest('💰', 'gold')}<div><p class="cp-text">"Come in, come in! Everything's priced to move, much like yourselves."</p><span class="shop-purse">You have <b>🪙 ${run.gold}</b></span></div></div>
            ${msg ? `<p class="shop-msg warn">${esc(msg)}</p>` : ''}
            <h4>Magic gear</h4><div class="cp-cards">${gear}</div>
            <h4>Consumables <small class="muted">go into the emptiest pack</small></h4><div class="cp-cards">${items}</div>
            <h4>Services</h4><div class="cp-cards">${services}</div>
            <h4>Sell from your stash</h4><div class="cp-sells">${sell}</div>
          </main>
        </div>
        <footer class="cp-foot"><span class="cp-foot-note">Nothing here carries over once you leave.</span><button class="btn big" id="sh-done">Leave the shop ▶</button></footer>
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
  // what each rest option would do for this party right now
  function restGain(k) {
    const L = C().living(run);
    if (k === 'recover') {
      let hp = 0, su = 0; for (const h of L) { const s = C().status(run, h); hp += s.maxHp - s.hp; su += Math.min(2, h.surgesSpent); }
      return hp || su ? `+${hp} HP${su ? ` and +${su} surge${su === 1 ? '' : 's'}` : ''} across the party` : null;
    }
    if (k === 'meditate') { const n = L.reduce((a, h) => a + C().status(run, h).dailies.filter(d => d.used).length, 0); return n ? `${n} spent daily power${n === 1 ? '' : 's'} back` : null; }
    if (k === 'scavenge') { const n = L.filter(h => h.pack.length < C().PACK_MAX).length; return n ? `${n} hero${n === 1 ? '' : 'es'} with room in their pack` : null; }
    if (k === 'vigil') { const d = run.heroes.filter(h => h.dead); return d.length ? `${d.map(h => esc(h.build.name)).join(' or ')} can return` : null; }
    return null;
  }
  function restScreen() {
    A().show('campaign');
    const R = run.rest, opts = C().REST_OPTIONS;
    const body = R.done ? `<div class="cp-result"><p><b>${opts[R.done].icon} ${esc(opts[R.done].name)}.</b> ${esc(opts[R.done].text)}</p>
        ${R.found && R.found.length ? `<ul class="cp-lines">${R.found.map(f => f.raised != null ? `<li>${esc(run.heroes[f.raised].build.name)} returns to the living.</li>` : `<li>${itemChip(f.item)} ${esc(G.Items[f.item].name)} → ${esc(run.heroes[f.hero].build.name)}</li>`).join('')}</ul>` : ''}
        <div class="modal-btns"><button class="btn big" id="rs-done">Continue ▶</button></div></div>`
      : `<div class="rest-opts">${Object.entries(opts).filter(([, o]) => !o.need || o.need(run)).map(([k, o]) => { const g = restGain(k); return `<button class="rest-opt ${g ? '' : 'meh'}" data-rest="${k}"><span class="rest-ic">${o.icon}</span><b>${esc(o.name)}</b><small>${esc(o.text)}</small><em class="${g ? 'good' : 'muted'}">${g || 'Nothing to gain right now'}</em></button>`; }).join('')}</div>`;
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('Rest Site', `${C().ACTS[run.act].sub} · ${C().ACTS[run.act].name} · Campfire`)}
        <div class="cp-body two">${partyAside()}${scene('🔥', 'ember', 'A Safe Campfire', 'For once, nothing is trying to kill you. There is time for one thing before you move on.', body)}</div>
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
      const o = C().checkOdds(run, 'thievery', 'easy'), pc = Math.round(o.chance * 100);
      body = `<div class="cp-choices"><button class="btn cp-choice" id="tr-open"><span class="ev-odds ${pc >= 70 ? 'good' : pc >= 45 ? 'ok' : 'bad'}">${pc}%</span><span><b>Open the chest</b><small>🎲 Thievery DC ${o.dc} to spot the trap · ${esc(run.heroes[o.hero].build.name)} +${o.bonus}</small></span></button></div>`;
    } else {
      const r = T.opened, ck = r.check;
      body = `<div class="cp-result">${ck ? `<p class="cp-roll ${ck.ok ? 'good' : 'bad'}">${esc(run.heroes[ck.hero].build.name)} rolls Thievery: d20 ${ck.roll} + ${ck.bonus} = ${ck.total} vs DC ${ck.dc}: <b>${ck.ok ? 'trap disarmed' : 'the trap goes off'}</b>${r.trap ? ` (${r.trap} damage)` : ''}</p>` : ''}
        <div class="spoils"><div class="spoil gold"><i>🪙</i><span><b>+${r.gold} gold</b><small>${run.gold} in the purse</small></span></div></div><div class="cp-cards one">${gearCard(r.gear)}</div>
        <div class="modal-btns"><button class="btn big" id="tr-done">Continue ▶</button></div></div>`;
    }
    $('#campaign').innerHTML = `
      <div class="cp">
        ${head('Treasure', `${C().ACTS[run.act].sub} · ${C().ACTS[run.act].name} · Chest`)}
        <div class="cp-body two">${partyAside()}${scene('🧰', 'green', 'A Half-Buried Chest', 'Iron-banded oak, green with age. The lock is intact. So, probably, is whatever the last owner left to guard it.', body)}</div>
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
      const hs = run.heroes.map((h, i) => h.dead ? '' : `<div class="gm-hero cls-${h.build.cls}"><h4>${M().hexpor(h.build.cls, { size: 'sm' })}<span>${esc(h.build.name)}<small>${heroLine(h.build)}</small></span></h4>
        ${Object.entries(G.GEAR_SLOTS).map(([sl, S]) => { const id = h.gear[sl]; return `<div class="gm-slot ${id ? `t${G.Gear[id].tier}` : 'empty'}" title="${esc(id ? gearTip(id) : S.hint)}"><span>${id ? G.Gear[id].icon : S.icon}</span><div><b>${id ? esc(G.Gear[id].name) : `No ${S.name.toLowerCase()}`}</b><small>${esc(id ? G.Gear[id].text : S.hint)}</small></div>${id ? `<button class="btn sm ghost" data-unequip="${i}:${sl}" title="Move to the stash">Remove</button>` : ''}</div>`; }).join('')}
        ${(h.boons || []).length ? `<div class="gm-boons">${h.boons.map(b => `<span class="cp-boon ${G.Boons[b].curse ? 'curse' : ''}" title="${esc(G.Boons[b].text)}">${G.Boons[b].icon} ${esc(G.Boons[b].name)}</span>`).join('')}</div>` : ''}
        <div class="gm-pack"><small>Pack ${h.pack.length}/${C().PACK_MAX}</small>${h.pack.map((id, k) => `<div class="gm-item" title="${esc(itemTip(id))}"><span>${G.Items[id].icon} ${esc(G.Items[id].name)}</span> <select data-give="${i}:${k}" aria-label="Give ${esc(G.Items[id].name)} to"><option value="">Give to…</option>${run.heroes.map((o, j) => !o.dead && j !== i && o.pack.length < C().PACK_MAX ? `<option value="${j}">${esc(o.build.name)}</option>` : '').join('')}</select></div>`).join('') || '<div class="muted">Empty</div>'}</div>
      </div>`).join('');
      const stash = run.stash.length ? run.stash.map((id, k) => `<div class="gm-stash-i">${gearCard(id, `<small class="muted">Equip on</small> ${run.heroes.map((h, i) => h.dead ? '' : `<button class="btn sm ghost" data-equip="${i}:${k}">${esc(h.build.name.split(' ')[0])}</button>`).join('')}`)}</div>`).join('') : '<p class="muted">Nothing in the stash. Gear you remove, or that has nobody to wear it, waits here.</p>';
      $('#gm', m).innerHTML = `<div class="gm-head"><h3>Gear & packs</h3><span class="tb-pill gold">🪙 ${run.gold}</span></div><div class="gm-heroes">${hs}</div><h4 class="gm-sh">Stash <small class="muted">${run.stash.length} item${run.stash.length === 1 ? '' : 's'}</small></h4><div class="cp-cards">${stash}</div><div class="modal-btns"><button class="btn" data-close>Done</button></div>`;
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
    const win = rec.outcome === 'victory';
    $('#campaign').innerHTML = `
      <div class="cp over"><div class="over-inner ${rec.outcome}">
        ${M().crest(win ? '👑' : rec.outcome === 'defeat' ? '☠' : '⚑', win ? 'gold' : rec.outcome === 'defeat' ? 'red' : '')}
        <h2 class="${cls}">${win ? 'Hollowmere is saved!' : rec.outcome === 'defeat' ? 'The party has fallen' : 'Run abandoned'}</h2>
        <p class="muted">${esc(rec.partyName)} · ${label} · ${runLine(rec)}</p>
        ${recordHeroes(rec)}
        <div class="modal-btns"><button class="btn big" id="ov-rec">📜 Record of Heroes</button><button class="btn ghost" id="ov-menu">Main menu</button></div>
      </div></div>`;
    $('#ov-rec').onclick = record;
    $('#ov-menu').onclick = A().menu;
  }
  const runLine = (r) => `${r.acts ? `Act ${ROMAN[(r.act || 1) - 1]} of ${ROMAN[r.acts - 1]}${r.actName ? ` (${esc(r.actName)})` : ''} · ` : ''}won ${r.won} fight${r.won === 1 ? '' : 's'}${r.reached && r.outcome !== 'victory' ? ` · ${r.outcome === 'defeat' ? 'fell at' : 'last fought at'} ${esc(r.reached)}` : ''}`;
  function recordHeroes(r) {
    return `<div class="rec-heroes">${r.heroes.map(h => `<div class="rec-h ${h.fell ? 'fallen' : ''} ${r.mvp === h.name ? 'mvp' : ''} cls-${h.cls}">${M().hexpor(h.cls, { size: 'sm', dead: !!h.fell })}<div><b>${esc(h.name)}</b>${r.mvp === h.name ? ' <span class="mvp-b">★ MVP</span>' : ''}<small>${G.Build.CLASSES[h.cls].name} · ${h.kills} kills · ${h.dmg} dmg</small>${h.fell ? `<small class="bad">☠ Fell at ${esc(h.fellAt)}</small>` : '<small class="good">Survived</small>'}</div></div>`).join('')}</div>`;
  }

  // ---------- Record of Heroes ----------
  function record() {
    A().show('record');
    const list = C().records();
    const wins = list.filter(r => r.outcome === 'victory').length;
    const date = (t) => { try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
    const stat = (v, l) => `<div><b>${v}</b><small>${l}</small></div>`;
    const best = list.reduce((a, r) => Math.max(a, r.act || 0), 0);
    $('#record').innerHTML = `
      <div class="rec">
        ${M().topbar({ backId: 'rec-back', eyebrow: 'Every run, won or lost', title: 'Record of Heroes', right: list.length ? '<button class="btn ghost sm danger" id="rec-clear">Clear record</button>' : '' })}
        <div class="rec-list">${list.length ? `<div class="rec-stats">${stat(list.length, `run${list.length === 1 ? '' : 's'}`)}${stat(wins, `victor${wins === 1 ? 'y' : 'ies'}`)}${stat(best ? `Act ${ROMAN[best - 1]}` : '—', 'furthest')}${stat(list.reduce((a, r) => a + (r.totals.kills || 0), 0), 'foes slain')}</div>` + list.map(r => { const [label, cls] = OUTCOME[r.outcome] || ['?', 'muted']; const D = A().DIFF[r.difficulty]; return `
          <article class="rec-run ${r.outcome}">
            <div class="rec-top">${M().crest(r.outcome === 'victory' ? '👑' : r.outcome === 'defeat' ? '☠' : '⚑', r.outcome === 'victory' ? 'gold' : r.outcome === 'defeat' ? 'red' : '')}<div><span class="rec-badge ${cls}">${label}</span><b>${esc(r.partyName)}</b><div class="rec-meta muted">${esc(r.map)} · ${D ? D.label : ''} · ${date(r.ended || r.started)}</div></div></div>
            <div class="rec-sum">${runLine(r)} · reached Level ${r.level}${r.rounds ? ` · ${r.rounds} rounds` : ''} · ${r.totals.kills || 0} kills${r.gold != null ? ` · ${r.gold} gold` : ''}</div>
            ${recordHeroes(r)}
          </article>`; }).join('') : `<div class="rec-empty">${M().crest('📜')}<h3>No runs yet</h3><p class="muted">Every campaign, won or lost, is written down here with its heroes and its fallen.</p><button class="btn big" id="rec-start">Start a campaign ▶</button></div>`}</div>
      </div>`;
    $('#rec-back').onclick = A().menu;
    const st = $('#rec-start'); if (st) st.onclick = start;
    const c = $('#rec-clear'); if (c) c.onclick = async () => { if (await G.Dialog.confirm('Erase every run from the Record of Heroes? This can\'t be undone.', 'Erase')) { C().clearRecords(); record(); } };
  }

  G.CampaignUI = { start, resume, record, mapScreen, campScreen, eventScreen, shopScreen, restScreen, treasureScreen, gearModal, get run() { return run; } };
})();
