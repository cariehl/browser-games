// Deep Space: the screens around the field. HUD, tabs, the talent constellation, overlays, saving and the main loop.
(function () {
'use strict';
const D = window.DSData, C = window.DSCore, F = window.DSField, fmt = window.DSfmt;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'deepspace.v1';

// ---------- saving ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.v === 1 && s.mods) return Object.assign(C.newState(), s, { stats: Object.assign(C.newState().stats, s.stats), settings: Object.assign(C.newState().settings, s.settings) });
  } catch (e) { /* no save, or storage blocked */ }
  return null;
}
function save() { if (!S || window.__nosave) return; S.t = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } }

let S = load();
const firstVisit = !S;
if (!S) S = C.newState(Date.now());

// ---------- sound ----------
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = false; } } return AC; }
function tone(freq, dur, vol, type, when) {
  if (!S.settings.sound) return; const a = audio(); if (!a) return;
  if (a.state === 'suspended') a.resume();
  const t0 = a.currentTime + (when || 0);
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
const SFX = {
  chunk(kind, combo, who) {
    if (who === 'drone') return;
    const v = who === 'wren' ? 0.012 : 0.03;
    if (kind === 'relic') { [660, 880, 1320].forEach((f, i) => tone(f, 0.25, 0.035, 'triangle', i * 0.06)); return; }
    const base = { scrap: 420, ice: 760, data: 560 }[kind] || 420;
    tone(base * Math.pow(1.03, Math.min(12, combo || 0)), 0.09, v, kind === 'ice' ? 'sine' : 'triangle');
  },
  buy() { tone(520, 0.08, 0.03, 'triangle'); tone(780, 0.12, 0.03, 'triangle', 0.06); },
  big() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.35, 0.03, 'triangle', i * 0.08)); },
  click() { tone(300, 0.05, 0.02, 'square'); },
  warn() { tone(220, 0.25, 0.03, 'sawtooth'); tone(180, 0.3, 0.03, 'sawtooth', 0.2); },
};

// ---------- small helpers ----------
let toastT = 0;
function toast(msg, col) {
  const t = $('toast'); t.textContent = msg; t.style.borderColor = col || 'var(--data)'; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dur(secs) {
  secs = Math.max(0, Math.round(secs));
  if (secs < 60) return secs + 's';
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm' + (m < 10 && s ? ' ' + s + 's' : '');
}
const resIcon = r => `<i style="color:${D.RES[r].col};font-style:normal">${D.RES[r].icon}</i>`;
function costHtml(c) {
  return '<span class="costs">' + Object.keys(c).map(r => `<span class="cost${S.res[r] + 1e-9 < c[r] ? ' short' : ''}">${resIcon(r)} ${fmt(c[r], 0)}</span>`).join('') + '</span>';
}
function rateTxt(v) { return (v >= 0 ? '+' : '') + fmt(v) + '/s'; }

// ---------- HUD ----------
const RES_SHOWN = ['scrap', 'alloy', 'ice', 'data'];
$('res').innerHTML = RES_SHOWN.map(r => `<div class="chip" id="c-${r}"><b>${resIcon(r)} <span>0</span></b><small>${D.RES[r].name}</small></div>`).join('');
let R = C.rates(S);
function updateHud() {
  R = C.rates(S);
  const sec = C.sectorInfo(S.sector);
  $('sector').innerHTML = `<b>${esc(sec.name)}</b><small>Sector ${S.sector}${S.sector > D.FINAL_SECTOR ? '' : ' of ' + D.FINAL_SECTOR}</small>`;
  const need = C.xpNeed(S, R.b);
  $('lvl').textContent = S.level;
  $('ring').style.setProperty('--p', Math.min(100, 100 * S.xp / need).toFixed(1));
  $('xpTxt').textContent = 'level ' + S.level;
  const free = C.pointsFree(S);
  $('pip').hidden = free <= 0; $('pip').textContent = free;
  const pctAir = Math.max(0, Math.min(1, S.res.o2 / R.tank));
  $('airBar').style.width = (pctAir * 100).toFixed(1) + '%';
  $('air').classList.toggle('low', pctAir < 0.25);
  const fo = R.flow.o2;
  $('airTxt').textContent = `${Math.floor(S.res.o2)} / ${Math.round(R.tank)}  ${fo >= 0 ? '▲' : '▼'}${fmt(Math.abs(fo))}/s`;
  $('pwrTxt').textContent = `${fmt(R.draw, 0)} / ${fmt(R.gen, 0)}`;
  $('pwr').classList.toggle('over', R.draw > R.gen + 1e-9);
  $('pwr').classList.toggle('oc', R.oc);
  for (const r of RES_SHOWN) {
    const el = $('c-' + r);
    const seen = S.res[r] > 0 || S.stats.made[r] > 0;
    el.classList.toggle('off', !seen);
    el.querySelector('span').textContent = fmt(S.res[r], 0);
    const f = R.flow[r];
    el.querySelector('small').textContent = Math.abs(f) > 1e-6 ? rateTxt(f) : D.RES[r].name;
    el.classList.toggle('neg', f < -1e-6);
  }
  // ability buttons
  const ab = $('abil');
  const want = Object.keys(D.ABILITIES).filter(id => C.abilityInfo(S, id, R.b).has);
  if (ab.dataset.k !== want.join()) {
    ab.dataset.k = want.join();
    ab.innerHTML = want.map(id => { const A = D.ABILITIES[id]; return `<button class="ab" data-ab="${id}" style="--c:${A.col}" aria-label="${A.name}"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none" stroke="${A.col}" stroke-width="3" stroke-dasharray="150.8" stroke-dashoffset="0" opacity=".9"/></svg>${A.icon}<small></small></button>`; }).join('');
  }
  for (const btn of ab.querySelectorAll('.ab')) {
    const a = C.abilityInfo(S, btn.dataset.ab, R.b);
    btn.classList.toggle('on', a.active); btn.classList.toggle('wait', !a.active && !a.ready);
    const frac = a.active ? a.left / a.dur : a.ready ? 1 : 1 - a.wait / a.cd;
    btn.querySelector('circle').setAttribute('stroke-dashoffset', (150.8 * (1 - frac)).toFixed(1));
    btn.querySelector('small').textContent = a.active ? Math.ceil(a.left) + 's' : a.ready ? D.ABILITIES[btn.dataset.ab].name : dur(a.wait);
  }
  // hint
  let hint = '';
  if (S.clock < S.ab.spacewalk.until) hint = 'Spacewalk! Chunks pour in and your taps pay double.';
  else if (!S.projects.scrub) hint = S.res.scrap < 10 ? 'Tap the drifting scrap. You need 10 to patch the scrubber.' : 'Open Repairs below and patch the scrubber.';
  else if (S.stats.taps < 25) hint = 'Tap chunks to salvage them. Upgrades are in Systems.';
  else if (R.draw > R.gen && !S.projects.fab) hint = 'Power is overloaded: upgrade the reactor.';
  $('hint').textContent = hint;
  // tab dots
  const dot = (tab, on) => document.querySelector(`.tab[data-tab="${tab}"] .dot`).hidden = !on;
  dot('repairs', repairsReady());
  dot('talents', free > 0);
  dot('probes', S.projects.probe && S.contacts.some(c => S.res.data >= C.contactCost(S, D.CONTACTS.find(x => x.id === c.id))) && S.probes.length < C.probeSlots(S, R.b));
  dot('log', S.unread > 0);
  document.querySelector('.tab[data-tab="probes"]').classList.toggle('locked', !S.projects.scan);
}
function repairsReady() {
  if (D.PROJECTS.some(p => C.projectAvailable(S, p) && C.canPay(S, p.cost))) return true;
  if (C.driveActive(S) && S.drive.stage < D.DRIVE_STAGES.length && C.canPay(S, C.driveCost(S, S.drive.stage, R.b))) return true;
  if (C.jumpReady(S)) return true;
  if (S.sector === D.FINAL_SECTOR && !S.ended && C.canPay(S, D.BEACON.cost)) return true;
  return false;
}

// ---------- the panel ----------
let tab = 'systems', panelKey = '', binds = [], bound = [];
const B = fn => { binds.push(fn); return `data-b="${binds.length - 1}"`; };
const panel = $('panel');
function keyFor() {
  if (tab === 'systems') return 'sys' + D.MOD_ORDER.filter(k => S.mods[k].lv > 0).join() + S.settings.buyMax;
  if (tab === 'repairs') return 'rep' + D.PROJECTS.filter(p => C.projectAvailable(S, p)).map(p => p.id).join() + S.drive.stage + C.driveActive(S) + C.jumpReady(S) + S.sector + S.ended;
  if (tab === 'probes') return 'pro' + S.projects.probe + S.contacts.map(c => c.key).join() + '|' + S.probes.map(p => p.ends).join() + C.probeSlots(S, R.b);
  if (tab === 'log') return 'log' + S.log.length + S.relics.length;
  return tab;
}
function renderPanel() {
  binds = [];
  let html = '';
  if (tab === 'systems') html = systemsHtml();
  else if (tab === 'repairs') html = repairsHtml();
  else if (tab === 'probes') html = probesHtml();
  else if (tab === 'log') html = logHtml();
  const st = panel.scrollTop;
  panel.innerHTML = html;
  panel.scrollTop = st;
  bound = [...panel.querySelectorAll('[data-b]')].map(el => [el, binds[+el.dataset.b]]);
  updatePanel();
}
function updatePanel() {
  const k = keyFor();
  if (k !== panelKey) { panelKey = k; renderPanel(); return; }
  for (const [el, fn] of bound) fn(el);
}

function modOutput(k) {
  const m = S.mods[k], on = m.lv > 0 && m.on, pe = on ? R.pe : 0;
  const shortfall = on && R.pe < 0.999 ? ` · ${Math.round(R.pe * 100)}% power` : '';
  const draw = R.draws[k] ? ` · ${fmt(R.draws[k])}⚡` : '';
  switch (k) {
    case 'reactor': return `Makes ${fmt(R.gen)}⚡${R.oc ? ' (overclocked)' : ''}`;
    case 'scrubber': return `+${fmt(R.raw.scrubber * pe)} air/s${draw}${shortfall}`;
    case 'drones': return `+${fmt(R.raw.drones * pe)} scrap/s${draw}${shortfall}`;
    case 'fab': return `+${fmt(R.raw.fab * pe)} alloy/s from ${fmt(R.raw.fab * pe * R.fabRatio)} scrap/s${draw}${shortfall}`;
    case 'drill': return `+${fmt(R.raw.drill * pe)} ice/s${draw}${shortfall}`;
    case 'garden': return `+${fmt(R.raw.garden * pe)} air/s from ${fmt(R.gardenIce * pe)} ice/s${draw}${shortfall}`;
    case 'scanner': return `+${fmt(R.raw.scanner * pe)} data/s${draw}${shortfall}`;
  }
  return '';
}
// What one more level (or as many as you can afford) would add.
function upgradePlan(k) {
  const lv = S.mods[k].lv;
  let n = 1, total = C.upgradeCost(S, k, lv, R.b);
  if (S.settings.buyMax) {
    const res = { ...S.res }; let c = C.upgradeCost(S, k, lv, R.b); n = 0; total = {};
    while (n < 500 && Object.keys(c).every(r => res[r] >= c[r])) { for (const r in c) { res[r] -= c[r]; total[r] = (total[r] || 0) + c[r]; } n++; c = C.upgradeCost(S, k, lv + n, R.b); }
    if (n === 0) { n = 1; total = c; }
  }
  const S2 = { ...S, mods: { ...S.mods, [k]: { ...S.mods[k], lv: lv + n } } };
  const R2 = C.rates(S2);
  let gain = '';
  if (k === 'reactor') gain = `+${fmt(R2.gen - R.gen)}⚡`;
  else {
    const out = { scrubber: 'scrubber', drones: 'drones', fab: 'fab', drill: 'drill', garden: 'garden', scanner: 'scanner' }[k];
    const unit = { scrubber: 'air', drones: 'scrap', fab: 'alloy', drill: 'ice', garden: 'air', scanner: 'data' }[k];
    gain = `+${fmt(R2.raw[out] - R.raw[out])} ${unit}/s, +${fmt(R2.draws[k] - R.draws[k])}⚡`;
  }
  return { n, cost: total, gain, milestone: Math.floor((lv + n + R.free) / 10) > Math.floor((lv + R.free) / 10) };
}
function systemsHtml() {
  let h = `<div class="sec"><h3>Power <span class="seg"><button data-act="buy1" class="${S.settings.buyMax ? '' : 'on'}">×1</button><button data-act="buymax" class="${S.settings.buyMax ? 'on' : ''}">MAX</button></span></h3>
    <div class="card"><div class="pbar" style="--c:var(--power)"><i ${B(el => { el.style.width = Math.min(100, 100 * R.draw / Math.max(1e-9, R.gen)) + '%'; el.style.background = R.draw > R.gen ? 'var(--warn)' : 'var(--power)'; })}></i></div>
    <p ${B(el => {
      el.textContent = R.draw > R.gen + 1e-9 ? `Overloaded. Every system is running at ${Math.round(R.pe * 100)}%. Upgrade the reactor or switch something off.`
        : C.driveActive(S) && S.drive.stage >= D.DRIVE_STAGES.length ? `Spare power (${fmt(R.gen - R.draw)}⚡) is charging the jump drive.`
        : `Using ${fmt(R.draw)} of ${fmt(R.gen)}⚡. Each system you power up draws on the reactor.`;
    })}></p></div>`;
  for (const k of D.MOD_ORDER) {
    const m = S.mods[k], M = D.MODS[k];
    if (m.lv <= 0) continue;
    h += `<div class="card" style="--c:${M.col}"><div class="top"><div class="ic">${M.icon}</div>
      <div class="nm"><b>${M.name} <span class="lv" ${B(el => { el.textContent = 'Lv ' + S.mods[k].lv; })}></span></b><small ${B(el => { el.textContent = modOutput(k); })}></small></div>
      ${k === 'reactor' ? '' : `<button class="sw" data-act="tog:${k}" aria-label="Power ${M.name}" ${B(el => { el.classList.toggle('on', S.mods[k].on); })}></button>`}</div>
      ${k === 'reactor' ? '' : `<span class="wren-off" ${B(el => {
        const w = S.wrenOff.includes(k), p = (S.powerWait || []).includes(k);
        el.textContent = w ? 'Wren switched this off to save air. It comes back on when the air recovers.' : p ? 'Waiting for power. Wren will switch it on when the reactor can carry it.' : '';
        el.hidden = !w && !p; })}></span>`}
      <button class="btn" data-act="up:${k}" ${B(el => {
        const p = upgradePlan(k);
        el.disabled = !C.canPay(S, C.upgradeCost(S, k, null, R.b));
        el.innerHTML = `Upgrade${p.n > 1 ? ' ×' + p.n : ''} ${costHtml(p.cost)} <span class="gain">${p.gain}${p.milestone ? ' · retune ×2!' : ''}</span>`;
      })}></button></div>`;
  }
  if (!S.projects.drones) h += `<p class="note">More systems come back online as you make repairs.</p>`;
  return h + '</div>';
}
function repairsHtml() {
  let h = '<div class="sec"><h3>Repairs</h3>';
  const avail = D.PROJECTS.filter(p => C.projectAvailable(S, p));
  for (const p of avail) {
    h += `<div class="card" ${B(el => { el.classList.toggle('glow', C.canPay(S, p.cost)); })}><div class="nm"><b>${p.name}</b></div><p>${p.blurb}</p>
      <button class="btn primary" style="--c:var(--scrap)" data-act="proj:${p.id}" ${B(el => { el.disabled = !C.canPay(S, p.cost); el.innerHTML = 'Repair ' + costHtml(p.cost); })}></button></div>`;
  }
  if (!avail.length) {
    const next = D.PROJECTS.find(p => !S.projects[p.id] && p.sector > S.sector);
    h += `<p class="empty">Nothing left to patch for now.${next ? ` Farther out you will be able to <b>${next.name.toLowerCase()}</b>.` : ''}</p>`;
  }
  if (S.sector === D.FINAL_SECTOR && !S.ended) {
    h += `<h3>The Meridian beacon</h3><div class="card glow" style="--c:#ffd38a"><div class="nm"><b>${D.BEACON.name}</b></div>
      <p>The relay is right there. Gather enough power and materials to send a message home that someone will actually hear.</p>
      <button class="btn primary" style="--c:#ffd38a" data-act="beacon" ${B(el => { el.disabled = !C.canPay(S, D.BEACON.cost); el.innerHTML = 'Answer ' + costHtml(D.BEACON.cost); })}></button></div>`;
  } else if (C.driveActive(S)) {
    const nx = C.sectorInfo(S.sector + 1);
    h += `<h3>Jump drive</h3><div class="card" style="--c:var(--ice)"><p>Next: <b style="color:var(--ink)">Sector ${S.sector + 1}, ${esc(nx.name)}</b>. ${esc(nx.note)}</p><div class="stages">`;
    D.DRIVE_STAGES.forEach((st, i) => {
      const done = S.drive.stage > i, cur = S.drive.stage === i;
      h += `<div class="stage${done ? ' done' : ''}"><span class="ck">${done ? '✓' : i + 1}</span><span class="grow">${st.name}</span></div>`;
      if (cur) h += `<button class="btn primary" style="--c:var(--ice)" data-act="stage" ${B(el => { const c = C.driveCost(S, i, R.b); el.disabled = !C.canPay(S, c); el.innerHTML = 'Repair ' + costHtml(c); })}></button>`;
    });
    h += '</div>';
    if (S.drive.stage >= D.DRIVE_STAGES.length) {
      h += `<div class="pbar" style="--c:var(--power)"><i ${B(el => { el.style.width = (100 * S.drive.charge / C.chargeNeed(S)) + '%'; })}></i></div>
        <p ${B(el => {
          const need = C.chargeNeed(S), left = need - S.drive.charge, spare = Math.max(0, R.gen - R.draw) * (1 + (R.b.charge || 0));
          el.textContent = left <= 0 ? 'Charged. Ready to jump.' : `Charging from spare power: ${fmt(S.drive.charge)} / ${fmt(need)}. ` + (spare > 0 ? `About ${dur(left / spare)} at ${fmt(spare)}⚡/s. Switch systems off to charge faster.` : 'No spare power. Switch something off or upgrade the reactor.');
        })}></p>
        <button class="btn primary" style="--c:var(--ice)" data-act="jump" ${B(el => { el.disabled = !C.jumpReady(S); el.textContent = C.jumpReady(S) ? `Jump to sector ${S.sector + 1}` : 'Charging…'; })}></button>`;
    }
    h += '</div>';
  } else if (!S.projects.scan) {
    h += `<h3>Jump drive</h3><p class="note">The jump drive is dark. Rebuild the scanner dish first, so you know where to jump.</p>`;
  }
  return h + '</div>';
}
function probesHtml() {
  if (!S.projects.probe) return `<div class="sec"><p class="empty">${S.projects.scan ? 'Repair the probe bay to send probes out.' : 'The probe bay needs the scanner dish working first.'}</p></div>`;
  const slots = C.probeSlots(S, R.b);
  let h = `<div class="sec"><h3>In flight <span>${S.probes.length} / ${slots}</span></h3>`;
  if (!S.probes.length) h += `<p class="empty" style="padding:8px">No probes out. Pick a contact below.</p>`;
  for (const p of S.probes) {
    const c = D.CONTACTS.find(x => x.id === p.id);
    h += `<div class="card" style="--c:var(--data)"><div class="top"><div class="ic">◎</div><div class="nm"><b>${c.name}</b><small ${B(el => { el.textContent = 'Back in ' + dur(p.ends - S.clock); })}></small></div></div>
      <div class="pbar"><i ${B(el => { el.style.width = (100 * (1 - (p.ends - S.clock) / p.dur)) + '%'; })}></i></div>
      <p>Expected haul: ${Object.keys(p.loot).map(r => `${resIcon(r)} ${fmt(p.loot[r])}`).join('  ')}${p.doubled ? ' (lucky: doubled)' : ''}${c.rare ? ' · may carry a keepsake' : ''}</p></div>`;
  }
  h += `<h3>Contacts</h3>`;
  if (!S.contacts.length) h += `<p class="empty" ${B(el => { el.textContent = 'The scanner is listening. Next contact in about ' + dur(S.contactT / (1 + (R.b.contactRate || 0))) + '.'; })}></p>`;
  for (const ct of S.contacts) {
    const c = D.CONTACTS.find(x => x.id === ct.id); const cost = C.contactCost(S, c);
    h += `<div class="card${c.rare ? ' glow' : ''}" style="--c:${c.rare ? '#ffd76a' : 'var(--data)'}"><div class="nm"><b>${c.name}${c.rare ? ' ✦' : ''}</b><small>${dur(C.probeDuration(S, c, R.b))} round trip</small></div><p>${c.desc}</p>
      <button class="btn primary" style="--c:var(--data)" data-act="launch:${ct.key}" ${B(el => {
        const full = S.probes.length >= C.probeSlots(S, R.b);
        el.disabled = full || S.res.data < cost;
        el.innerHTML = full ? 'All probes are out' : 'Launch ' + costHtml({ data: cost });
      })}></button></div>`;
  }
  return h + '</div>';
}
function logHtml() {
  let h = `<div class="sec"><h3>Keepsakes <span>${S.relics.length} / ${D.RELICS.length}</span></h3><div class="shelf">`;
  for (const r of D.RELICS) h += S.relics.includes(r.id) ? `<button class="keep" data-act="keep:${r.id}" aria-label="${esc(r.name)}">${r.icon}</button>` : `<div class="keep none">?</div>`;
  h += `</div>${S.relics.length ? '' : '<p class="note">Probes sometimes bring back things that belonged to people. Rare contacts are your best bet.</p>'}<h3>Wren's log</h3>`;
  const unread = S.unread;
  S.log.slice().reverse().forEach((id, i) => {
    const L = D.LOG[id]; if (!L) return;
    h += `<div class="entry${i < unread ? ' new' : ''}"><b>${L.title}</b><p>${esc(L.text)}</p></div>`;
  });
  S.unread = 0;
  return h + '</div>';
}

panel.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  const [act, arg] = t.dataset.act.split(':');
  const ev = [];
  if (act === 'up') { if (C.buyUpgrade(S, arg, S.settings.buyMax)) SFX.buy(); }
  else if (act === 'tog') { C.toggle(S, arg); SFX.click(); }
  else if (act === 'buy1' || act === 'buymax') { S.settings.buyMax = act === 'buymax'; SFX.click(); }
  else if (act === 'proj') { if (C.doProject(S, arg, ev)) { SFX.big(); toast('Repaired: ' + D.PROJECTS.find(p => p.id === arg).name, 'var(--scrap)'); } }
  else if (act === 'stage') { if (C.driveStage(S, ev)) SFX.big(); }
  else if (act === 'jump') confirmJump();
  else if (act === 'beacon') { if (C.answerBeacon(S, ev)) SFX.big(); }
  else if (act === 'launch') { if (C.launchProbe(S, +arg, ev)) SFX.buy(); }
  else if (act === 'keep') showKeepsake(arg);
  handle(ev);
  updateHud(); updatePanel(); save();
});
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => {
  if (b.dataset.tab === 'talents') { openTree(); return; }
  tab = b.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  panel.scrollTop = 0; panelKey = ''; updatePanel();
});
$('badge').addEventListener('click', openTree);
$('abil').addEventListener('click', e => {
  const b = e.target.closest('[data-ab]'); if (!b) return;
  if (C.useAbility(S, b.dataset.ab)) { SFX.big(); F.text(D.ABILITIES[b.dataset.ab].name + '!', D.ABILITIES[b.dataset.ab].col); updateHud(); save(); }
});

// ---------- overlays ----------
const ov = $('ov');
const queue = [];
function overlay(html, wire) {
  if (!ov.hidden) { queue.push([html, wire]); return; }
  ov.innerHTML = html; ov.hidden = false; ov.scrollTop = 0;
  wire && wire();
  const f = ov.querySelector('button'); if (f) f.focus({ preventScroll: true });
}
function closeOverlay() {
  ov.hidden = true; ov.innerHTML = '';
  if (queue.length) { const [h, w] = queue.shift(); setTimeout(() => overlay(h, w), 120); }
}
const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
const POPUP = new Set(['wake', 'scrub', 'level', 'scan', 'probe', 'blackout', 'cat', 'relic', 'away', 'rest', 'jumpready', 's2', 's3', 's4', 's5', 's6', 'wren', 's7', 'beyond']);
function wrenPopup(id) {
  const L = D.LOG[id];
  overlay(`<div class="panel"><div class="tag">Wren · ship's log</div><div class="wren"><b>${L.title}</b>${esc(L.text)}</div><button class="btn primary" id="ok">Okay, Wren</button></div>`,
    () => on('ok', () => { S.unread = Math.max(0, S.unread - 1); closeOverlay(); }));
}
function showKeepsake(id) {
  const r = D.RELICS.find(x => x.id === id);
  overlay(`<div class="panel"><div style="font-size:64px;text-align:center">${r.icon}</div><h2>${esc(r.name)}</h2><p>${esc(r.text)}</p>
    <div class="tag" style="color:var(--o2)">${r.eff}</div><button class="btn" id="ok">Put it back on the shelf</button></div>`, () => on('ok', closeOverlay));
}
function intro() {
  overlay(`<div class="panel"><div class="tag">An idle survival game</div><h1>Deep Space</h1>
    <p>The survey tug <b style="color:var(--ink)">Kestrel</b> was three years out when the gravity shear hit. Now she is in pieces, far past the edge of the charts, and you are the only one aboard.</p>
    <p>Salvage what drifts by. Keep the air flowing. Rebuild, learn, and find a way home.</p>
    <button class="btn primary" id="go">Wake up</button>
    <p style="font-size:13.5px">Deep Space plays itself while you are away, for a while. Check in a few times a day.</p></div>`,
    () => on('go', () => { audio(); started = true; lastReal = Date.now(); S.t = Date.now(); closeOverlay(); const ev = []; C.addLog(S, 'wake', ev); handle(ev); save(); }));
}
function awaySummary(sum) {
  const ev = sum.events;
  const probes = ev.filter(e => e.type === 'probe');
  const rows = C.RES_KEYS.filter(r => r !== 'o2' && sum.gains[r] > 0.5).map(r => `<div class="gain-c"><b style="color:${D.RES[r].col}">+${fmt(sum.gains[r])}</b><span>${D.RES[r].name}</span></div>`);
  if (sum.levels) rows.push(`<div class="gain-c"><b style="color:var(--data)">+${sum.levels}</b><span>Crew levels</span></div>`);
  if (probes.length) rows.push(`<div class="gain-c"><b style="color:var(--data)">${probes.length}</b><span>Probes home</span></div>`);
  const sheds = ev.filter(e => e.type === 'shed').length, blk = ev.filter(e => e.type === 'blackout').length;
  overlay(`<div class="panel"><div class="tag">Welcome back</div><h2>You were away ${dur(sum.secs)}</h2>
    ${rows.length ? `<div class="gains">${rows.join('')}</div>` : '<p>Nothing much happened. The stars drifted a little.</p>'}
    ${sum.capped ? `<p>Wren ran the ship for ${dur(sum.run)}, then put it in low power to wait for you. Learning <b style="color:var(--ink)">Long Watch</b> lets her keep going longer.</p>` : ''}
    ${sheds ? `<p>The air ran low ${sheds > 1 ? sheds + ' times' : 'once'}, so Wren switched some systems off for a while.</p>` : ''}
    ${blk ? `<p style="color:#ff8a94">You blacked out ${blk > 1 ? blk + ' times' : 'once'} while you were away. More air would help.</p>` : ''}
    ${ev.filter(e => e.type === 'probe' && e.relic).map(e => { const r = D.RELICS.find(x => x.id === e.relic); return `<p>A probe brought back <b style="color:var(--ink)">${r.icon} ${esc(r.name)}</b>.</p>`; }).join('')}
    <button class="btn primary" id="ok">Back to work</button></div>`, () => on('ok', closeOverlay));
}
function confirmJump() {
  const nx = C.sectorInfo(S.sector + 1); const b = R.b;
  overlay(`<div class="panel"><div class="tag">Jump to sector ${S.sector + 1}</div><h2>${esc(nx.name)}</h2><p>${esc(nx.sub)}. ${esc(nx.note)}</p>
    <div class="howto"><div><b>You keep</b> your crew level, talents, keepsakes and every repair you have made, and earn <b>${D.JUMP_TP + (b.jumpTP || 0)} talent points</b>.</div>
    <div><b>The jump resets</b> your materials, and knocks every system back to ${b.keepLv ? 'a third of its level' : 'level 1'}. Probes in flight will find you.</div></div>
    <div class="row"><button class="btn primary" style="--c:var(--ice)" id="go">Jump</button><button class="btn" id="no">Not yet</button></div></div>`,
    () => { on('no', closeOverlay); on('go', () => { closeOverlay(); const ev = []; if (C.jump(S, ev)) { F.jumpFx(); SFX.big(); toast('Arrived: ' + C.sectorInfo(S.sector).name, 'var(--ice)'); } handle(ev); panelKey = ''; updateHud(); updatePanel(); save(); }); });
}
function ending() {
  const st = S.stats;
  overlay(`<div class="panel"><div class="tag">Sector 7 · Meridian</div><h1 style="font-size:44px">Heard</h1>
    <div class="wren"><b>${D.LOG.ending.title}</b>${esc(D.LOG.ending.text)}</div>
    <div class="stats"><div class="gain-c"><b>${S.jumps}</b><span>Jumps</span></div><div class="gain-c"><b>${S.level}</b><span>Crew level</span></div>
    <div class="gain-c"><b>${fmt(st.taps, 0)}</b><span>Chunks tapped</span></div><div class="gain-c"><b>${S.relics.length}/${D.RELICS.length}</b><span>Keepsakes</span></div></div>
    <p>The jump drive is open again. Past Meridian the charts run out, and every sector is new.</p>
    <button class="btn primary" style="--c:#ffd38a" id="ok">Keep exploring</button></div>`, () => on('ok', () => { S.unread = Math.max(0, S.unread - 1); closeOverlay(); }));
}
function menu() {
  overlay(`<div class="panel"><h2>Deep Space</h2>
    <button class="btn" id="how">How to play</button>
    <button class="btn" id="rec">Ship's record</button>
    <button class="btn" id="snd">Sound: ${S.settings.sound ? 'on' : 'off'}</button>
    <div class="row"><button class="btn" id="exp">Copy save</button><button class="btn" id="imp">Load save</button></div>
    <button class="btn" id="wipe" style="color:#ff8a94">Start over</button>
    <p style="font-size:14px">Made to be checked on a few times a day. Wren keeps the ship running for ${Math.round(C.offlineCap(S, R.b) / 3600)} hours while you are away, so there is never a reason to hurry back.</p>
    <button class="btn primary" id="ok">Close</button></div>`, () => {
    on('ok', closeOverlay);
    on('how', () => { closeOverlay(); howto(); });
    on('rec', () => { closeOverlay(); record(); });
    on('snd', () => { S.settings.sound = !S.settings.sound; save(); $('snd').textContent = 'Sound: ' + (S.settings.sound ? 'on' : 'off'); });
    on('exp', async () => { const code = btoa(unescape(encodeURIComponent(JSON.stringify(S)))); try { await navigator.clipboard.writeText(code); toast('Save copied to the clipboard'); } catch (e) { prompt('Copy this save code:', code); } });
    on('imp', () => {
      const code = prompt('Paste a save code:'); if (!code) return;
      try { const s = JSON.parse(decodeURIComponent(escape(atob(code.trim())))); if (!s || s.v !== 1 || !s.mods) throw 0; localStorage.setItem(SAVE_KEY, JSON.stringify(s)); location.reload(); }
      catch (e) { toast("That save code didn't work", 'var(--warn)'); }
    });
    on('wipe', () => {
      if (!confirm('Start over from the very beginning? Your ship, talents and keepsakes will all be lost.')) return;
      localStorage.removeItem(SAVE_KEY); started = false; location.reload();
    });
  });
}
function howto() {
  overlay(`<div class="panel"><h2>How to play</h2><div class="howto">
    <div><b>Tap the chunks</b> drifting past the ship to salvage them. Grey is scrap, blue is ice, violet boxes are data, and gold is worth a lot.</div>
    <div><b>Air</b> runs down as you breathe. The scrubber (and later the hydroponics bay) makes more. If the bar turns red, Wren will switch systems off to save you.</div>
    <div><b>Power</b> comes from the reactor. Every system draws some. Draw more than you make and everything slows down.</div>
    <div><b>Repairs</b> bring systems back and fix the jump drive. Systems turn scrap into alloy, ice and data automatically, even while you are away.</div>
    <div><b>Talents</b>: each crew level earns a point. Spend them in the constellation. Points can be taken back for free at any time.</div>
    <div><b>Probes</b> fly to contacts the scanner finds and come back later with loot, and sometimes a keepsake.</div>
    <div><b>Jumping</b> takes you one sector closer to home. It resets materials and system levels, but you keep everything you have learned.</div>
    </div><button class="btn primary" id="ok">Got it</button></div>`, () => on('ok', closeOverlay));
}
function record() {
  const st = S.stats; const m = st.made;
  overlay(`<div class="panel"><h2>Ship's record</h2><div class="stats">
    <div class="gain-c"><b>${dur(st.playSecs)}</b><span>At the console</span></div><div class="gain-c"><b>${dur(S.clock)}</b><span>Since the accident</span></div>
    <div class="gain-c"><b>${fmt(st.taps, 0)}</b><span>Chunks tapped</span></div><div class="gain-c"><b>${fmt(st.relicChunks, 0)}</b><span>Golden chunks</span></div>
    <div class="gain-c"><b>${fmt(m.scrap)}</b><span>Scrap salvaged</span></div><div class="gain-c"><b>${fmt(m.alloy)}</b><span>Alloy made</span></div>
    <div class="gain-c"><b>${fmt(m.ice)}</b><span>Ice melted</span></div><div class="gain-c"><b>${fmt(m.data)}</b><span>Data heard</span></div>
    <div class="gain-c"><b>${st.probes}</b><span>Probes home</span></div><div class="gain-c"><b>${S.jumps}</b><span>Jumps</span></div>
    <div class="gain-c"><b>${st.blackouts}</b><span>Blackouts</span></div><div class="gain-c"><b>${S.relics.length}</b><span>Keepsakes</span></div>
    </div><button class="btn primary" id="ok">Close</button></div>`, () => on('ok', closeOverlay));
}
$('menuBtn').addEventListener('click', menu);

// ---------- the talent constellation ----------
const tree = $('tree');
const R0 = 44, RS = 64, LAT = 58;
const SIZE = Math.round(2 * (R0 + RS * 7.6) + 120);
let sel = null, zoom = 1, confirmReset = false;
function angOf(t) {
  if (!Array.isArray(t.b)) return D.BRANCHES[t.b].ang * Math.PI / 180;
  const [a, b] = t.b.map(i => D.BRANCHES[i].ang * Math.PI / 180);
  return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
}
function nodePos(t) {
  const a = angOf(t), r = R0 + RS * t.t;
  return { x: SIZE / 2 + Math.cos(a) * r - Math.sin(a) * t.o * LAT, y: SIZE / 2 + Math.sin(a) * r + Math.cos(a) * t.o * LAT };
}
const colOf = t => Array.isArray(t.b) ? D.BRANCHES[t.b[0]].col : D.BRANCHES[t.b].col;
function openTree() {
  SFX.click();
  zoom = window.innerWidth < 700 ? 0.78 : 1;
  sel = null; confirmReset = false;
  tree.hidden = false;
  tree.innerHTML = `<header><div class="t"><b>Constellation</b><small>Every crew level earns a point. Take them back any time.</small></div>
    <span class="pts" id="tpts"></span><button class="icon-btn" id="tzoom" aria-label="Zoom">⊕</button><button class="icon-btn" id="tclose" aria-label="Close">✕</button></header>
    <div id="tview"><div id="tsizer"><div id="tinner"></div></div></div><div id="tsheet"></div>`;
  buildTree();
  const view = $('tview');
  requestAnimationFrame(() => { view.scrollLeft = (SIZE * zoom - view.clientWidth) / 2; view.scrollTop = (SIZE * zoom - view.clientHeight) / 2; });
  on('tclose', closeTree);
  on('tzoom', () => {
    const v = $('tview'); const cx = (v.scrollLeft + v.clientWidth / 2) / zoom, cy = (v.scrollTop + v.clientHeight / 2) / zoom;
    zoom = zoom >= 1 ? 0.55 : zoom >= 0.75 ? 1 : 0.78; applyZoom();
    v.scrollLeft = cx * zoom - v.clientWidth / 2; v.scrollTop = cy * zoom - v.clientHeight / 2;
  });
}
function closeTree() { tree.hidden = true; tree.innerHTML = ''; updateHud(); panelKey = ''; updatePanel(); save(); }
function applyZoom() {
  $('tsizer').style.cssText = `width:${SIZE * zoom}px;height:${SIZE * zoom}px;position:relative;margin:0 auto`;
  $('tinner').style.cssText = `width:${SIZE}px;height:${SIZE}px;transform:scale(${zoom})`;
}
function buildTree() {
  applyZoom();
  const inner = $('tinner');
  let svg = `<svg width="${SIZE}" height="${SIZE}">`;
  // faint rings for tiers
  for (let t = 1; t <= 6; t++) svg += `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R0 + RS * t}" fill="none" stroke="#1c2240" stroke-width="1" stroke-dasharray="2 6"/>`;
  for (const t of D.TALENTS) {
    const p = nodePos(t);
    const from = t.req.length ? t.req.map(q => nodePos(D.TALENT_BY_ID[q])) : [{ x: SIZE / 2, y: SIZE / 2 }];
    for (const f of from) svg += `<line data-l="${t.id}" x1="${f.x}" y1="${f.y}" x2="${p.x}" y2="${p.y}" stroke-width="2"/>`;
  }
  svg += '</svg>';
  let html = svg + `<div class="core" style="left:${SIZE / 2}px;top:${SIZE / 2}px">YOU</div>`;
  for (const br of D.BRANCHES) {
    const a = br.ang * Math.PI / 180, r = R0 + RS * 7.55;
    html += `<div class="blabel" style="left:${SIZE / 2 + Math.cos(a) * r}px;top:${SIZE / 2 + Math.sin(a) * r}px;color:${br.col}">${br.name}</div>`;
  }
  for (const t of D.TALENTS) {
    const p = nodePos(t); const cap = t.cost >= 3;
    html += `<button class="node${cap ? ' cap' : ''}" data-t="${t.id}" style="left:${p.x}px;top:${p.y}px;--c:${colOf(t)}" aria-label="${esc(t.name)}"><span class="rk"></span></button>
      <div class="nlabel" data-n="${t.id}" style="left:${p.x}px;top:${p.y + (cap ? 34 : 27)}px">${esc(t.name)}</div>`;
  }
  inner.innerHTML = html;
  inner.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; sel = b.dataset.t; confirmReset = false; SFX.click(); refreshTree(); });
  refreshTree();
}
function refreshTree() {
  const free = C.pointsFree(S);
  $('tpts').textContent = free + (free === 1 ? ' point' : ' points');
  for (const b of tree.querySelectorAll('.node')) {
    const t = D.TALENT_BY_ID[b.dataset.t]; const r = S.talents[t.id] || 0;
    const block = C.learnBlock(S, t.id);
    b.classList.toggle('full', r >= t.max); b.classList.toggle('some', r > 0 && r < t.max);
    b.classList.toggle('avail', r < t.max && !block);
    b.classList.toggle('sel', sel === t.id);
    b.querySelector('.rk').textContent = r > 0 ? (t.max > 1 ? r + '/' + t.max : '✓') : (t.max > 1 ? '0/' + t.max : '');
    tree.querySelector(`[data-n="${t.id}"]`).classList.toggle('lit', r > 0 || !block);
  }
  for (const l of tree.querySelectorAll('line')) {
    const t = D.TALENT_BY_ID[l.dataset.l]; const r = S.talents[t.id] || 0;
    const open = r > 0 || !C.learnBlock(S, t.id) || C.learnBlock(S, t.id).startsWith('No talent') || C.learnBlock(S, t.id).startsWith('Costs');
    l.setAttribute('stroke', r > 0 ? colOf(t) : open ? '#4a5378' : '#232a46');
    l.setAttribute('stroke-dasharray', r > 0 ? '' : '4 5');
    l.setAttribute('opacity', r > 0 ? '0.9' : '1');
  }
  const sh = $('tsheet');
  if (!sel) {
    sh.style.setProperty('--c', 'var(--slab-hi)');
    sh.innerHTML = `<div class="hd"><b>${free > 0 ? 'You have ' + free + ' talent point' + (free > 1 ? 's' : '') + ' to spend' : 'No points to spend right now'}</b></div>
      <div class="ef"><div>Tap a star to see what it does. Glowing stars can be learned now. Branches open up as you put points into them.</div></div>
      ${C.pointsSpent(S) ? `<button class="btn" id="treset">${confirmReset ? 'Tap again to take back every point' : 'Take back all points'}</button>` : ''}`;
    on('treset', () => { if (!confirmReset) { confirmReset = true; refreshTree(); return; } C.respec(S); confirmReset = false; SFX.click(); toast('All talent points returned'); refreshTree(); });
    return;
  }
  const t = D.TALENT_BY_ID[sel]; const r = S.talents[t.id] || 0; const block = C.learnBlock(S, t.id);
  const brName = Array.isArray(t.b) ? t.b.map(i => D.BRANCHES[i].name).join(' + ') : D.BRANCHES[t.b].name;
  sh.style.setProperty('--c', colOf(t));
  sh.innerHTML = `<div class="hd"><b>${esc(t.name)}</b><span>${brName} · ${t.max > 1 ? 'rank ' + r + '/' + t.max : r ? 'learned' : 'one rank'}</span></div>
    <div class="ef">${r > 0 ? `<div>Now: <b>${esc(t.fmt(r))}</b></div>` : ''}${r < t.max ? `<div>${r > 0 ? 'Next' : 'Learn'}: <b>${esc(t.fmt(r + 1))}</b></div>` : ''}</div>
    ${block && r < t.max ? `<div class="why">${esc(block)}</div>` : ''}
    <div class="row">${r < t.max ? `<button class="btn primary" style="--c:${colOf(t)}" id="tlearn" ${block ? 'disabled' : ''}>Learn${t.cost > 1 ? ' · ' + t.cost + ' points' : ''}</button>` : ''}<button class="btn" id="tdesel">Done</button></div>`;
  on('tlearn', () => { if (C.learn(S, t.id)) { SFX.buy(); refreshTree(); updateHud(); save(); } });
  on('tdesel', () => { sel = null; refreshTree(); });
}

// ---------- events from the simulation ----------
function handle(ev, quiet) {
  for (const e of ev) {
    if (e.type === 'log') {
      if (e.id === 'ending') ending();
      else if (POPUP.has(e.id)) wrenPopup(e.id);
      else if (!quiet) toast('New entry in Wren\'s log', 'var(--data)');
    }
    if (quiet) continue;
    if (e.type === 'level') { SFX.big(); toast(`Crew level ${e.level} · +1 talent point`, 'var(--data)'); F.text('Level ' + e.level + '!', '#b48cff'); }
    else if (e.type === 'shed') { SFX.warn(); toast(`Air is low. Wren switched off the ${D.MODS[e.mod].name.toLowerCase()}.`, 'var(--warn)'); }
    else if (e.type === 'powered') toast(`The reactor can carry it now: ${D.MODS[e.mod].name.toLowerCase()} is back on.`, 'var(--power)');
    else if (e.type === 'unshed') toast(`Air is back up. Wren switched the ${D.MODS[e.mod].name.toLowerCase()} back on.`, 'var(--o2)');
    else if (e.type === 'blackout') { SFX.warn(); if (S.stats.blackouts > 1) toast('You blacked out. Wren vented the reserve tank.', 'var(--warn)'); }
    else if (e.type === 'charged') { SFX.big(); toast('The jump drive is charged', 'var(--ice)'); }
    else if (e.type === 'contact' && tab !== 'probes') toast('New contact on the scanner', 'var(--data)');
    else if (e.type === 'launch') F.probeOut();
    else if (e.type === 'probe') {
      F.probeIn();
      const c = D.CONTACTS.find(x => x.id === e.id);
      toast(`Probe home from the ${c.name.toLowerCase()}: ` + Object.keys(e.loot).map(r => `+${fmt(e.loot[r])} ${D.RES[r].name.toLowerCase()}`).join(', '), 'var(--data)');
      if (e.relic && e.relic !== 'cat') setTimeout(() => showKeepsake(e.relic), 400);
    }
  }
}

// ---------- the loop ----------
let started = !firstVisit, lastReal = Date.now(), lastUi = 0, lastSave = 0, sessionSecs = 0, restShown = false;
F.init(S, {
  collect: (kind, size, who) => { const ev = []; const r = C.collect(S, kind, size, who, ev); handle(ev); return r; },
  sound: SFX.chunk,
  active: () => started && ov.hidden && tree.hidden,
  blocked: () => !started || !ov.hidden,
  tapped: () => audio(),
});
function catchUpFor(secs) {
  if (secs < 2) return;
  const sum = C.catchUp(S, secs);
  if (secs >= 60) awaySummary(sum);
  handle(sum.events, true);
}
function loop(t) {
  const now = Date.now();
  let dt = (now - lastReal) / 1000; lastReal = now;
  if (started) {
    if (dt > 5) catchUpFor(dt);
    else if (dt > 0) {
      const ev = [];
      while (dt > 0) { const s = Math.min(dt, 0.25); C.tick(S, s, ev, false); dt -= s; }
      handle(ev);
      if (!document.hidden && ov.hidden) {
        sessionSecs += (now - (loop.prev || now)) / 1000;
        if (sessionSecs > 40 * 60 && !restShown) {
          restShown = true;
          if (!S.log.includes('rest')) { const e2 = []; C.addLog(S, 'rest', e2); handle(e2); }
          else toast("Wren: you've been at this a while. The ship will keep.", 'var(--data)');
        }
      }
    }
  }
  loop.prev = now;
  F.frame(t);
  if (t - lastUi > 200) { lastUi = t; updateHud(); if (tree.hidden) updatePanel(); }
  if (now - lastSave > 5000) { lastSave = now; if (started) save(); }
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => F.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && started) save(); else lastReal = Math.min(lastReal, Date.now()); });
window.addEventListener('pagehide', () => { if (started) save(); });

// Start: a fresh game opens on the title card, a returning one catches up on the time away.
updateHud(); updatePanel();
if (firstVisit) intro();
else {
  const away = (Date.now() - (S.t || Date.now())) / 1000;
  if (away > 2) catchUpFor(away);
}
lastReal = Date.now();
requestAnimationFrame(loop);

// Test hook for automated playtests.
window.__ds = { get S() { return S; }, C, D, F, save, handle, tick: (secs) => { const ev = []; for (let i = 0; i < secs; i++) C.tick(S, 1, ev); handle(ev); updateHud(); updatePanel(); } };
})();
