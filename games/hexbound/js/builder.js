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

  let state = { parties: [], pi: 0, hi: 0, previewLevel: 5 };
  let root;

  function open(container, onBack) {
    root = container;
    state.parties = Store.load();
    state.onBack = onBack;
    render();
  }

  function party() { return state.parties[state.pi]; }
  function hero() { return party().heroes[state.hi]; }
  function persist() { Store.save(state.parties); flash('Saved'); }
  function flash(msg) {
    const f = root.querySelector('.pb-flash'); if (!f) return;
    f.textContent = msg; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 1200);
  }

  function render() {
    const P = party();
    const h = hero();
    root.innerHTML = `
    <div class="pb">
      <header class="pb-head">
        <button class="btn ghost" data-act="back">← Menu</button>
        <h2>Party Builder</h2>
        <span class="pb-flash"></span>
        <div class="pb-head-r">
          <button class="btn" data-act="export">Export code</button>
          <button class="btn" data-act="import">Import code</button>
        </div>
      </header>
      <div class="pb-body">
        <aside class="pb-parties">
          <h3>Saved parties</h3>
          <ul>${state.parties.map((p, i) => `<li class="${i === state.pi ? 'on' : ''}" data-party="${i}"><div class="pp-name">${esc(p.name)}</div><div class="pp-icons">${p.heroes.map(x => `<span title="${esc(x.name)}" class="cls-${x.cls}">${ICON[x.cls]}</span>`).join('')}</div></li>`).join('')}</ul>
          <div class="pb-pbtns">
            <button class="btn" data-act="newparty">+ New party</button>
            <button class="btn" data-act="dupparty">Duplicate</button>
            <button class="btn danger" data-act="delparty" ${state.parties.length <= 1 ? 'disabled' : ''}>Delete</button>
          </div>
        </aside>
        <main class="pb-main">
          <div class="pb-pname"><label>Party name <input data-f="pname" value="${esc(P.name)}" maxlength="40"></label></div>
          <div class="pb-slots">${P.heroes.map((x, i) => {
            const C = B().CLASSES[x.cls]; const bad = validate(x).length;
            return `<button class="slot ${i === state.hi ? 'on' : ''} cls-${x.cls}" data-hero="${i}"><span class="slot-ico">${ICON[x.cls]}</span><span class="slot-n">${esc(x.name)}</span><span class="slot-s">${B().ANCESTRIES[x.ancestry].name} ${C.subs[x.sub].name} ${C.name}</span><span class="slot-role role-${C.role}">${C.role}</span>${bad ? '<span class="slot-bad">!</span>' : ''}</button>`;
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
    const spent = B().pointsSpent(h.base);
    const fin = B().finalAbil(h, 5);
    const fin1 = B().finalAbil(h, 1);
    const slots = [
      ['atwill', 'At-Will powers (pick 2)', 1, 2], ['enc1', 'Encounter power', 1, 1], ['daily1', 'Daily power', 1, 1],
      ['util2', 'Utility power', 2, 1], ['enc3', 'Encounter power', 3, 1], ['daily5', 'Daily power', 5, 1],
    ];
    const featCount = B().featSlots(h, 5);
    const featLv = ['Lv 1', 'Lv 2', 'Lv 4', 'Human bonus'];
    if (h.ancestry === 'human') featLv.splice(1, 0, 'Human bonus'), featLv.pop();
    const featOpts = Object.entries(B().FEATS).filter(([id, f]) => !f.cls || f.cls.includes(h.cls));
    return `
    <section class="ed">
      <div class="ed-row"><label class="grow">Name <input data-f="name" value="${esc(h.name)}" maxlength="28"></label>
        <button class="btn" data-act="randname" title="Random name">🎲</button></div>
      <h4>Class</h4>
      <div class="cards">${Object.entries(B().CLASSES).map(([id, c]) => `<button class="card ${id === h.cls ? 'on' : ''} cls-${id}" data-cls="${id}"><b>${ICON[id]} ${c.name}</b><i class="role-${c.role}">${c.role}</i><small>${c.blurb}</small></button>`).join('')}</div>
      <h4>Subclass</h4>
      <div class="cards two">${Object.entries(C.subs).map(([id, s]) => `<button class="card ${id === h.sub ? 'on' : ''}" data-sub="${id}"><b>${s.name}</b><small>${s.blurb}</small></button>`).join('')}</div>
      <h4>Ancestry</h4>
      <div class="cards three">${Object.entries(B().ANCESTRIES).map(([id, a]) => `<button class="card ${id === h.ancestry ? 'on' : ''}" data-anc="${id}"><b>${a.name}</b><small>${a.blurb}</small></button>`).join('')}</div>
      ${h.ancestry === 'human' ? `<div class="ed-row"><label>Human +2 bonus to <select data-f="humanBonus">${ABIL.map(k => `<option ${h.humanBonus === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div>` : ''}
      <h4>Ability scores <span class="pts ${spent > B().BUDGET ? 'bad' : ''}">${B().BUDGET - spent} points left</span>
        <button class="btn sm" data-act="autostats">Auto-assign</button></h4>
      <table class="abil">
        <tr><th></th><th>Base</th><th></th><th>Lv1</th><th>Lv5</th><th>Mod</th></tr>
        ${ABIL.map(k => `<tr class="${C.primary[0] === k ? 'prim' : C.primary.includes(k) ? 'sec' : ''}"><td title="${ABIL_NAME[k]}">${k}</td>
          <td class="abtn"><button data-ab="${k}" data-d="-1">−</button><b>${h.base[k]}</b><button data-ab="${k}" data-d="1">+</button></td>
          <td class="cost">${B().COST[h.base[k]]}pt</td><td>${fin1[k]}</td><td>${fin[k]}</td><td>${sgn(mod(fin[k]))}</td></tr>`).join('')}
      </table>
      <div class="ed-row small">Level 4 increase (+1 each): <select data-f="bump0">${ABIL.map(k => `<option ${h.bump4[0] === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <select data-f="bump1">${ABIL.map(k => `<option ${h.bump4[1] === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <span class="muted">Primary: ${C.primary.join(' › ')}</span></div>
      <h4>Feats</h4>
      <div class="feats">${Array.from({ length: featCount }, (_, i) => `<label><span>${featLv[i] || 'Lv'}</span><select data-feat="${i}"><option value="">— none —</option>${featOpts.map(([id, f]) => `<option value="${id}" ${h.feats[i] === id ? 'selected' : ''} ${h.feats.includes(id) && h.feats[i] !== id ? 'disabled' : ''}>${f.name} — ${f.text}</option>`).join('')}</select></label>`).join('')}</div>
      <h4>Powers <span class="muted">(levels unlock in later scenarios: Lv1 goblins, Lv3 bandits, Lv5 golem)</span></h4>
      ${slots.map(([slot, label, lv, n]) => {
        const opts = B().powersOf(h.cls, slot);
        let sel = [].concat(h.powers[slot] || []);
        if (!sel.length) sel = opts.slice(0, n).map(o => o.id);
        return `<div class="pslot"><div class="pslot-h"><span class="lv">Lv ${lv}</span> ${label}</div><div class="pcards">${opts.map(o => `<button class="pcard k-${o.kind} ${sel.includes(o.id) ? 'on' : ''}" data-pow="${o.id}" data-slot="${slot}" data-n="${n}"><b>${o.name}</b>${B().describe(o).map(x => `<small>${esc(x)}</small>`).join('')}</button>`).join('')}</div></div>`;
      }).join('')}
      <div class="pclass"><b>Always known:</b> ${B().powersOf(h.cls, 'class').map(p => `<span class="tag" title="${esc(B().describe(p).join(' · '))}">${p.name}</span>`).join(' ')} ${B().ANCESTRIES[h.ancestry].power ? `<span class="tag" title="${esc(B().describe(B().POWERS[B().ANCESTRIES[h.ancestry].power]).join(' · '))}">${B().POWERS[B().ANCESTRIES[h.ancestry].power].name}</span>` : ''} <span class="tag">Melee/Ranged Basic Attack</span> <span class="tag">Second Wind</span> <span class="tag">Charge</span> <span class="tag">Action Point</span></div>
    </section>`;
  }

  function sheet(h) {
    const L = state.previewLevel;
    const u = B().makeHero(h, L);
    const C = B().CLASSES[h.cls];
    const probs = validate(h);
    return `
      <div class="sheet">
        <div class="lvtabs">${[1, 3, 5].map(l => `<button class="${l === L ? 'on' : ''}" data-lv="${l}">Level ${l}</button>`).join('')}</div>
        <div class="sh-name cls-${h.cls}">${ICON[h.cls]} ${esc(h.name)}</div>
        <div class="sh-sub">Level ${L} ${B().ANCESTRIES[h.ancestry].name} ${C.subs[h.sub].name} ${C.name} · <span class="role-${C.role}">${C.role}</span></div>
        <div class="sh-grid">
          <div><span>HP</span><b>${u.maxHp}</b></div><div><span>Surges</span><b>${u.surges} × ${u.surgeValue}</b></div>
          <div><span>Speed</span><b>${u.speed}</b></div><div><span>Init</span><b>${sgn(mod(u.abil.DEX) + Math.floor(L / 2) + u.initBonus)}</b></div>
          <div><span>AC</span><b>${u.def.AC}</b></div><div><span>Fort</span><b>${u.def.Fort}</b></div>
          <div><span>Ref</span><b>${u.def.Ref}</b></div><div><span>Will</span><b>${u.def.Will}</b></div>
        </div>
        <div class="sh-w">${u.weapon.name} (d${u.weapon.die[1]}, prof +${u.weapon.prof}${u.weapon.ranged ? ', range ' + u.weapon.range : ''})${u.enh ? ' · +1 magic gear' : ''}</div>
        <div class="sh-feat"><b>Features:</b> ${C.features.join(', ')}; ${C.subs[h.sub].name}</div>
        <div class="sh-feat"><b>Feats:</b> ${u.feats.map(f => B().FEATS[f].name).join(', ') || '—'}</div>
        <div class="sh-pows">${u.powers.map(p => {
          const ab = p.atk ? G.Engine.attackBonus({ units: [] }, u, p, { uid: -1, conds: [] }, {}) : null;
          return `<div class="sp k-${p.kind}"><b>${p.name}</b>${ab ? ` <i>${sgn(ab.total)} vs ${p.atk.vs}</i>` : ''}</div>`;
        }).join('')}</div>
        ${probs.length ? `<div class="probs">${probs.map(esc).join('<br>')}</div>` : ''}
      </div>`;
  }

  const NAMES = ['Aldric', 'Bryn', 'Corvin', 'Daelia', 'Esk', 'Fennimore', 'Gwyl', 'Hale', 'Isolde', 'Jory', 'Kestrel', 'Lark', 'Maelis', 'Nim', 'Orsolya', 'Perrin', 'Quill', 'Rook', 'Saffi', 'Tamsin', 'Ulric', 'Vesper', 'Wren', 'Yarrow', 'Zephyrine'];
  const EPI = ['the Bold', 'Ashfoot', 'Brightwater', 'of the Vale', 'Thornhand', 'Halfmoon', 'Ironsong', 'the Quiet', 'Copperkettle', 'Stormcrow'];

  function bind() {
    root.querySelectorAll('[data-party]').forEach(el => el.onclick = () => { state.pi = +el.dataset.party; state.hi = 0; render(); });
    root.querySelectorAll('[data-hero]').forEach(el => el.onclick = () => { state.hi = +el.dataset.hero; render(); });
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
    inp('pname', v => party().name = v || 'Unnamed Party');
    inp('name', v => hero().name = v.slice(0, 28) || 'Nameless');
    inp('humanBonus', v => hero().humanBonus = v);
    inp('bump0', v => hero().bump4[0] = v);
    inp('bump1', v => hero().bump4[1] = v);
    const act = (a, fn) => root.querySelectorAll(`[data-act="${a}"]`).forEach(el => el.onclick = fn);
    act('back', () => state.onBack && state.onBack());
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
