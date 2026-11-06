// Party builder: create, edit, save and load parties of four heroes (stored in localStorage).
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const B = () => G.Build;
  const ABIL = ['STR', 'CON', 'DEX', 'INT', 'WIS', 'CHA'];
  const ABIL_NAME = { STR: 'Strength', CON: 'Constitution', DEX: 'Dexterity', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
  const ICON = { fighter: '⛨', rogue: '🗡', ranger: '➶', cleric: '✚', warlord: '⚑', wizard: '✦' };
  const KEY = 'hexbound.parties.v1';
  const mod = (s) => Math.floor((s - 10) / 2);
  const sgn = (n) => (n >= 0 ? '+' : '') + n;
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // in-page dialogs (native alert/confirm/prompt are unavailable in sandboxed frames)
  const Dialog = {
    open(html) {
      const m = document.createElement('div'); m.className = 'modal-bg'; m.dataset.sticky = 1;
      m.innerHTML = `<div class="modal small">${html}</div>`; document.body.appendChild(m); return m;
    },
    confirm(msg, ok = 'OK') {
      return new Promise(res => {
        const m = Dialog.open(`<p>${esc(msg)}</p><div class="modal-btns"><button class="btn" data-y>${esc(ok)}</button><button class="btn ghost" data-n>Cancel</button></div>`);
        m.querySelector('[data-y]').onclick = () => { m.remove(); res(true); };
        m.querySelector('[data-n]').onclick = () => { m.remove(); res(false); };
      });
    },
    text(title, value, opts = {}) {
      return new Promise(res => {
        const m = Dialog.open(`<h3>${esc(title)}</h3>${opts.note ? `<p class="muted">${esc(opts.note)}</p>` : ''}<textarea id="dlg-text" rows="6" ${opts.readonly ? 'readonly' : ''} spellcheck="false">${esc(value || '')}</textarea><p class="dlg-msg"></p>
          <div class="modal-btns">${opts.copy ? '<button class="btn" data-c>Copy</button>' : ''}${opts.ok ? `<button class="btn" data-y>${esc(opts.ok)}</button>` : ''}<button class="btn ghost" data-n>${opts.ok ? 'Cancel' : 'Close'}</button></div>`);
        const ta = m.querySelector('textarea'); ta.focus(); if (opts.readonly) ta.select();
        const c = m.querySelector('[data-c]');
        if (c) c.onclick = () => { const done = () => m.querySelector('.dlg-msg').textContent = 'Copied.'; try { navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); m.querySelector('.dlg-msg').textContent = 'Press Ctrl/Cmd+C to copy.'; }); } catch (e) { ta.select(); } };
        const y = m.querySelector('[data-y]');
        if (y) y.onclick = () => { const v = ta.value; const err = opts.validate ? opts.validate(v) : null; if (err) { m.querySelector('.dlg-msg').textContent = err; return; } m.remove(); res(v); };
        m.querySelector('[data-n]').onclick = () => { m.remove(); res(null); };
      });
    },
  };
  G.Dialog = Dialog;

  const Store = {
    load() {
      let list = null;
      try { list = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { list = null; }
      if (!Array.isArray(list) || !list.length) list = B().PREMADES.map((p, i) => ({ id: 'premade' + i, name: p.name, heroes: clone(p.heroes) }));
      return list;
    },
    save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } },
  };
  G.Store = Store;
  G.ICON = ICON;

  function blankHero(cls = 'fighter') {
    const C = B().CLASSES[cls];
    const subs = Object.keys(C.subs);
    const base = { STR: 10, CON: 10, DEX: 10, INT: 10, WIS: 10, CHA: 10 };
    // sensible default point buy using class primaries
    base[C.primary[0]] = 16; base[C.primary[1]] = 14; base[C.primary[2]] = 12;
    for (const k of ABIL) if (!C.primary.includes(k)) base[k] = 10;
    while (B().pointsSpent(base) > B().BUDGET) { const k = ABIL.find(k => !C.primary.includes(k) && base[k] > 8); if (!k) break; base[k]--; }
    return { name: 'New ' + C.name, cls, sub: subs[0], ancestry: 'human', humanBonus: C.primary[0], base, bump4: C.primary.slice(0, 2), feats: [], powers: {} };
  }
  G.blankHero = blankHero;

  // validation: returns list of problems
  function validate(h) {
    const out = [];
    const spent = B().pointsSpent(h.base);
    if (spent > B().BUDGET) out.push(`Ability points over budget (${spent}/${B().BUDGET}).`);
    for (const k of ABIL) if (h.base[k] < 8 || h.base[k] > 18) out.push(`${k} must be 8–18 before bonuses.`);
    if (!h.name || !h.name.trim()) out.push('Needs a name.');
    return out;
  }
  G.validateHero = validate;

  let state = { parties: [], pi: 0, hi: 0, previewLevel: 5, tab: 'class' };
  let root;

  // opts.onBegin(party): campaign mode, the builder is the party-creation step and gets a Begin button
  function open(container, onBack, opts = {}) {
    root = container;
    state.parties = Store.load();
    state.onBack = onBack;
    state.onBegin = opts.onBegin || null;
    render();
  }

  function party() { return state.parties[state.pi]; }
  function hero() { return party().heroes[state.hi]; }
  function persist() { Store.save(state.parties); flash('Saved'); }
  function flash(msg) {
    const f = root.querySelector('.pb-flash'); if (!f) return;
    f.textContent = msg; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 1200);
  }

  const TABS = [['class', 'Class & Origin'], ['abil', 'Abilities'], ['feats', 'Feats'], ['powers', 'Powers']];
  const SCROLLERS = ['.pb-main', '.pb-parties', '.pb-sheet'];
  const FOCUS_KEYS = ['f', 'feat', 'pow', 'cls', 'sub', 'anc', 'ab', 'hero', 'party', 'lv', 'tab', 'act'];

  // a selector that finds the same control again after a re-render
  function focusSel(el) {
    for (const k of FOCUS_KEYS) if (el.dataset && el.dataset[k] !== undefined) {
      const attr = 'data-' + k;
      return `[${attr}="${el.dataset[k]}"]` + (k === 'ab' ? `[data-d="${el.dataset.d}"]` : '');
    }
    return null;
  }

  // Re-render the whole page, keeping each panel's scroll position and the focused control.
  function render() {
    const scroll = SCROLLERS.map(s => { const e = root.querySelector(s); return e ? e.scrollTop : 0; });
    const rootScroll = root.scrollTop;
    const af = document.activeElement;
    const fsel = af && root.contains(af) ? focusSel(af) : null;
    draw();
    SCROLLERS.forEach((s, i) => { const e = root.querySelector(s); if (e) e.scrollTop = scroll[i]; });
    root.scrollTop = rootScroll;
    if (fsel) { const e = root.querySelector(fsel); if (e) e.focus({ preventScroll: true }); }
  }

  function draw() {
    const P = party();
    const h = hero();
    const U = G.Menu;
    const begin = state.onBegin ? `<button class="btn big pb-begin" data-act="begin">Begin with ${esc(P.name)} <span aria-hidden="true">▶</span></button>` : '';
    root.innerHTML = `
    <div class="pb ${state.onBegin ? 'creating' : ''}">
      ${U.topbar({ backAct: 'back', eyebrow: state.onBegin ? 'New campaign · Step 1 of 2' : 'Build and save your parties', title: state.onBegin ? 'Create Your Party' : 'Party Builder', mid: '<span class="pb-flash" role="status"></span>', right: begin })}
      <div class="pb-body">
        <aside class="pb-parties">
          <h3>Parties <span class="muted">${state.parties.length}</span></h3>
          <ul>${state.parties.map((p, i) => `<li><button class="pp ${i === state.pi ? 'on' : ''}" data-party="${i}"><span class="pp-name">${esc(p.name)}</span><span class="pp-icons">${p.heroes.map(x => U.hexpor(x.cls, { size: 'xs' })).join('')}</span></button></li>`).join('')}</ul>
          <div class="pb-pbtns">
            <button class="btn sm" data-act="newparty" title="Start a new party of four">＋ New party</button>
            <button class="btn sm ghost" data-act="dupparty" title="Copy this party">⧉ Duplicate</button>
            <button class="btn sm ghost" data-act="import" title="Add a party from a code">⤓ Import</button>
            <button class="btn sm ghost" data-act="export" title="Get a code for this party">⤒ Export</button>
            <button class="btn sm ghost danger" data-act="delparty" ${state.parties.length <= 1 ? 'disabled' : ''} title="Delete this party">✕ Delete</button>
          </div>
        </aside>
        <main class="pb-main">
          <input class="pb-pname" data-f="pname" value="${esc(P.name)}" maxlength="40" aria-label="Party name" title="Rename party">
          <div class="pb-slots">${P.heroes.map((x, i) => {
            const C = B().CLASSES[x.cls]; const bad = validate(x).length;
            return `<button class="slot ${i === state.hi ? 'on' : ''} cls-${x.cls}" data-hero="${i}">${U.hexpor(x.cls)}<span class="slot-txt"><span class="slot-n">${esc(x.name)}</span><span class="slot-s">${B().ANCESTRIES[x.ancestry].name} ${C.name}</span><span class="slot-role role-${C.role}">${C.role}</span></span>${bad ? '<span class="slot-bad" title="This hero has problems to fix">!</span>' : ''}</button>`;
          }).join('')}</div>
          ${editor(h)}
        </main>
        <aside class="pb-sheet">${sheet(h)}</aside>
      </div>
    </div>`;
    bind();
  }

  function editor(h) {
    const C = B().CLASSES[h.cls];
    const left = B().BUDGET - B().pointsSpent(h.base);
    const featCount = B().featSlots(h, 5);
    const featsSet = h.feats.slice(0, featCount).filter(Boolean).length;
    const badge = { abil: left ? `<em class="${left < 0 ? 'bad' : ''}" title="${left < 0 ? 'Over budget' : 'Points left to spend'}">${left}</em>` : '', feats: featsSet < featCount ? `<em title="Empty feat slots">${featCount - featsSet}</em>` : '' };
    const body = { class: tabClass, abil: tabAbil, feats: tabFeats, powers: tabPowers }[state.tab](h, C);
    const ti = TABS.findIndex(t => t[0] === state.tab), next = TABS[ti + 1];
    return `
    <section class="ed cls-${h.cls}">
      <div class="ed-head">
        ${G.Menu.hexpor(h.cls, { size: 'lg' })}
        <div class="ed-id">
          <input class="ed-name" data-f="name" value="${esc(h.name)}" maxlength="28" aria-label="Hero name" title="Rename hero">
          <span class="ed-sub">${B().ANCESTRIES[h.ancestry].name} ${C.subs[h.sub].name} ${C.name} · <span class="role-${C.role}">${C.role}</span></span>
        </div>
        <button class="btn ghost sm" data-act="randname" title="Random name">🎲 Random name</button>
      </div>
      <nav class="ed-tabs">${TABS.map(([id, label], i) => `<button class="${id === state.tab ? 'on' : ''}" data-tab="${id}"><i>${i + 1}</i>${label}${badge[id] || ''}</button>`).join('')}</nav>
      <div class="ed-body">${body}</div>
      ${next ? `<div class="ed-next"><button class="btn ghost" data-tab="${next[0]}">Next: ${next[1]} <span aria-hidden="true">→</span></button></div>` : ''}
    </section>`;
  }

  // picker: compact chips plus a detail panel for the current choice
  function chips(list, cur, attr, label) {
    return `<div class="chips">${list.map(([id, x]) => `<button class="chip ${id === cur ? 'on' : ''}" data-${attr}="${id}">${label(id, x)}</button>`).join('')}</div>`;
  }

  function tabClass(h, C) {
    const A = B().ANCESTRIES[h.ancestry];
    return `
      <h4>Class</h4>
      <div class="cls-grid">${Object.entries(B().CLASSES).map(([id, c]) => `<button class="cls-tile cls-${id} ${id === h.cls ? 'on' : ''}" data-cls="${id}">${G.Menu.hexpor(id, { size: 'sm' })}<span><b>${c.name}</b><small class="role-${c.role}">${c.role}</small><small class="ct-stats">${c.hp} HP · ${c.surges} surges · ${c.armor}</small></span></button>`).join('')}</div>
      <div class="detail cls-${h.cls}"><p>${C.blurb}</p><p class="muted">Key abilities: ${C.primary.join(' › ')}. Changing class resets this hero's choices.</p></div>
      <h4>Subclass</h4>
      <div class="sub-grid">${Object.entries(C.subs).map(([id, s]) => `<button class="sub-tile ${id === h.sub ? 'on' : ''}" data-sub="${id}"><b>${s.name}</b><small>${s.blurb}</small></button>`).join('')}</div>
      <h4>Ancestry</h4>
      ${chips(Object.entries(B().ANCESTRIES), h.ancestry, 'anc', (id, a) => a.name)}
      <div class="detail"><b>${A.name}</b><p>${A.blurb}</p>
        ${h.ancestry === 'human' ? `<label class="inline">Bonus +2 goes to <select data-f="humanBonus">${ABIL.map(k => `<option value="${k}" ${h.humanBonus === k ? 'selected' : ''}>${ABIL_NAME[k]}</option>`).join('')}</select></label>` : ''}</div>`;
  }

  function tabAbil(h, C) {
    const spent = B().pointsSpent(h.base);
    const fin = B().finalAbil(h, 5);
    const fin1 = B().finalAbil(h, 1);
    const bumpSel = (i) => `<select data-f="bump${i}">${ABIL.map(k => `<option value="${k}" ${h.bump4[i] === k ? 'selected' : ''}>${ABIL_NAME[k]}</option>`).join('')}</select>`;
    const left = B().BUDGET - spent;
    return `
      <div class="ab-top"><div class="ab-budget ${left < 0 ? 'bad' : left === 0 ? 'done' : ''}"><span><b>${left}</b> of ${B().BUDGET} points left</span>${G.Menu.meter(Math.min(spent, B().BUDGET), B().BUDGET, left < 0 ? 'bad' : 'gold')}</div>
        <button class="btn sm ghost" data-act="autostats" title="Spread points over ${C.name} key abilities">✨ Auto-assign</button></div>
      <div class="abil">
        <div class="ab-row ab-h"><span></span><span>Base</span><span>Cost</span><span>Lv 1</span><span>Lv 5</span><span>Mod</span></div>
        ${ABIL.map(k => `<div class="ab-row ${C.primary[0] === k ? 'prim' : C.primary.includes(k) ? 'sec' : ''}">
          <span class="ab-k"><b>${k}</b><small>${ABIL_NAME[k]}${C.primary[0] === k ? ' ★' : ''}</small></span>
          <span class="abtn"><button data-ab="${k}" data-d="-1" ${h.base[k] <= 8 ? 'disabled' : ''} aria-label="Lower ${ABIL_NAME[k]}">−</button><b>${h.base[k]}</b><button data-ab="${k}" data-d="1" ${h.base[k] >= 18 ? 'disabled' : ''} aria-label="Raise ${ABIL_NAME[k]}">+</button></span>
          <span class="muted">${B().COST[h.base[k]]}</span><span class="muted">${fin1[k]}</span><span>${fin[k]}</span><span class="ab-mod">${sgn(mod(fin[k]))}</span></div>`).join('')}
      </div>
      <p class="muted note">Gold rows are ${C.name} key abilities (${C.primary.join(' › ')}), ★ the most important. Ancestry bonuses are included in the level columns.</p>
      <h4>Level 4 increase</h4>
      <div class="ed-row">+1 to ${bumpSel(0)} and +1 to ${bumpSel(1)}</div>`;
  }

  function tabFeats(h, C) {
    const featCount = B().featSlots(h, 5);
    const featLv = ['Level 1', 'Level 2', 'Level 4', 'Human bonus'];
    if (h.ancestry === 'human') featLv.splice(1, 0, 'Human bonus'), featLv.pop();
    const featOpts = Object.entries(B().FEATS).filter(([id, f]) => !f.cls || f.cls.includes(h.cls));
    return `
      <p class="muted note">Pick one feat per slot. Each feat can only be taken once.</p>
      <div class="feats">${Array.from({ length: featCount }, (_, i) => {
        const F = B().FEATS[h.feats[i]];
        return `<div class="feat"><span class="feat-lv">${featLv[i] || 'Level'}</span><select data-feat="${i}"><option value="">Choose a feat…</option>${featOpts.map(([id, f]) => `<option value="${id}" ${h.feats[i] === id ? 'selected' : ''} ${h.feats.includes(id) && h.feats[i] !== id ? 'disabled' : ''}>${f.name}</option>`).join('')}</select><p class="${F ? '' : 'muted'}">${F ? esc(F.text) : 'No feat chosen.'}</p></div>`;
      }).join('')}</div>`;
  }

  function tabPowers(h, C) {
    const slots = [
      ['atwill', 'At-will attacks', 'pick 2', 1, 2], ['enc1', 'Encounter attack', '', 1, 1], ['daily1', 'Daily attack', '', 1, 1],
      ['util2', 'Utility', '', 2, 1], ['enc3', 'Encounter attack', '', 3, 1], ['daily5', 'Daily attack', '', 5, 1],
    ];
    const known = B().powersOf(h.cls, 'class').slice();
    const anc = B().ANCESTRIES[h.ancestry].power; if (anc) known.push(B().POWERS[anc]);
    return `
      <p class="muted note">Higher-level slots unlock in later scenarios: level 1 goblins, level 3 bandits, level 5 golem. Hover a power for its full text.</p>
      ${slots.map(([slot, label, hint, lv, n]) => {
        const opts = B().powersOf(h.cls, slot);
        let sel = [].concat(h.powers[slot] || []);
        if (!sel.length) sel = opts.slice(0, n).map(o => o.id);
        return `<div class="pslot"><div class="pslot-h"><span class="lv">Lv ${lv}</span> ${label}${hint ? ` <span class="muted">(${hint})</span>` : ''}</div><div class="pcards">${opts.map(o => {
          const d = B().describe(o); const on = sel.includes(o.id);
          const blurb = o.text || d.slice(1).join(' · ');
          return `<button class="pcard k-${o.kind} ${on ? 'on' : ''}" data-pow="${o.id}" data-slot="${slot}" data-n="${n}" title="${esc(d.join('\n'))}"><b>${o.name}</b><small class="pc-meta">${esc(d[0])}</small>${on ? d.slice(1).map(x => `<small class="${x === o.text ? 'pc-text' : ''}">${esc(x)}</small>`).join('') : `<small class="pc-desc">${esc(blurb)}</small>`}</button>`;
        }).join('')}</div></div>`;
      }).join('')}
      <div class="pclass"><h4>Always known</h4>${known.map(p => `<span class="pill" title="${esc(B().describe(p).join('\n'))}">${p.name}</span>`).join('')}<span class="pill" title="Basic melee and ranged attacks, named for your weapon">Basic attacks</span><span class="pill">Second Wind</span><span class="pill">Charge</span><span class="pill">Action Point</span></div>`;
  }

  function sheet(h) {
    const L = state.previewLevel;
    const u = B().makeHero(h, L);
    const C = B().CLASSES[h.cls];
    const probs = validate(h);
    const stat = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    return `
      <div class="sheet">
        <div class="sh-top"><h3>Character sheet</h3><div class="lvtabs" role="group" aria-label="Preview level">${[1, 3, 5].map(l => `<button class="${l === L ? 'on' : ''}" data-lv="${l}">Lv ${l}</button>`).join('')}</div></div>
        <div class="sh-id cls-${h.cls}">${G.Menu.hexpor(h.cls, { badge: L })}<div><div class="sh-name">${esc(h.name)}</div>
        <div class="sh-sub">${B().ANCESTRIES[h.ancestry].name} ${C.subs[h.sub].name} ${C.name} · <span class="role-${C.role}">${C.role}</span></div></div></div>
        ${probs.length ? `<div class="probs">${probs.map(esc).join('<br>')}</div>` : ''}
        <div class="sh-grid">${stat('HP', u.maxHp)}${stat('Surges', `${u.surges}×${u.surgeValue}`)}${stat('Speed', u.speed)}${stat('Init', sgn(mod(u.abil.DEX) + Math.floor(L / 2) + u.initBonus))}</div>
        <div class="sh-grid def">${stat('AC', u.def.AC)}${stat('Fort', u.def.Fort)}${stat('Ref', u.def.Ref)}${stat('Will', u.def.Will)}</div>
        <div class="sh-sec"><h5>Gear</h5>${u.weapon.name} (d${u.weapon.die[1]}, +${u.weapon.prof} prof${u.weapon.ranged ? ', range ' + u.weapon.range : ''})${u.enh ? ', +1 magic gear' : ''}</div>
        <div class="sh-sec"><h5>Features</h5>${C.features.join(', ')}, ${C.subs[h.sub].name}</div>
        <div class="sh-sec"><h5>Feats</h5>${u.feats.map(f => B().FEATS[f].name).join(', ') || '—'}</div>
        <div class="sh-sec"><h5>Powers</h5></div>
        <div class="sh-pows">${u.powers.map(p => {
          const ab = p.atk ? G.Engine.attackBonus({ units: [] }, u, p, { uid: -1, conds: [] }, {}) : null;
          return `<div class="sp k-${p.kind}" title="${esc(B().describe(p).join('\n'))}"><b>${p.name}</b>${ab ? ` <i>${sgn(ab.total)} vs ${p.atk.vs}</i>` : `<i>${p.kind === 'atwill' ? 'at-will' : p.kind}</i>`}</div>`;
        }).join('')}</div>
      </div>`;
  }

  const NAMES = ['Aldric', 'Bryn', 'Corvin', 'Daelia', 'Esk', 'Fennimore', 'Gwyl', 'Hale', 'Isolde', 'Jory', 'Kestrel', 'Lark', 'Maelis', 'Nim', 'Orsolya', 'Perrin', 'Quill', 'Rook', 'Saffi', 'Tamsin', 'Ulric', 'Vesper', 'Wren', 'Yarrow', 'Zephyrine'];
  const EPI = ['the Bold', 'Ashfoot', 'Brightwater', 'of the Vale', 'Thornhand', 'Halfmoon', 'Ironsong', 'the Quiet', 'Copperkettle', 'Stormcrow'];

  function bind() {
    root.querySelectorAll('[data-party]').forEach(el => el.onclick = () => { state.pi = +el.dataset.party; state.hi = 0; render(); });
    root.querySelectorAll('[data-hero]').forEach(el => el.onclick = () => { state.hi = +el.dataset.hero; render(); });
    root.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => {
      state.tab = el.dataset.tab; render();
      // if the old tab was scrolled under the sticky tab bar, start the new one at its top
      const t = root.querySelector('.ed-tabs'), b = root.querySelector('.ed-body');
      if (t && b && b.getBoundingClientRect().top < t.getBoundingClientRect().bottom - 1) root.querySelector('.ed-head').scrollIntoView({ block: 'start' });
    });
    root.querySelectorAll('[data-lv]').forEach(el => el.onclick = () => { state.previewLevel = +el.dataset.lv; render(); });
    root.querySelectorAll('[data-cls]').forEach(el => el.onclick = () => {
      const keepName = hero().name;
      const nh = blankHero(el.dataset.cls); nh.ancestry = hero().ancestry; if (!/^New /.test(keepName)) nh.name = keepName;
      party().heroes[state.hi] = nh; persist(); render();
    });
    root.querySelectorAll('[data-sub]').forEach(el => el.onclick = () => { hero().sub = el.dataset.sub; persist(); render(); });
    root.querySelectorAll('[data-anc]').forEach(el => el.onclick = () => { hero().ancestry = el.dataset.anc; persist(); render(); });
    root.querySelectorAll('[data-ab]').forEach(el => el.onclick = () => {
      const h = hero(); const k = el.dataset.ab; const nv = h.base[k] + (+el.dataset.d);
      if (nv < 8 || nv > 18) return;
      const test = Object.assign({}, h.base, { [k]: nv });
      if (+el.dataset.d > 0 && B().pointsSpent(test) > B().BUDGET) { flash('Not enough points'); return; }
      h.base[k] = nv; persist(); render();
    });
    root.querySelectorAll('[data-feat]').forEach(el => el.onchange = () => { const h = hero(); h.feats[+el.dataset.feat] = el.value; h.feats = h.feats.map(f => f || ''); persist(); render(); });
    root.querySelectorAll('[data-pow]').forEach(el => el.onclick = () => {
      const h = hero(); const slot = el.dataset.slot; const n = +el.dataset.n; const id = el.dataset.pow;
      if (n === 1) h.powers[slot] = id;
      else {
        let cur = [].concat(h.powers[slot] || B().powersOf(h.cls, slot).slice(0, n).map(o => o.id));
        if (cur.includes(id)) return;
        cur.push(id); while (cur.length > n) cur.shift();
        h.powers[slot] = cur;
      }
      persist(); render();
    });
    const inp = (f, fn) => { const el = root.querySelector(`[data-f="${f}"]`); if (el) el.onchange = () => { fn(el.value); persist(); render(); }; };
    // names update in place as you type, so leaving the field never rebuilds the page under your click
    const live = (f, set, shown) => {
      const el = root.querySelector(`[data-f="${f}"]`); if (!el) return;
      el.oninput = () => { set(el.value); shown().forEach(n => n.textContent = el.value); };
      el.onchange = () => { set(el.value); if (!el.value.trim()) render(); persist(); };
      el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
    };
    const $$ = (...sels) => () => sels.map(s => root.querySelector(s)).filter(Boolean);
    live('pname', v => party().name = v.trim() || 'Unnamed Party', $$('.pp.on .pp-name'));
    live('name', v => hero().name = v.slice(0, 28).trim() || 'Nameless', $$('.slot.on .slot-n', '.sh-name'));
    inp('humanBonus', v => hero().humanBonus = v);
    inp('bump0', v => hero().bump4[0] = v);
    inp('bump1', v => hero().bump4[1] = v);
    const act = (a, fn) => root.querySelectorAll(`[data-act="${a}"]`).forEach(el => el.onclick = fn);
    act('back', () => state.onBack && state.onBack());
    act('begin', () => state.onBegin && state.onBegin(clone(party())));
    act('randname', () => { hero().name = NAMES[Math.floor(Math.random() * NAMES.length)] + ' ' + EPI[Math.floor(Math.random() * EPI.length)]; persist(); render(); });
    act('autostats', () => { const h = hero(); const nb = blankHero(h.cls).base; h.base = nb; persist(); render(); });
    act('newparty', () => {
      state.parties.push({ id: 'p' + Date.now(), name: 'New Party', heroes: [blankHero('fighter'), blankHero('rogue'), blankHero('cleric'), blankHero('wizard')] });
      state.pi = state.parties.length - 1; state.hi = 0; persist(); render();
    });
    act('dupparty', () => { const c = clone(party()); c.id = 'p' + Date.now(); c.name += ' (copy)'; state.parties.push(c); state.pi = state.parties.length - 1; persist(); render(); });
    act('delparty', async () => { if (state.parties.length <= 1) return; if (!await Dialog.confirm(`Delete "${party().name}"? This can't be undone.`, 'Delete')) return; state.parties.splice(state.pi, 1); state.pi = 0; state.hi = 0; persist(); render(); });
    act('export', () => {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(party()))));
      Dialog.text('Party code', code, { readonly: true, copy: true, note: 'Share this code, or paste it into Import on another browser.' });
    });
    const decode = (code) => {
      const p = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!p.heroes || p.heroes.length !== 4) throw new Error('bad');
      for (const h of p.heroes) if (!B().CLASSES[h.cls] || !B().ANCESTRIES[h.ancestry] || !B().CLASSES[h.cls].subs[h.sub] || !h.base) throw new Error('bad');
      return p;
    };
    act('import', async () => {
      const code = await Dialog.text('Import a party', '', { ok: 'Import', note: 'Paste a party code from Export.', validate: (v) => { try { decode(v); return null; } catch (e) { return 'That code could not be read. Check that it was copied completely.'; } } });
      if (!code) return;
      const p = decode(code);
      p.id = 'p' + Date.now(); state.parties.push(p); state.pi = state.parties.length - 1; state.hi = 0; persist(); render();
    });
  }

  G.Builder = { open, validate, blankHero };
})();
