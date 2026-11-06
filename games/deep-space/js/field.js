// Deep Space: the canvas. Space, the ship, drifting chunks you tap, drones, and all the little effects.
(function () {
'use strict';
const D = window.DSData, C = window.DSCore;

// Short number format shared with the UI: 940, 9.4K, 1.2M ...
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n, dp) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n < 1 && n > 0 && dp !== 0) s = (Math.round(n * 100) / 100).toString();
  else if (n < 10 && dp !== 0) s = (Math.round(n * 10) / 10).toString();
  else if (n < 1000) s = Math.floor(n).toString();
  else {
    const i = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(1000, i);
    s = (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString()) + SUFFIX[i];
  }
  return (neg ? '-' : '') + s;
}
window.DSfmt = fmt;

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, K = 1; // K: ship scale
let S = null, hooks = {};
const chunks = [], parts = [], texts = [], beams = [], streaks = [];
let stars = [], blobs = [];
let spawnT = 0, spawnN = 0, wrenT = 3, sweepT = 4, flash = 0, warp = 0;
const drones = [];
const ptr = { down: false, x: 0, y: 0, held: 0 };
const ship = { x: 0, y: 0 };
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  K = Math.max(0.55, Math.min(H / 250, W / 420, 1.6));
  ship.x = Math.max(W * 0.24, 124 * K); ship.y = H * 0.5;
  const n = Math.round(W * H / 2600);
  stars = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), tw: Math.random() * 6.28 }));
  blobs = Array.from({ length: 4 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, r: (0.35 + Math.random() * 0.4) * Math.max(W, H), k: i }));
}

// ---------- chunks ----------
function chunkKind(b) {
  spawnN++;
  if (b.tenthRelic && spawnN % 10 === 0) return 'relic';
  const x = Math.random();
  const relic = 0.02 * (1 + (b.relicChunks || 0));
  const ice = (S.projects.drill || S.sector >= 2 ? 0.15 : 0) * (1 + (b.iceChunks || 0) * 0.5);
  const data = S.projects.scan ? 0.04 : 0;
  return x < relic ? 'relic' : x < relic + ice ? 'ice' : x < relic + ice + data ? 'data' : 'scrap';
}
function makeChunk(kind, x, y) {
  const size = 1 + Math.floor(Math.random() * 3);
  const r = (9 + size * 4.5) * Math.max(0.8, K * 0.9) * (kind === 'data' ? 0.8 : 1);
  const n = kind === 'data' ? 4 : 6 + Math.floor(Math.random() * 3);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (kind === 'data' ? Math.PI / 4 : 0);
    const rr = kind === 'data' ? r : r * (0.62 + Math.random() * 0.45);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const speed = (14 + Math.random() * 18) * Math.max(0.7, K);
  return { kind, size, r, pts, x, y, vx: -speed, vy: (Math.random() - 0.5) * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.8,
    born: performance.now(), seed: Math.random(), dead: false };
}
function spawn(b, x) {
  const kind = chunkKind(b);
  const c = makeChunk(kind, 0, 0);
  c.x = x != null ? x : W + c.r + 4;
  c.y = H * (0.1 + Math.random() * 0.8);
  // keep the ship clear
  if (Math.abs(c.y - ship.y) < 40 * K && c.x < ship.x + 90 * K) c.y += (c.y < ship.y ? -1 : 1) * 50 * K;
  chunks.push(c);
}
function seed() {
  chunks.length = 0;
  const b = C.bonuses(S);
  for (let i = 0; i < 6; i++) spawn(b, W * (0.42 + Math.random() * 0.55));
}

function grab(c, who) {
  if (c.dead) return;
  c.dead = true;
  const res = hooks.collect(c.kind, c.size, who);
  const col = c.kind === 'relic' ? '#ffd76a' : D.RES[res.res].col;
  burst(c.x, c.y, col, c.kind === 'relic' ? 26 : 10 + c.size * 3, 2.4);
  const txt = '+' + fmt(res.amt) + (res.crit ? ' ×5!' : '');
  texts.push({ x: c.x, y: c.y - c.r, txt, col, life: 1, big: res.crit || c.kind === 'relic' });
  if (c.kind === 'relic') rings(c.x, c.y, '#ffd76a');
  hooks.sound && hooks.sound(c.kind, res.combo, who);
}

// ---------- effects ----------
function burst(x, y, col, n, sp) {
  if (reduced) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = (0.4 + Math.random()) * sp; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, col, sz: 1.5 + Math.random() * 2.5 }); }
}
const ringFx = [];
function rings(x, y, col) { ringFx.push({ x, y, col, life: 1 }); }

// ---------- input ----------
function pos(ev) { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
function tapAt(x, y) {
  const b = C.bonuses(S);
  let best = null, bd = 1e9;
  for (const c of chunks) {
    if (c.dead) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < c.r + 18 && d < bd) { bd = d; best = c; }
  }
  const mag = [0, 40, 65, 90][Math.min(3, b.magnet || 0)] * Math.max(0.8, K);
  let hit = 0;
  if (best) { grab(best, 'you'); hit++; }
  if (mag && (best || true)) for (const c of chunks) if (!c.dead && Math.hypot(c.x - x, c.y - y) < mag + c.r) { grab(c, 'you'); hit++; }
  if (mag && hit) rings(x, y, '#ffb44a88');
  if (!hit) parts.push({ x, y, vx: 0, vy: 0, life: 0.6, col: '#ffffff55', sz: 3, ripple: true });
  return hit;
}
function onDown(ev) {
  if (!S || hooks.blocked && hooks.blocked()) return;
  ev.preventDefault();
  cv.setPointerCapture && cv.setPointerCapture(ev.pointerId);
  const p = pos(ev);
  ptr.down = true; ptr.x = p.x; ptr.y = p.y; ptr.held = 0;
  tapAt(p.x, p.y);
  hooks.tapped && hooks.tapped();
}
function onMove(ev) { if (!ptr.down) return; const p = pos(ev); ptr.x = p.x; ptr.y = p.y; }
function onUp() { ptr.down = false; ptr.held = 0; }
cv.addEventListener('pointerdown', onDown);
cv.addEventListener('pointermove', onMove);
cv.addEventListener('pointerup', onUp);
cv.addEventListener('pointercancel', onUp);
cv.addEventListener('lostpointercapture', onUp);

// ---------- drawing helpers ----------
function hueCol(h, a, f) { return `rgba(${Math.round(h[0] * f)},${Math.round(h[1] * f)},${Math.round(h[2] * f)},${a})`; }
function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }

function drawBackground(t, dt, sec) {
  const h = sec.hue;
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, hueCol(h, 1, 0.16)); g.addColorStop(1, '#04050a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const bl of blobs) {
    bl.x -= dt * 0.002 * (bl.k + 1); if (bl.x < -bl.r) bl.x = W + bl.r;
    const gg = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.r);
    const tint = bl.k % 2 ? [h[2], h[0], h[1]] : h;
    gg.addColorStop(0, hueCol(tint, 0.13, 0.9)); gg.addColorStop(1, hueCol(tint, 0, 0.9));
    ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
  }
  // pulsar
  if (S.sector === 4) {
    const px = W * 0.86, py = H * 0.18; const ph = (t / 1400) % 1; const fl = Math.max(0, 1 - ph * 5);
    ctx.fillStyle = `rgba(190,200,255,${0.05 * fl})`; ctx.fillRect(0, 0, W, H);
    const gg = ctx.createRadialGradient(px, py, 0, px, py, 30 + 40 * fl);
    gg.addColorStop(0, `rgba(230,235,255,${0.9})`); gg.addColorStop(1, 'rgba(160,170,255,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px, py, 30 + 40 * fl, 0, 7); ctx.fill();
  }
  if (S.sector === 7 || (S.sector > 7 && S.ended)) {
    // the Meridian relay, blinking far away
    const px = W * 0.84, py = H * 0.22, on = Math.sin(t / 500) > 0.2;
    ctx.fillStyle = on ? '#ffd38a' : '#8a6a40'; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 7); ctx.fill();
    if (on) { const gg = ctx.createRadialGradient(px, py, 0, px, py, 24); gg.addColorStop(0, 'rgba(255,210,140,.5)'); gg.addColorStop(1, 'rgba(255,210,140,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px, py, 24, 0, 7); ctx.fill(); }
  }
  const sp = warp > 0 ? 1 + warp * 60 : 1;
  for (const s of stars) {
    s.x -= dt * 0.001 * (2 + s.z * 9) * sp; if (s.x < -20) { s.x = W + Math.random() * 20; s.y = Math.random() * H; }
    const a = 0.25 + s.z * 0.6 + Math.sin(t * 0.002 + s.tw) * 0.15;
    ctx.fillStyle = `rgba(230,236,255,${a})`;
    if (warp > 0.05) { ctx.fillRect(s.x, s.y, 2 + warp * 40 * s.z, 1); }
    else { const z = s.z > 0.92 ? 1.8 : s.z > 0.6 ? 1.2 : 0.8; ctx.fillRect(s.x, s.y, z, z); }
  }
}

function drawChunk(c, t) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
  const age = Math.min(1, (t - c.born) / 300);
  ctx.globalAlpha = age;
  if (c.kind === 'scrap' || c.kind === 'relic') {
    const relic = c.kind === 'relic';
    poly(c.pts);
    const g = ctx.createLinearGradient(-c.r, -c.r, c.r, c.r);
    if (relic) { g.addColorStop(0, '#fff2b8'); g.addColorStop(0.5, '#e8b440'); g.addColorStop(1, '#8a5a12'); }
    else { g.addColorStop(0, '#8e93a6'); g.addColorStop(1, '#3b3f50'); }
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = relic ? '#ffe9a0' : '#ffb44a88'; ctx.lineWidth = 1.5; ctx.stroke();
    // a seam and a rivet or two, so each one looks like a bit of a ship
    ctx.strokeStyle = relic ? '#8a5a12aa' : '#1f2230'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(c.pts[0][0] * 0.6, c.pts[0][1] * 0.6); ctx.lineTo(c.pts[3][0] * 0.5, c.pts[3][1] * 0.5); ctx.stroke();
    ctx.fillStyle = relic ? '#fff8d0' : '#c4c8d6';
    ctx.beginPath(); ctx.arc(c.r * 0.25, -c.r * 0.2, 1.4, 0, 7); ctx.arc(-c.r * 0.3, c.r * 0.15, 1.2, 0, 7); ctx.fill();
    if (relic) { const gl = (Math.sin(t * 0.006 + c.seed * 9) + 1) / 2; ctx.rotate(-c.rot); ctx.fillStyle = `rgba(255,250,220,${0.4 + gl * 0.6})`;
      ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * c.r * 1.3, Math.sin(a) * c.r * 1.3); } ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.2; ctx.stroke(); }
  } else if (c.kind === 'ice') {
    poly(c.pts);
    const g = ctx.createRadialGradient(-c.r * 0.3, -c.r * 0.3, 0, 0, 0, c.r * 1.2);
    g.addColorStop(0, '#f4fdff'); g.addColorStop(0.5, '#9fdcff'); g.addColorStop(1, '#3d7fb8');
    ctx.fillStyle = g; ctx.globalAlpha = age * 0.9; ctx.fill(); ctx.globalAlpha = age;
    ctx.strokeStyle = '#e6f8ff'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = '#ffffff99'; ctx.beginPath(); ctx.moveTo(-c.r * 0.4, -c.r * 0.1); ctx.lineTo(c.r * 0.2, -c.r * 0.45); ctx.stroke();
  } else {
    // data: a little black box with a blinking light
    poly(c.pts); ctx.fillStyle = '#1b1530'; ctx.fill(); ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 1.6; ctx.stroke();
    const on = Math.sin(t * 0.008 + c.seed * 20) > 0;
    ctx.fillStyle = on ? '#e2d0ff' : '#5a4590'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, 7); ctx.fill();
    if (on) { ctx.fillStyle = 'rgba(180,140,255,.25)'; ctx.beginPath(); ctx.arc(0, 0, c.r * 0.9, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

// The Kestrel. Drawn facing right, centred at the origin, about 160 units long.
function drawShip(t, r) {
  const P = S.projects, k = K;
  ctx.save(); ctx.translate(ship.x, ship.y + Math.sin(t * 0.0009) * 3 * k); ctx.rotate(Math.sin(t * 0.0006) * 0.02); ctx.scale(k, k);
  const oc = r.oc, running = m => S.mods[m].lv > 0 && S.mods[m].on;
  // engine plume
  const fl = 0.8 + Math.sin(t * 0.03) * 0.1 + Math.random() * 0.1;
  const plume = ctx.createRadialGradient(-86, 0, 0, -86, 0, 46 * fl * (oc ? 1.5 : 1));
  plume.addColorStop(0, oc ? 'rgba(255,240,170,.95)' : 'rgba(170,220,255,.8)'); plume.addColorStop(1, 'rgba(90,140,255,0)');
  ctx.fillStyle = plume; ctx.beginPath(); ctx.ellipse(-96, 0, 46 * fl * (oc ? 1.5 : 1), 14, 0, 0, 7); ctx.fill();
  // radiator fins
  if (P.fins) { ctx.fillStyle = '#3a4260'; ctx.strokeStyle = '#ff7a45aa'; ctx.lineWidth = 1;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-60, s * 18); ctx.lineTo(-30, s * 18); ctx.lineTo(-44, s * 50); ctx.lineTo(-70, s * 50); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-62 + i * 7, s * (22 + i)); ctx.lineTo(-68 + i * 6, s * 47); ctx.stroke(); } } }
  // nozzle
  ctx.fillStyle = '#4a5068'; ctx.beginPath(); ctx.moveTo(-70, -14); ctx.lineTo(-86, -18); ctx.lineTo(-86, 18); ctx.lineTo(-70, 14); ctx.closePath(); ctx.fill();
  // hull
  const hg = ctx.createLinearGradient(0, -26, 0, 26);
  hg.addColorStop(0, '#dfe4ee'); hg.addColorStop(0.45, '#a9b0c4'); hg.addColorStop(1, '#4f5670');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.moveTo(-72, -20); ctx.lineTo(40, -24); ctx.quadraticCurveTo(78, -20, 88, 0); ctx.quadraticCurveTo(78, 20, 40, 24); ctx.lineTo(-72, 20); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2a3046'; ctx.lineWidth = 1.5; ctx.stroke();
  // panel lines
  ctx.strokeStyle = '#6a7290'; ctx.lineWidth = 1;
  for (const x of [-40, -8, 24]) { ctx.beginPath(); ctx.moveTo(x, -22); ctx.lineTo(x, 22); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-72, 6); ctx.lineTo(40, 8); ctx.stroke();
  // reactor band
  const rp = 0.6 + Math.sin(t * 0.004) * 0.2 + (oc ? 0.4 : 0);
  ctx.fillStyle = '#2b2f40'; ctx.fillRect(-62, -21, 12, 42);
  ctx.fillStyle = `rgba(255,216,74,${rp})`; ctx.fillRect(-59, -18, 6, 36);
  // scorch marks and a stripe
  ctx.fillStyle = '#ff7a45'; ctx.fillRect(-30, -22.5, 40, 3);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 7px "Chakra Petch", sans-serif'; ctx.fillText('KESTREL', -28, 17);
  // cockpit window
  ctx.fillStyle = '#0d1a22'; ctx.beginPath(); ctx.moveTo(52, -14); ctx.quadraticCurveTo(76, -12, 82, 0); ctx.lineTo(52, 0); ctx.closePath(); ctx.fill();
  const wg = ctx.createLinearGradient(52, -14, 82, 0); wg.addColorStop(0, 'rgba(120,230,255,.55)'); wg.addColorStop(1, 'rgba(60,140,200,.25)');
  ctx.fillStyle = wg; ctx.fill();
  // you, at the console, and maybe a cat
  ctx.fillStyle = '#0a1016'; ctx.beginPath(); ctx.arc(60, -5, 4, 0, 7); ctx.fill(); ctx.fillRect(56, -2, 8, 3);
  if (S.relics.includes('cat')) { ctx.fillStyle = '#e08a3a'; ctx.beginPath(); ctx.ellipse(72, -2.5, 4.5, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(74.5, -4); ctx.lineTo(75.5, -7.5); ctx.lineTo(76.8, -4); ctx.moveTo(72.6, -4.2); ctx.lineTo(73.4, -7.2); ctx.lineTo(74.8, -4.4); ctx.fill(); }
  // hydroponics dome
  if (P.garden) { ctx.fillStyle = 'rgba(126,224,122,.25)'; ctx.strokeStyle = '#bff5c0'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(4, -24, 13, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5fe08a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-6 + i * 5, -27 + Math.sin(i * 2 + t * 0.002) * 1.2, 2.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.arc(1, -29, 1.4, 0, 7); ctx.arc(8, -27, 1.4, 0, 7); ctx.fill(); }
  // fabricator vent
  if (P.fab) { ctx.fillStyle = '#5a6078'; ctx.fillRect(-36, -30, 10, 8); if (running('fab')) { ctx.fillStyle = `rgba(255,140,60,${0.5 + Math.sin(t * 0.01) * 0.3})`; ctx.fillRect(-34, -29, 6, 3); } }
  // scanner dish or its broken mast
  if (P.scan) {
    ctx.strokeStyle = '#9aa2b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30, -24); ctx.lineTo(30, -36); ctx.stroke();
    ctx.save(); ctx.translate(30, -38); ctx.rotate(-0.5 + Math.sin(t * 0.0005) * 0.4);
    ctx.fillStyle = '#c9d0e0'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 4.5, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -8); ctx.stroke();
    if (running('scanner')) { const ph = (t / 1200) % 1; ctx.strokeStyle = `rgba(180,140,255,${1 - ph})`; ctx.beginPath(); ctx.arc(0, -8, 4 + ph * 22, -2.4, -0.7); ctx.stroke(); }
    ctx.restore();
  } else { ctx.strokeStyle = '#7a8098'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30, -24); ctx.lineTo(33, -31); ctx.lineTo(29, -34); ctx.stroke(); }
  // wren's antenna lights
  if (P.wren || true) { const on = Math.sin(t * 0.004) > 0.6; ctx.fillStyle = on ? (P.wren ? '#5cc8ff' : '#ff4d5e') : '#333a50'; ctx.beginPath(); ctx.arc(46, -24, 1.8, 0, 7); ctx.fill(); }
  // ice drill
  if (P.drill) { ctx.strokeStyle = '#8fa0c0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(50, 20); ctx.lineTo(66, 32); ctx.stroke();
    ctx.fillStyle = '#5cc8ff'; ctx.beginPath(); ctx.moveTo(64, 30); ctx.lineTo(76, 38); ctx.lineTo(66, 35); ctx.closePath(); ctx.fill();
    if (running('drill')) { ctx.save(); ctx.translate(72, 36); ctx.rotate(t * 0.02); ctx.strokeStyle = '#e6f8ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.stroke(); ctx.restore(); } }
  // drone bay doors
  ctx.fillStyle = '#3a4058';
  if (P.drones) { ctx.fillRect(-26, 20, 30, 4); }
  else { ctx.save(); ctx.translate(-26, 22); ctx.rotate(0.6); ctx.fillRect(0, 0, 14, 3); ctx.restore(); ctx.save(); ctx.translate(4, 22); ctx.rotate(2.4); ctx.fillRect(0, 0, 14, 3); ctx.restore(); }
  // the hole you patch first
  if (!P.scrub) { ctx.fillStyle = '#07080d'; poly([[-20, -23], [-10, -14], [-2, -19], [6, -10], [12, -23]]); ctx.fill(); }
  else { ctx.fillStyle = '#8b93ac'; ctx.fillRect(-18, -22, 26, 9); ctx.strokeStyle = '#5a627c'; ctx.strokeRect(-18, -22, 26, 9);
    ctx.fillStyle = '#c9cfdc'; for (const [x, y] of [[-16, -20], [6, -20], [-16, -15], [6, -15]]) { ctx.fillRect(x, y, 1.5, 1.5); } }
  // probe rack
  if (P.probe) { ctx.fillStyle = '#5a6078'; ctx.fillRect(-48, 22, 14, 6); ctx.fillStyle = '#b48cff'; ctx.fillRect(-46, 24, 3, 3); ctx.fillRect(-40, 24, 3, 3); }
  // nebula scoops
  if (P.scoops) { ctx.strokeStyle = 'rgba(180,140,255,.5)'; ctx.lineWidth = 0.8; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(40, s * 22); ctx.quadraticCurveTo(110, s * 70, 130, s * 10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(40, s * 22); ctx.quadraticCurveTo(100, s * 40, 130, s * 10); ctx.stroke(); } }
  ctx.restore();
  // sparks from what is still broken
  const dmg = [];
  if (!P.scrub) dmg.push([-5, -20]);
  if (!P.drones) dmg.push([-10, 22]);
  if (!P.scan) dmg.push([31, -32]);
  for (const [x, y] of dmg) if (Math.random() < 0.08) {
    const sx = ship.x + x * k, sy = ship.y + y * k;
    for (let i = 0; i < 3; i++) parts.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 1.5, life: 0.6, col: Math.random() < 0.5 ? '#ffd84a' : '#ff9b3d', sz: 1.5 });
  }
}

function drawSpacewalker(t) {
  // you, outside, on a tether
  const hx = ship.x - 10 * K, hy = ship.y - 20 * K;
  const ax = ship.x + (40 + Math.sin(t * 0.0013) * 18) * K, ay = ship.y - (62 + Math.cos(t * 0.0011) * 10) * K;
  ctx.strokeStyle = 'rgba(230,230,255,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo((hx + ax) / 2, Math.min(hy, ay) - 30 * K, ax, ay); ctx.stroke();
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.sin(t * 0.001) * 0.4); ctx.scale(K, K);
  ctx.fillStyle = '#eef1f8'; ctx.beginPath(); ctx.ellipse(0, 4, 5, 7, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -5, 5, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffb44a'; ctx.beginPath(); ctx.arc(1.5, -5, 3, -1.2, 1.4); ctx.fill();
  ctx.fillStyle = '#c0c6d6'; ctx.fillRect(-7, 0, 3, 7);
  ctx.restore();
}

function drawDrones(t, dt, r) {
  const want = S.mods.drones.lv > 0 ? Math.min(6, 1 + Math.floor(S.mods.drones.lv / 5)) : 0;
  while (drones.length < want) drones.push({ a: Math.random() * 6.28, x: ship.x, y: ship.y, task: null });
  drones.length = want;
  const on = S.mods.drones.on && r.pe > 0;
  drones.forEach((d, i) => {
    let tx, ty;
    if (d.task && !d.task.dead) { tx = d.task.x; ty = d.task.y; if (Math.hypot(tx - d.x, ty - d.y) < 10) { grab(d.task, 'drone'); d.task = null; } }
    else {
      d.task = null;
      d.a += dt * 0.0006 * (on ? 1 : 0.2) * (i % 2 ? 1 : -1);
      tx = ship.x + Math.cos(d.a + i) * (95 + i * 9) * K; ty = ship.y + Math.sin(d.a + i) * (48 + i * 5) * K;
    }
    const sp = d.task ? 0.006 : 0.003;
    d.x += (tx - d.x) * Math.min(1, dt * sp); d.y += (ty - d.y) * Math.min(1, dt * sp);
    const ang = Math.atan2(ty - d.y, tx - d.x);
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(ang); ctx.scale(K, K);
    ctx.fillStyle = on ? '#ffb44a' : '#6a6050'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-2, 0); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    if (on) { ctx.fillStyle = 'rgba(255,200,120,.6)'; ctx.fillRect(-6, -1, 2.5, 2); }
    ctx.restore();
  });
}

// ---------- the frame ----------
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(60, t - lastT); lastT = t;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!S) return;
  const r = C.rates(S); const b = r.b;
  const sec = C.sectorInfo(S.sector);
  const walking = S.clock < S.ab.spacewalk.until;
  drawBackground(t, dt, sec);
  // spawning
  const every = 1600 / Math.max(0.2, 1 + (b.spawn || 0)) / (walking ? 4 : 1);
  const cap = walking ? 26 : 13;
  spawnT -= dt;
  if (spawnT <= 0) { spawnT = every * (0.6 + Math.random() * 0.8); if (chunks.filter(c => !c.dead).length < cap) spawn(b); }
  // helpers that collect on their own
  const wl = Math.min(3, b.wrenTap || 0);
  if (wl && hooks.active()) {
    wrenT -= dt / 1000;
    if (wrenT <= 0) {
      wrenT = [0, 6, 4, 2.5][wl];
      const live = chunks.filter(c => !c.dead && c.x < W - 10 && c.x > 10);
      const order = { relic: 4, data: 3, ice: 2, scrap: 1 };
      live.sort((a, c) => order[c.kind] - order[a.kind] || c.size - a.size);
      if (live[0]) { beams.push({ x1: ship.x + 66 * K, y1: ship.y - 6 * K, x2: live[0].x, y2: live[0].y, life: 1 }); grab(live[0], 'wren'); }
    }
  }
  const sw = Math.min(3, b.sweep || 0);
  if (sw && drones.length && S.mods.drones.on && hooks.active()) {
    sweepT -= dt / 1000;
    if (sweepT <= 0) {
      sweepT = [0, 8, 5, 3][sw];
      const free = drones.find(d => !d.task);
      const live = chunks.filter(c => !c.dead && c.x < W * 0.95 && !drones.some(d => d.task === c));
      if (free && live.length) free.task = live[Math.floor(Math.random() * live.length)];
    }
  }
  // tractor beam
  const tractor = b.tractor && ptr.down;
  if (ptr.down) ptr.held += dt;
  // chunks
  for (const c of chunks) {
    if (c.dead) continue;
    if (tractor && ptr.held > 120) {
      const dx = ptr.x - c.x, dy = ptr.y - c.y, d = Math.hypot(dx, dy);
      const R = 150 * Math.max(0.8, K);
      if (d < R) { const f = (1 - d / R) * 0.012 * dt; c.x += dx * f * 0.4; c.y += dy * f * 0.4; c.vr *= 1.01; if (d < 16) grab(c, 'you'); }
    }
    c.x += c.vx * dt / 1000; c.y += c.vy * dt / 1000; c.rot += c.vr * dt / 1000;
    if (c.y < c.r || c.y > H - c.r) c.vy *= -1;
    if (c.x < -c.r - 10) c.dead = true;
  }
  for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].dead) chunks.splice(i, 1);
  // streaks: probes leaving and coming home
  for (const s of streaks) { s.life -= dt / 1400; const tt = 1 - s.life; const x = s.out ? ship.x + tt * (W - ship.x + 60) : W + 40 - tt * (W - ship.x + 40); const y = ship.y + (s.out ? -1 : 1) * 30 * K * Math.sin(tt * 3);
    ctx.strokeStyle = 'rgba(180,140,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (s.out ? -24 : 24), y); ctx.stroke();
    ctx.fillStyle = '#e8dcff'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); }
  drawShip(t, r);
  if (walking) drawSpacewalker(t);
  for (const c of chunks) drawChunk(c, t);
  drawDrones(t, dt, r);
  if (tractor && ptr.held > 120) {
    const R = 150 * Math.max(0.8, K);
    ctx.strokeStyle = 'rgba(255,180,74,.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { const ph = ((t / 700) + i / 3) % 1; ctx.beginPath(); ctx.arc(ptr.x, ptr.y, R * (1 - ph), 0, 7); ctx.globalAlpha = ph; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // effects
  for (const bm of beams) { bm.life -= dt / 350; ctx.globalAlpha = Math.max(0, bm.life); ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2; ctx.shadowColor = '#7fe0ff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; }
  for (const rg of ringFx) { rg.life -= dt / 500; ctx.globalAlpha = Math.max(0, rg.life); ctx.strokeStyle = rg.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rg.x, rg.y, 10 + (1 - rg.life) * 50, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
  for (const q of parts) {
    q.life -= dt / 650; ctx.globalAlpha = Math.max(0, q.life);
    if (q.ripple) { ctx.strokeStyle = q.col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, 4 + (0.6 - q.life) * 40, 0, 7); ctx.stroke(); }
    else { q.x += q.vx * dt / 16; q.y += q.vy * dt / 16; q.vx *= 0.95; q.vy *= 0.95; ctx.fillStyle = q.col; ctx.fillRect(q.x - q.sz / 2, q.y - q.sz / 2, q.sz, q.sz); }
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of texts) {
    f.life -= dt / 1000; f.y -= dt * 0.03; ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
    ctx.font = `700 ${f.big ? 19 : 15}px "Barlow Semi Condensed", sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = '#05060c'; ctx.strokeText(f.txt, f.x, f.y); ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  // spacewalk tint, low air warning, jump flash
  if (walking) { ctx.fillStyle = 'rgba(140,100,255,.07)'; ctx.fillRect(0, 0, W, H); }
  if (S.res.o2 < r.tank * 0.25) {
    const a = 0.25 + Math.sin(t * 0.006) * 0.12;
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(255,40,60,0)'); vg.addColorStop(1, `rgba(255,40,60,${a})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  if (warp > 0) { warp = Math.max(0, warp - dt / 2200); }
  if (flash > 0) { ctx.fillStyle = `rgba(235,240,255,${flash})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt / 900); }
  filterDead();
}
function filterDead() {
  for (const arr of [parts, texts, beams, ringFx, streaks]) { let j = 0; for (const x of arr) if (x.life > 0) arr[j++] = x; arr.length = j; }
}

window.DSField = {
  init(state, h) { S = state; hooks = h; resize(); seed(); },
  setState(state) { S = state; seed(); },
  resize, frame,
  jumpFx() { warp = 1; flash = 0.9; setTimeout(() => seed(), 600); },
  probeOut() { streaks.push({ out: true, life: 1 }); },
  probeIn() { streaks.push({ out: false, life: 1 }); },
  text(txt, col) { texts.push({ x: ship.x, y: ship.y - 40 * K, txt, col, life: 1.4, big: true }); },
  // test hook: tap the nearest chunk
  tapNearest() { const c = chunks.find(x => !x.dead); if (c) { tapAt(c.x, c.y); return true; } return false; },
  get chunks() { return chunks; },
};
})();
