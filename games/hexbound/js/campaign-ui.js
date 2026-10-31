// Campaign screens: party creation hand-off, the scenario map, camp (level up + short rest), the end of a run
// and the Record of Heroes. Run state and rules live in campaign.js.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const C = () => G.Campaign, A = () => G.App;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NODE_ICON = { goblins: '🌲', barrow: '🪦', bandits: '🔥', golem: '🎂' };
  const SLOT_LABEL = { util2: 'utility power', enc3: 'encounter attack', daily5: 'daily attack', enc1: 'encounter attack', daily1: 'daily attack', atwill: 'at-will attack' };
  const OUTCOME = { victory: ['Victory', 'good'], defeat: ['Defeat', 'bad'], abandoned: ['Abandoned', 'muted'] };
  let run = null, sel = null;

  const heroLine = (b) => `${G.Build.ANCESTRIES[b.ancestry].name} ${G.Build.CLASSES[b.cls].subs[b.sub].name} ${G.Build.CLASSES[b.cls].name}`;
  const itemChip = (id) => { const it = G.Items[id]; return it ? `<span class="cp-item" title="${esc(it.name)}: ${esc(it.power.text || '')}">${it.icon}</span>` : ''; };
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
      <p><b>${esc(party.name)}</b> sets out on <b>${esc(C().MAPS.hollowmere.name)}</b>. ${esc(C().MAPS.hollowmere.blurb)}</p>
      ${bad.length ? `<p class="bad">${bad.length === 1 ? 'One hero has' : bad.length + ' heroes have'} build problems (${esc(bad.map(h => h.name).join(', '))}). You can still go.</p>` : ''}
      <div class="cp-diff">${Object.entries(D).map(([k, d]) => `<label class="radio ${diff === k ? 'on' : ''}"><input type="radio" name="cpdiff" value="${k}" ${diff === k ? 'checked' : ''}>${d.label}<small>${d.desc}</small></label>`).join('')}</div>
      <ul class="cp-rules"><li>Wounds, spent healing surges, used daily powers and items carry from fight to fight.</li><li>After each victory you level up and take a short rest: spend surges to heal. Encounter powers, Second Wind and Action Points come back every fight.</li><li>A hero who dies stays dead for the rest of the run.</li></ul>
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
    if (run.stage === 'camp') campScreen(); else mapScreen();
  }

  // ---------- party panel (map and camp) ----------
  function heroCard(h, i, extra = '') {
    const b = h.build;
    if (h.dead) return `<div class="cp-hero fallen cls-${b.cls}"><div class="cp-h"><span class="ico ic-${b.cls}">${G.ICON[b.cls]}</span><b>${esc(b.name)}</b></div><small>${heroLine(b)}</small><div class="cp-fell">☠ Fell at ${esc(h.fellAt || '?')}</div></div>`;
    const s = C().status(run, h);
    const pct = Math.round(s.hp / s.maxHp * 100);
    return `<div class="cp-hero cls-${b.cls}" data-hero="${i}">
      <div class="cp-h"><span class="ico ic-${b.cls}">${G.ICON[b.cls]}</span><b>${esc(b.name)}</b><span class="cp-lv">Lv ${run.level}</span></div>
      <small>${heroLine(b)}</small>
      <div class="cp-bar ${pct <= 50 ? 'bloodied' : ''}"><i style="width:${pct}%"></i><span>${s.hp} / ${s.maxHp} HP</span></div>
      <div class="cp-row"><span title="Healing surges left: each one heals ${s.surgeValue} HP during a short rest">✚ ${s.surges}/${s.maxSurges} surges</span><span class="cp-pack" title="Pack">${h.pack.map(itemChip).join('') || '<span class="muted">empty pack</span>'}</span></div>
      <div class="cp-dailies">${s.dailies.map(d => `<span class="cp-daily ${d.used ? 'used' : ''}" title="Daily power: ${d.used ? 'spent for the rest of the run' : 'ready'}">${esc(d.name)}</span>`).join('')}</div>
      ${extra}
    </div>`;
  }

  // ---------- the map ----------
  const ROW_H = 150, PAD = 90, COL_W = 150;
  function mapLayout() {
    const nodes = C().mapOf(run).nodes;
    const rows = Math.max(...nodes.map(n => n.row)) + 1;
    const cols = Math.max(...nodes.map(n => n.col)) + 1;
    const W = Math.max(480, cols * COL_W + 300), H = rows * ROW_H + PAD * 2;
    const pos = {};
    for (const n of nodes) {
      const inRow = nodes.filter(o => o.row === n.row).length;
      pos[n.id] = { x: W / 2 + (n.col - (inRow - 1) / 2) * COL_W, y: H - PAD - n.row * ROW_H };
    }
    return { nodes, W, H, pos };
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
      edges.push(`<path d="M${a.x},${a.y - 34} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y + 34}" class="${walked ? 'walked' : ''}"/>`);
    }
    const first = nodes.filter(n => n.row === 0), last = nodes.filter(n => !n.next.length);
    for (const n of first) edges.push(`<path d="M${W / 2},${H - 48} L${pos[n.id].x},${pos[n.id].y + 34}" class="walked"/>`);
    for (const n of last) edges.push(`<path d="M${pos[n.id].x},${pos[n.id].y - 34} L${W / 2},62" class="${done.has(n.id) ? 'walked' : ''}"/>`);
    const node = C().nodeOf(run, sel), scen = node && C().scenOf(node.scen);
    const D = A().DIFF[run.difficulty] || A().DIFF.normal;
    $('#campaign').innerHTML = `
      <div class="cp">
        <header class="pb-head"><button class="btn ghost" id="cp-menu">← Menu</button><h2>${esc(C().mapOf(run).name)}</h2>
          <span class="muted">${esc(run.partyName)} · ${D.label}</span>
          <div class="pb-head-r"><button class="btn ghost danger" id="cp-abandon">Abandon run</button></div></header>
        <div class="cp-body">
          <aside class="cp-party"><h3>The Party <span class="muted">Level ${run.level}</span></h3>${run.heroes.map((h, i) => heroCard(h, i)).join('')}</aside>
          <main class="cp-mapwrap"><div class="cp-map" style="width:${W}px;height:${H}px">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges.join('')}</svg>
            <div class="cp-end top" style="left:${W / 2}px;top:26px">🏰<small>Hollowmere</small></div>
            <div class="cp-end" style="left:${W / 2}px;top:${H - 30}px">🏕<small>Set out</small></div>
            ${nodes.map(n => { const s = C().scenOf(n.scen); return `<button class="cp-node ${st(n)} ${n.id === sel ? 'sel' : ''}" data-node="${n.id}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px" ${st(n) === 'open' ? '' : 'tabindex="-1"'} aria-label="${esc(s.name)}, level ${s.level}${st(n) === 'done' ? ', cleared' : ''}"><span class="cp-ic">${NODE_ICON[s.id] || '⚔'}</span>${st(n) === 'done' ? '<span class="cp-tick">✓</span>' : ''}<span class="cp-lbl">${esc(s.name)}<small>Level ${s.level}</small></span></button>`; }).join('')}
          </div></main>
          <aside class="cp-detail">${scen ? `
            <div class="scen s-${scen.id}"><div class="scen-art">${G.SCEN_ART[scen.id] || '⚔'}</div>
            <h3>${esc(scen.name)}</h3><div class="scen-sub">${esc(scen.sub)}</div><p>${esc(scen.blurb)}</p>
            <ul>${scen.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
            <button class="btn big" id="cp-fight">Enter battle ▶</button></div>` : ''}
            <p class="muted fine-c">Fight ${run.path.length + 1} of ${nodes.length}. Wounds, surges, daily powers and items carry over between fights.</p>
          </aside>
        </div>
      </div>`;
    $('#cp-menu').onclick = A().menu;
    $('#cp-abandon').onclick = async () => {
      if (!await G.Dialog.confirm('Abandon this campaign? It goes into the Record of Heroes as abandoned.', 'Abandon run')) return;
      C().abandon(run); const rec = run.record; run = null; overScreen(rec);
    };
    document.querySelectorAll('.cp-node.open').forEach(b => b.onclick = () => { sel = b.dataset.node; G.Audio.play('click'); mapScreen(); });
    const f = $('#cp-fight'); if (f) f.onclick = () => fight(sel);
  }

  function fight(nodeId) {
    G.Audio.play('click');
    const setup = C().battleSetup(run, nodeId);
    run.stage = 'battle'; save();
    const myRun = run;
    A().startBattle(setup.scen, setup.party, {
      difficulty: run.difficulty, items: setup.opts.items, carry: setup.opts.carry,
      campaign: {
        onEnd(B) {
          const r = C().recordBattle(myRun, nodeId, B);
          if (myRun.outcome) C().clearRun(); else C().saveRun(myRun);
          return { fallen: r.fallen, over: r.over, next: () => { run = myRun; if (myRun.outcome) overScreen(myRun.record); else campScreen(); } };
        },
      },
    });
  }

  // ---------- camp: level up + short rest ----------
  function campScreen() {
    A().show('campaign');
    const cp = run.camp;
    const last = run.battles[run.battles.length - 1];
    const lvUp = cp.to > cp.from;
    const describe = (id) => esc(G.Build.describe(G.Build.POWERS[id]).join('\n'));
    const cards = run.heroes.map((h, i) => {
      if (h.dead) return heroCard(h, i);
      const s = C().status(run, h), before = cp.before[i];
      const u = G.Build.makeHero(h.build, run.level);
      const gained = before ? u.powers.filter(p => !before.powers.includes(p.id) && p.kind !== 'item') : [];
      const choices = C().levelChoices(run, i);
      const lv = lvUp ? `<div class="cp-lvup"><b>Level ${cp.to}</b> <span class="good">+${s.maxHp - (before ? before.maxHp : s.maxHp)} max HP</span>${cp.from < 3 && cp.to >= 3 ? ' <span class="good">+1 magic gear (attacks, damage, defenses)</span>' : ''}
        ${choices.map((c, k) => c.kind === 'power'
          ? `<div class="cp-pick"><small>New ${SLOT_LABEL[c.slot] || 'power'}</small><div class="chips">${c.options.map(id => `<button class="chip ${id === c.pick ? 'on' : ''}" data-pick="${i}:${k}:${id}" title="${describe(id)}">${esc(G.Build.POWERS[id].name)}</button>`).join('')}</div></div>`
          : `<div class="cp-pick"><small>New feat</small><select data-feat="${i}:${k}"><option value="">Choose a feat…</option>${c.options.map(id => `<option value="${id}" ${c.pick === id ? 'selected' : ''}>${esc(G.Build.FEATS[id].name)}</option>`).join('')}</select>${c.pick ? `<p class="muted">${esc(G.Build.FEATS[c.pick].text)}</p>` : ''}</div>`).join('')}
        ${!choices.length && gained.length ? `<div class="cp-pick"><small>New</small> ${gained.map(p => esc(p.name)).join(', ')}</div>` : ''}</div>` : '';
      const rest = `<div class="cp-rest"><button class="btn sm" data-surge="${i}" ${s.surges > 0 && s.hp < s.maxHp ? '' : 'disabled'}>Spend a surge (+${Math.min(s.surgeValue, s.maxHp - s.hp)} HP)</button>${s.hp === 0 ? `<small class="warn">${s.surges ? 'Unconscious: spend a surge to wake.' : 'Unconscious: wakes at 1 HP.'}</small>` : ''}</div>`;
      return heroCard(h, i, lv + rest);
    }).join('');
    const found = cp.found.length ? `<div class="cp-spoils"><b>Spoils:</b> ${cp.found.map(f => `${itemChip(f.item)} ${esc(G.Items[f.item].name)} <span class="muted">→ ${esc(run.heroes[f.hero].build.name)}</span>`).join(' · ')}</div>` : '';
    const blocked = C().unfilledChoices(run);
    $('#campaign').innerHTML = `
      <div class="cp camp">
        <header class="pb-head"><button class="btn ghost" id="cp-menu">← Menu</button><h2>Camp</h2><span class="muted">after ${esc(C().scenOf(last.scen).name)}</span></header>
        <div class="camp-body">
          <div class="camp-intro">
            ${lvUp ? `<h3 class="good">The party reaches Level ${cp.to}!</h3>` : ''}
            <p>A short rest: spend healing surges to recover. Encounter powers, Second Wind and Action Points come back for the next fight. <b>Daily powers stay spent.</b></p>
            ${found}
          </div>
          <div class="camp-heroes">${cards}</div>
          <div class="camp-foot"><button class="btn" id="cp-rest">Rest everyone</button><button class="btn big" id="cp-go" ${blocked ? 'disabled title="Choose a feat for every hero first"' : ''}>Break camp ▶</button></div>
        </div>
      </div>`;
    $('#cp-menu').onclick = A().menu;
    document.querySelectorAll('[data-surge]').forEach(b => b.onclick = () => { if (C().spendSurge(run, +b.dataset.surge)) { G.Audio.play('heal'); save(); campScreen(); } });
    document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const [i, k, id] = b.dataset.pick.split(':'); C().choose(run, +i, C().levelChoices(run, +i)[+k], id); save(); campScreen(); });
    document.querySelectorAll('[data-feat]').forEach(el => el.onchange = () => { if (!el.value) return; const [i, k] = el.dataset.feat.split(':'); C().choose(run, +i, C().levelChoices(run, +i)[+k], el.value); save(); campScreen(); });
    $('#cp-rest').onclick = () => { let n = 0; run.heroes.forEach((h, i) => n += C().autoRest(run, i)); if (n) G.Audio.play('heal'); save(); campScreen(); };
    $('#cp-go').onclick = () => { C().breakCamp(run); save(); G.Audio.play('click'); sel = null; mapScreen(); };
  }

  // ---------- end of a run ----------
  function overScreen(rec) {
    A().show('campaign');
    const [label, cls] = OUTCOME[rec.outcome];
    $('#campaign').innerHTML = `
      <div class="cp over"><div class="over-inner">
        <h2 class="${cls}">${rec.outcome === 'victory' ? 'The road is open!' : rec.outcome === 'defeat' ? 'The party has fallen' : 'Run abandoned'}</h2>
        <p class="muted">${esc(rec.partyName)} · ${label} · won ${rec.won} of ${rec.total} fights${rec.reached ? ` · last fight: ${esc(rec.reached)}` : ''}</p>
        ${recordHeroes(rec)}
        <div class="modal-btns"><button class="btn" id="ov-rec">📜 Record of Heroes</button><button class="btn ghost" id="ov-menu">Main menu</button></div>
      </div></div>`;
    $('#ov-rec').onclick = record;
    $('#ov-menu').onclick = A().menu;
  }
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
            <div class="rec-sum">Won ${r.won} of ${r.total} fights${r.reached && r.outcome !== 'victory' ? ` · ${r.outcome === 'defeat' ? 'fell at' : 'last fought at'} ${esc(r.reached)}` : ''} · reached Level ${r.level} · ${r.rounds} rounds · ${r.totals.kills || 0} kills</div>
            ${recordHeroes(r)}
          </article>`; }).join('') : '<p class="muted rec-empty">No runs yet. Start a campaign from the main menu, and every run, won or lost, is written down here.</p>'}</div>
      </div>`;
    $('#rec-back').onclick = A().menu;
    const c = $('#rec-clear'); if (c) c.onclick = async () => { if (await G.Dialog.confirm('Erase every run from the Record of Heroes? This can\'t be undone.', 'Erase')) { C().clearRecords(); record(); } };
  }

  G.CampaignUI = { start, resume, record, mapScreen, campScreen };
})();
