import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { COLOR_INFO, KEYWORD_INFO, cardDef } from '../../shared/cards';
import { ALL_HEXES, LEY_ORBS, deployRows, key, toWorld, type Hex } from '../../shared/hex';
import type { GameEvent, GameState, Unit } from '../../shared/types';
import { sfx } from './audio';

export type HL = 'move' | 'attack' | 'attackFar' | 'deploy' | 'friendly' | 'enemy' | 'selected' | 'hover' | 'dest';

const HL_STYLE: Record<HL, { color: number; opacity: number; pulse?: boolean }> = {
  move: { color: 0x3ab0ff, opacity: 0.35 },
  dest: { color: 0x7fd8ff, opacity: 0.75 },
  attack: { color: 0xff3b3b, opacity: 0.6, pulse: true },
  attackFar: { color: 0xff7a3b, opacity: 0.3 },
  deploy: { color: 0x40ffd0, opacity: 0.4, pulse: true },
  friendly: { color: 0x50ff70, opacity: 0.55, pulse: true },
  enemy: { color: 0xff4060, opacity: 0.6, pulse: true },
  selected: { color: 0xffe066, opacity: 0.7 },
  hover: { color: 0xffffff, opacity: 0.25 },
};

const MY_COLOR = 0x3a9bff;
const ENEMY_COLOR = 0xff3d5a;
const NEUTRAL_ORB = 0xb68cff;
const TILE_TOP = 0;

const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

interface Tween { start: number; dur: number; fn: (t: number) => void; ease: (t: number) => number; resolve: () => void }

// ───────────── canvas textures ─────────────
const emojiCache = new Map<string, THREE.Texture>();
function emojiTexture(icon: string) {
  let tex = emojiCache.get(icon);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(icon, 64, 72);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(icon, tex);
  return tex;
}

function textSprite(text: string, color: string, size = 64, outline = '#000') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = `900 ${size}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = outline; ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color; ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2, 1, 1);
  sp.renderOrder = 10;
  return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ───────────── unit visuals ─────────────
const KW_SLOTS = 5;
const KW_SIZE = 0.64;
// Barrier and Flying also show on the model itself (bubble, hovering), but get a badge so every keyword reads the same way.
const KW_ORDER = ['guardian', 'firstStrike', 'deadly', 'flying', 'barrier', 'drain', 'regenerate', 'siege', 'swift'] as const;
const KW_COLOR: Partial<Record<string, string>> = {
  guardian: '#7fb2ff', firstStrike: '#ffd76a', deadly: '#b07cff', flying: '#bfe9ff', barrier: '#ffe9a0',
  drain: '#ff5a6e', regenerate: '#7ddc6a', siege: '#ff9a4d', swift: '#9ff5ff',
};

class UnitVisual {
  group = new THREE.Group();
  body = new THREE.Group();
  icon: THREE.Sprite;
  stats: THREE.Sprite;
  statCanvas = document.createElement('canvas');
  statTex: THREE.CanvasTexture;
  ring: THREE.Mesh;
  bubble: THREE.Mesh;
  ice: THREE.Mesh;
  roots: THREE.Mesh;
  base: THREE.Mesh;
  status: THREE.Sprite;
  statusCanvas = document.createElement('canvas');
  statusTex: THREE.CanvasTexture;
  rangeMarks = new THREE.Group();
  rangeBadge: THREE.Sprite | null = null;
  kwCanvas = document.createElement('canvas');
  kwTex: THREE.CanvasTexture;
  kwBadges: THREE.Sprite;
  data: Unit;
  flyHeight = 0;
  canActNow = false;
  mine: boolean;

  constructor(u: Unit, mine: boolean) {
    this.data = structuredClone(u);
    this.mine = mine;
    const d = cardDef(u.cardId);
    const col = new THREE.Color(COLOR_INFO[d.color].hex);
    const ownerCol = mine ? MY_COLOR : ENEMY_COLOR;

    this.base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x1a1d26, metalness: 0.6, roughness: 0.35, emissive: ownerCol, emissiveIntensity: 0.25 }),
    );
    this.base.position.y = 0.11;
    this.base.castShadow = true;
    this.base.userData.uid = u.uid;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 48), new THREE.MeshStandardMaterial({ color: ownerCol, emissive: ownerCol, emissiveIntensity: 1.4 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 32), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 }));
    top.position.y = 0.25;
    this.body.add(this.base, rim, top);

    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(d.icon), transparent: true, alphaTest: 0.1 }));
    this.icon.scale.set(1.25, 1.25, 1);
    this.icon.position.y = 0.95;
    this.body.add(this.icon);

    this.statCanvas.width = 256; this.statCanvas.height = 96;
    this.statTex = new THREE.CanvasTexture(this.statCanvas);
    this.statTex.colorSpace = THREE.SRGBColorSpace;
    this.stats = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.statTex, transparent: true, depthTest: false }));
    this.stats.scale.set(1.5, 0.56, 1);
    this.stats.position.set(0, 0.42, 0);
    this.stats.renderOrder = 5;
    this.group.add(this.stats);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.86, 48), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
    this.group.add(this.ring);

    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffc94d, emissiveIntensity: 0.6, transparent: true, opacity: 0.22, depthWrite: false }));
    this.bubble.position.y = 0.7;
    this.body.add(this.bubble);

    this.ice = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), new THREE.MeshStandardMaterial({ color: 0xaee8ff, emissive: 0x6fd0ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.35, depthWrite: false, flatShading: true }));
    this.ice.position.y = 0.75; this.ice.scale.set(1, 1.25, 1);
    this.body.add(this.ice);

    this.roots = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.06, 64, 6, 2, 5), new THREE.MeshStandardMaterial({ color: 0x5b8f2e, emissive: 0x2f5a12, roughness: 0.9 }));
    this.roots.rotation.x = Math.PI / 2; this.roots.position.y = 0.3; this.roots.scale.set(1.1, 1.1, 0.6);
    this.body.add(this.roots);

    // Keyword badges sit in a row under the stats, on the base, so they don't float with flyers.
    this.kwCanvas.width = 80 * KW_SLOTS; this.kwCanvas.height = 80;
    this.kwTex = new THREE.CanvasTexture(this.kwCanvas);
    this.kwTex.colorSpace = THREE.SRGBColorSpace;
    this.kwBadges = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.kwTex, transparent: true, depthTest: false }));
    this.kwBadges.scale.set(KW_SIZE * KW_SLOTS, KW_SIZE, 1);
    this.kwBadges.position.set(0, 0.42 - 0.28 - KW_SIZE * 0.42, 0);
    this.kwBadges.renderOrder = 6;
    this.group.add(this.kwBadges);

    // Status badges (summoning sickness, frozen, rooted) float above the unit.
    this.statusCanvas.width = 256; this.statusCanvas.height = 72;
    this.statusTex = new THREE.CanvasTexture(this.statusCanvas);
    this.statusTex.colorSpace = THREE.SRGBColorSpace;
    this.status = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.statusTex, transparent: true, depthTest: false }));
    this.status.scale.set(2.2, 0.62, 1);
    this.status.position.y = 1.95;
    this.status.renderOrder = 6;
    this.body.add(this.status);

    // Ranged units get a dashed blue ring around their base and a range badge.
    if ((d.range ?? 1) > 1 || u.range > 1) this.addRangeMarks(u.range);

    this.group.add(this.body);
    this.flyHeight = u.kw.includes('flying') ? 0.45 : 0;
    this.place(u);
    this.refresh(u, false, 0);
  }

  addRangeMarks(range: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fc8ff });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.07), mat);
      m.position.set(Math.cos(a) * 0.86, 0.06, Math.sin(a) * 0.86);
      m.rotation.y = -a + Math.PI / 2;
      this.rangeMarks.add(m);
    }
    this.body.add(this.rangeMarks);
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1b5fb8'; ctx.beginPath(); ctx.arc(48, 48, 44, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = '#bfe4ff'; ctx.stroke();
    ctx.font = '40px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏹', 40, 44);
    ctx.font = '900 30px Inter, sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
    ctx.strokeText(String(range), 70, 70); ctx.fillText(String(range), 70, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.rangeBadge = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.rangeBadge.scale.set(0.72, 0.72, 1);
    this.rangeBadge.position.set(-0.7, 1.35, 0);
    this.rangeBadge.renderOrder = 6;
    this.body.add(this.rangeBadge);
  }


  place(h: Hex) {
    const w = toWorld(h);
    this.group.position.set(w.x, TILE_TOP, w.z);
  }

  refresh(u: Unit, canAct: boolean, round: number) {
    this.data = structuredClone(u);
    const d = cardDef(u.cardId);
    this.canActNow = canAct;
    (this.bubble.visible as boolean) = u.kw.includes('barrier');
    const frozen = u.frozenUntil >= round;
    this.ice.visible = frozen;
    this.roots.visible = u.rootedUntil >= round;
    this.flyHeight = u.kw.includes('flying') ? 0.45 : 0;
    const sick = u.summonedRound === round && !u.kw.includes('swift') && !u.exhausted;
    const exhausted = u.exhausted || sick;
    (this.icon.material as THREE.SpriteMaterial).color.set(frozen ? 0x9fdcff : exhausted ? 0x6f7384 : 0xffffff);
    // Lay spent units slightly back so "already acted" reads at a glance.
    this.icon.material.rotation = u.exhausted && !frozen ? -0.35 : 0;

    const sc = this.statusCanvas.getContext('2d')!;
    sc.clearRect(0, 0, 256, 72);
    const tags: [string, string][] = [];
    if (frozen) tags.push(['❄️', '#6fd0ff']);
    else if (sick) tags.push(['💤', '#b9a8ff']);
    else if (u.exhausted) tags.push(['✓', '#9aa0b4']);
    if (u.rootedUntil >= round) tags.push(['🕸️', '#8fd05a']);
    if (u.tempAtk > 0) tags.push(['🔥', '#ffb04d']);
    const w = 64;
    tags.forEach(([t, col], i) => {
      const x = 128 - (tags.length * w) / 2 + i * w + w / 2;
      sc.fillStyle = 'rgba(10,8,20,0.8)'; sc.beginPath(); sc.arc(x, 36, 30, 0, Math.PI * 2); sc.fill();
      sc.lineWidth = 4; sc.strokeStyle = col; sc.stroke();
      sc.font = t === '✓' ? '900 34px Inter, sans-serif' : '34px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      sc.textAlign = 'center'; sc.textBaseline = 'middle'; sc.fillStyle = col;
      sc.fillText(t, x, 38);
    });
    this.statusTex.needsUpdate = true;
    if (u.range > 1 && !this.rangeBadge) this.addRangeMarks(u.range);
    this.drawKeywords(u, sick || u.summonedRound === round);

    const ctx = this.statCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 96);
    const atk = Math.max(0, u.atk + u.tempAtk);
    const badge = (x: number, val: number, fill: string, color: string) => {
      ctx.fillStyle = fill; roundRect(ctx, x, 14, 84, 68, 22); ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.font = '900 54px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(String(val), x + 42, 50);
      ctx.fillStyle = color; ctx.fillText(String(val), x + 42, 50);
    };
    badge(14, atk, '#d9822b', atk > (d.atk ?? 0) ? '#b6ff9a' : atk < (d.atk ?? 0) ? '#ffb0b0' : '#fff');
    badge(158, u.hp, '#c22d43', u.hp < u.maxHp ? '#ffb0b0' : u.hp > (d.hp ?? 0) ? '#b6ff9a' : '#fff');
    this.statTex.needsUpdate = true;
  }

  /** One round icon per combat keyword, in a fixed order so every unit's row reads the same way. */
  private drawKeywords(u: Unit, justSummoned: boolean) {
    const kws = KW_ORDER.filter((k) => u.kw.includes(k) && (k !== 'swift' || justSummoned)).slice(0, KW_SLOTS);
    const c = this.kwCanvas.getContext('2d')!;
    c.clearRect(0, 0, 80 * KW_SLOTS, 80);
    kws.forEach((k, i) => {
      const x = 40 * KW_SLOTS - (kws.length * 80) / 2 + 40 + i * 80;
      c.fillStyle = 'rgba(12,10,24,0.85)'; c.beginPath(); c.arc(x, 40, 34, 0, Math.PI * 2); c.fill();
      c.lineWidth = 5; c.strokeStyle = KW_COLOR[k] ?? '#ffd76a'; c.stroke();
      c.font = '38px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(KEYWORD_INFO[k].icon, x, 43);
    });
    this.kwTex.needsUpdate = true;
  }

  tick(time: number, myTurn: boolean) {
    const fly = this.flyHeight;
    this.body.position.y = fly + (fly ? Math.sin(time * 2 + this.data.uid) * 0.08 : 0);
    this.icon.position.y = 0.95 + Math.sin(time * 1.6 + this.data.uid * 1.3) * 0.04;
    // Ready ring: units that can still act this round. Pulses for your units on your turn.
    const m = this.ring.material as THREE.MeshBasicMaterial;
    m.color.setHex(this.mine ? 0xffe066 : 0xff7a3d);
    m.opacity = !this.canActNow ? 0 : this.mine && myTurn ? 0.6 + Math.sin(time * 4) * 0.3 : 0.35;
    this.bubble.rotation.y = time;
  }
}

// ───────────── particles ─────────────
class Burst {
  points: THREE.Points;
  vel: Float32Array;
  life = 0;
  constructor(public maxLife: number, pos: THREE.Vector3, color: THREE.Color, count: number, speed: number, size: number, up = 1, spread = 1) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = pos.x + (Math.random() - 0.5) * 0.3 * spread;
      p[i * 3 + 1] = pos.y + Math.random() * 0.3;
      p[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.3 * spread;
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * speed;
      this.vel[i * 3] = Math.cos(a) * s * spread;
      this.vel[i * 3 + 1] = (0.5 + Math.random()) * speed * up;
      this.vel[i * 3 + 2] = Math.sin(a) * s * spread;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, map: sparkTexture(),
    }));
  }
  update(dt: number) {
    this.life += dt;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += this.vel[i] * dt; a[i + 1] += this.vel[i + 1] * dt; a[i + 2] += this.vel[i + 2] * dt;
      this.vel[i + 1] -= 3 * dt;
      this.vel[i] *= 0.97; this.vel[i + 2] *= 0.97;
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - this.life / this.maxLife);
    return this.life < this.maxLife;
  }
}

let _spark: THREE.Texture | null = null;
function sparkTexture() {
  if (_spark) return _spark;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _spark = new THREE.CanvasTexture(c);
  return _spark;
}

const FX_COLORS: Record<string, number> = {
  fire: 0xff6a1a, explosion: 0xff8a2a, frost: 0x8fe3ff, lightning: 0xfff36a, holy: 0xffe27a, shadow: 0xb35cff,
  poison: 0x7dff5a, roots: 0x7dbf3a, wave: 0x3ab8ff, start: 0xffffff, summon: 0xffffff,
};

// ───────────── the scene ─────────────
export class BoardScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  clock = new THREE.Clock();
  tiles = new Map<string, { mesh: THREE.Mesh; overlay: THREE.Mesh; hl: HL | null }>();
  units = new Map<number, UnitVisual>();
  orbs: { hex: Hex; orb: THREE.Mesh; light: THREE.PointLight; beam: THREE.Mesh; ring: THREE.Mesh; owner: number | null }[] = [];
  sanctums: { group: THREE.Group; core: THREE.Mesh; shell: THREE.Mesh; label: THREE.Sprite; hp: number; light: THREE.PointLight; hl: boolean; ring: THREE.Mesh }[] = [];
  tweens: Tween[] = [];
  bursts: Burst[] = [];
  floaters: { sp: THREE.Sprite; life: number; vy: number }[] = [];
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2(-10, -10);
  seat = 0;
  menuMode = true;
  myTurn = false;
  shake = 0;
  camBase = new THREE.Vector3();
  camTarget = new THREE.Vector3();
  motes!: THREE.Points;
  hoverKey: string | null = null;
  hoverSanctum: number | null = null;
  speed = 1;
  guide: THREE.Mesh | null = null;

  onHexClick: (h: Hex) => void = () => {};
  onHexHover: (h: Hex | null) => void = () => {};
  onSanctumClick: (p: number) => void = () => {};
  onSanctumHover: (p: number | null) => void = () => {};
  onRightClick: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.82));
    this.composer.addPass(new OutputPass());

    this.buildWorld();
    this.setSeat(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onRightClick(); });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ───── world construction ─────
  private buildWorld() {
    const s = this.scene;
    s.background = new THREE.Color(0x07060f);
    s.fog = new THREE.Fog(0x07060f, 26, 60);

    s.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a0f2a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(-6, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12;
    s.add(sun);
    const rimLight = new THREE.DirectionalLight(0x8a5cff, 0.6);
    rimLight.position.set(6, 6, -10);
    s.add(rimLight);

    // Floating island beneath the board.
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(10.5, 6, 3.2, 6, 1),
      new THREE.MeshStandardMaterial({ color: 0x241c33, roughness: 0.95, flatShading: true }),
    );
    island.rotation.y = Math.PI / 6;
    island.position.y = -1.95;
    island.scale.set(1.15, 1, 1.35);
    island.receiveShadow = true;
    s.add(island);
    const glow = new THREE.Mesh(new THREE.RingGeometry(11, 15, 6), new THREE.MeshBasicMaterial({ color: 0x5a2bff, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2; glow.rotation.z = Math.PI / 6; glow.position.y = -0.4; glow.scale.set(1, 1.2, 1);
    s.add(glow);

    // Tiles
    const tileGeo = new THREE.CylinderGeometry(0.94, 0.98, 0.3, 6);
    const overlayGeo = new THREE.CircleGeometry(0.9, 6);
    overlayGeo.rotateX(-Math.PI / 2);
    overlayGeo.rotateY(Math.PI / 6 * 0); // circle with 6 segments: first vertex at +x → rotate to pointy-top
    overlayGeo.rotateY(Math.PI / 2);
    for (const h of ALL_HEXES) {
      const w = toWorld(h);
      const shade = 0.85 + Math.random() * 0.2;
      const base = new THREE.Color(0x3b3552).multiplyScalar(shade);
      const mesh = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({ color: base, roughness: 0.8, metalness: 0.15 }));
      mesh.position.set(w.x, TILE_TOP - 0.15, w.z);
      mesh.receiveShadow = true;
      mesh.userData.hex = h;
      const overlay = new THREE.Mesh(overlayGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      overlay.position.set(w.x, TILE_TOP + 0.012, w.z);
      overlay.renderOrder = 1;
      s.add(mesh, overlay);
      this.tiles.set(key(h), { mesh, overlay, hl: null });
    }

    // Ley Orbs
    for (const h of LEY_ORBS) {
      const w = toWorld(h);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 6), new THREE.MeshBasicMaterial({ color: NEUTRAL_ORB, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 2; ring.position.set(w.x, TILE_TOP + 0.02, w.z);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), new THREE.MeshStandardMaterial({ color: NEUTRAL_ORB, emissive: NEUTRAL_ORB, emissiveIntensity: 2.2 }));
      orb.position.set(w.x, 2.3, w.z);
      const light = new THREE.PointLight(NEUTRAL_ORB, 6, 5, 1.5);
      light.position.set(w.x, 1.6, w.z);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 2.3, 12, 1, true), new THREE.MeshBasicMaterial({ color: NEUTRAL_ORB, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(w.x, 1.15, w.z);
      s.add(ring, orb, light, beam);
      this.orbs.push({ hex: h, orb, light, beam, ring, owner: null });
    }

    // Sanctums (index = player)
    for (let p = 0; p < 2; p++) {
      const group = new THREE.Group();
      const z = p === 0 ? 7.35 : -7.35;
      group.position.set(0, 0, z);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x2a2440, metalness: 0.5, roughness: 0.5, flatShading: true }));
      ped.position.y = 0.0; ped.castShadow = true; ped.receiveShadow = true;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1.15, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, clearcoat: 1, depthWrite: false }));
      shell.position.y = 1.75;
      shell.userData.sanctum = p;
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
      core.position.y = 1.75;
      core.userData.sanctum = p;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.04, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      ring.position.y = 1.75; ring.rotation.x = Math.PI / 2.4;
      const light = new THREE.PointLight(0xffffff, 18, 9, 1.6);
      light.position.y = 1.8;
      const label = textSprite('20', '#fff', 72);
      label.position.y = 3.5;
      label.scale.set(2.2, 1.1, 1);
      group.add(ped, shell, core, ring, light, label);
      s.add(group);
      this.sanctums.push({ group, core, shell, label, hp: 20, light, hl: false, ring });
    }

    // Starfield + floating motes
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(70 + Math.random() * 30);
      if (v.y < -10) v.y = -v.y;
      sp.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfc6ff, size: 0.35, sizeAttenuation: true, fog: false })));

    const moteGeo = new THREE.BufferGeometry();
    const mp = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) mp.set([(Math.random() - 0.5) * 24, Math.random() * 8, (Math.random() - 0.5) * 22], i * 3);
    moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xb48cff, size: 0.12, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, map: sparkTexture() }));
    s.add(this.motes);
  }

  setSeat(seat: number) {
    this.seat = seat;
    const dir = seat === 0 ? 1 : -1;
    this.camBase.set(0, 20.5, 12.5 * dir);
    this.camTarget.set(0, 0, 1.2 * dir);
    for (let p = 0; p < 2; p++) this.colorSanctum(p);
    this.recolorTiles();
  }

  private recolorTiles() {
    for (const h of ALL_HEXES) {
      const t = this.tiles.get(key(h))!;
      const m = t.mesh.material as THREE.MeshStandardMaterial;
      const base = new THREE.Color(0x3b3552).multiplyScalar(0.85 + ((h.c * 7 + h.r * 13) % 5) * 0.05);
      if (deployRows(this.seat).includes(h.r)) base.lerp(new THREE.Color(MY_COLOR), 0.12);
      if (deployRows(1 - this.seat).includes(h.r)) base.lerp(new THREE.Color(ENEMY_COLOR), 0.11);
      m.color.copy(base);
    }
  }

  private colorSanctum(p: number) {
    const s = this.sanctums[p];
    const col = new THREE.Color(p === this.seat ? MY_COLOR : ENEMY_COLOR);
    (s.core.material as THREE.MeshStandardMaterial).color.copy(col);
    (s.core.material as THREE.MeshStandardMaterial).emissive.copy(col);
    (s.ring.material as THREE.MeshBasicMaterial).color.copy(col);
    s.light.color.copy(col);
  }

  setMenuMode(on: boolean) {
    this.menuMode = on;
    for (const s of this.sanctums) s.label.visible = !on;
    if (on) { for (const v of this.units.values()) this.scene.remove(v.group); this.units.clear(); this.clearHighlights(); }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Widen the view on tall/narrow screens so the whole board stays visible.
    this.camera.fov = Math.min(80, Math.max(42, THREE.MathUtils.radToDeg(2 * Math.atan(0.37 / (w / h)))));
    // Pull the camera back on narrow screens so the whole board fits.
    this.camera.updateProjectionMatrix();
  }

  // ───── state sync ─────
  sync(v: GameState, seat: number, myTurn: boolean, canAct: (u: Unit) => boolean) {
    this.myTurn = myTurn;
    const alive = new Set<number>();
    for (const u of v.units) {
      alive.add(u.uid);
      let vis = this.units.get(u.uid);
      if (!vis) {
        vis = new UnitVisual(u, u.owner === seat);
        this.units.set(u.uid, vis);
        this.scene.add(vis.group);
      }
      vis.place(u);
      vis.group.scale.setScalar(1);
      vis.refresh(u, canAct(u), v.round);
    }
    for (const [uid, vis] of this.units) if (!alive.has(uid)) { this.scene.remove(vis.group); this.units.delete(uid); }
    for (const o of this.orbs) {
      const u = v.units.find((x) => x.c === o.hex.c && x.r === o.hex.r);
      this.setOrbOwner(o, u ? u.owner : null);
    }
    for (let p = 0; p < 2; p++) this.setSanctumHP(p, v.players[p].sanctum);
  }

  private setOrbOwner(o: (typeof this.orbs)[number], owner: number | null) {
    o.owner = owner;
    const col = new THREE.Color(owner === null ? NEUTRAL_ORB : owner === this.seat ? MY_COLOR : ENEMY_COLOR);
    const m = o.orb.material as THREE.MeshStandardMaterial;
    m.color.copy(col); m.emissive.copy(col);
    o.light.color.copy(col);
    (o.beam.material as THREE.MeshBasicMaterial).color.copy(col);
    (o.ring.material as THREE.MeshBasicMaterial).color.copy(col);
  }

  setSanctumHP(p: number, hp: number) {
    const s = this.sanctums[p];
    if (s.hp === hp && s.label.userData.set) return;
    s.hp = hp;
    const old = s.label;
    const col = hp > 12 ? '#ffffff' : hp > 6 ? '#ffd76a' : '#ff6b6b';
    const label = textSprite(String(Math.max(0, hp)), col, 72);
    label.position.copy(old.position); label.scale.copy(old.scale);
    label.userData.set = true;
    label.visible = old.visible;
    s.group.remove(old); s.group.add(label); s.label = label;
    const frac = Math.max(0, hp) / 20;
    (s.core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + frac * 2;
    s.core.scale.setScalar(0.6 + frac * 0.4);
  }

  // ───── highlights ─────
  clearHighlights() {
    for (const t of this.tiles.values()) t.hl = null;
    for (const s of this.sanctums) s.hl = false;
  }

  setHighlights(map: Map<string, HL>, sanctumTarget: number | null) {
    for (const [k, t] of this.tiles) t.hl = map.get(k) ?? null;
    this.sanctums.forEach((s, i) => (s.hl = i === sanctumTarget));
  }

  /** Glowing tube showing a move path and/or an attack arc. Pass null to hide. */
  showGuide(path: Hex[] | null, attackTo: THREE.Vector3 | null) {
    if (this.guide) { this.scene.remove(this.guide); this.guide.geometry.dispose(); this.guide = null; }
    if (!path || (path.length < 2 && !attackTo)) return;
    const pts = path.map((h) => this.hexPos(h, 0.18));
    if (attackTo) {
      const from = pts[pts.length - 1];
      const mid = from.clone().lerp(attackTo, 0.5); mid.y += 1.2;
      const arc = new THREE.QuadraticBezierCurve3(from.clone().setY(0.6), mid, attackTo.clone());
      pts.push(...arc.getPoints(12).slice(1));
    }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const geo = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), 0.06, 6, false);
    this.guide = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: attackTo ? 0xff5a5a : 0x7fd8ff, transparent: true, opacity: 0.85, depthTest: false }));
    this.guide.renderOrder = 4;
    this.scene.add(this.guide);
  }

  // ───── input ─────
  private pick(e: MouseEvent): { hex?: Hex; sanctum?: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objs: THREE.Object3D[] = [];
    for (const s of this.sanctums) objs.push(s.shell);
    for (const v of this.units.values()) objs.push(v.base, v.icon);
    for (const t of this.tiles.values()) objs.push(t.mesh);
    const hits = this.raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      if (h.object.userData.sanctum !== undefined) return { sanctum: h.object.userData.sanctum };
      if (h.object.userData.hex) return { hex: h.object.userData.hex };
      for (const v of this.units.values()) if (v.base === h.object || v.icon === h.object) return { hex: { c: v.data.c, r: v.data.r } };
    }
    return {};
  }

  private pointerMove(e: PointerEvent) {
    if (this.menuMode) return;
    const p = this.pick(e);
    const k = p.hex ? key(p.hex) : null;
    if (k !== this.hoverKey) { this.hoverKey = k; this.onHexHover(p.hex ?? null); }
    const sn = p.sanctum ?? null;
    if (sn !== this.hoverSanctum) { this.hoverSanctum = sn; this.onSanctumHover(sn); }
    this.renderer.domElement.style.cursor = p.hex || p.sanctum !== undefined ? 'pointer' : 'default';
  }

  private click(e: MouseEvent) {
    if (this.menuMode) return;
    const p = this.pick(e);
    if (p.sanctum !== undefined) this.onSanctumClick(p.sanctum);
    else if (p.hex) this.onHexClick(p.hex);
    else this.onRightClick();
  }

  /** Screen position of a hex (for HUD tooltips). */
  screenPos(h: Hex, y = 1.5) {
    const w = toWorld(h);
    const v = new THREE.Vector3(w.x, y, w.z).project(this.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  // ───── animation primitives ─────
  tween(dur: number, fn: (t: number) => void, e: (t: number) => number = ease.outCubic): Promise<void> {
    return new Promise((resolve) => this.tweens.push({ start: this.clock.elapsedTime, dur: dur / this.speed, fn, ease: e, resolve }));
  }
  wait(ms: number) { return this.tween(ms / 1000, () => {}); }

  burst(at: THREE.Vector3, color: number, count = 30, speed = 2.5, size = 0.25, life = 0.8, up = 1, spread = 1) {
    const b = new Burst(life, at, new THREE.Color(color), count, speed, size, up, spread);
    this.bursts.push(b);
    this.scene.add(b.points);
  }

  floatText(at: THREE.Vector3, text: string, color: string, big = false) {
    const sp = textSprite(text, color, big ? 84 : 64);
    sp.position.copy(at);
    sp.scale.multiplyScalar(big ? 1.3 : 1);
    this.scene.add(sp);
    this.floaters.push({ sp, life: 0, vy: 1.4 });
  }

  hexPos(h: Hex, y = 0.8) { const w = toWorld(h); return new THREE.Vector3(w.x, y, w.z); }
  sanctumPos(p: number) { return new THREE.Vector3(0, 1.75, p === 0 ? 7.35 : -7.35); }

  private unitPos(uid: number, y = 0.8) {
    const v = this.units.get(uid);
    return v ? new THREE.Vector3(v.group.position.x, y, v.group.position.z) : new THREE.Vector3();
  }

  async projectile(from: THREE.Vector3, to: THREE.Vector3, color: number, dur = 0.32, size = 0.18) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), new THREE.MeshBasicMaterial({ color }));
    const light = new THREE.PointLight(color, 4, 3);
    m.add(light);
    this.scene.add(m);
    const mid = from.clone().lerp(to, 0.5); mid.y += 1.2 + from.distanceTo(to) * 0.12;
    await this.tween(dur, (t) => {
      const a = from.clone().lerp(mid, t), b = mid.clone().lerp(to, t);
      m.position.copy(a.lerp(b, t));
      if (Math.random() < 0.6) this.burst(m.position.clone(), color, 2, 0.4, 0.15, 0.4);
    }, ease.linear);
    this.scene.remove(m);
    this.burst(to, color, 18, 2, 0.22, 0.5);
  }

  // ───── event playback ─────
  async play(e: GameEvent, v: GameState, seat: number) {
    switch (e.t) {
      case 'summon': {
        const vis = new UnitVisual(e.unit, e.unit.owner === seat);
        this.units.get(e.uid) && this.scene.remove(this.units.get(e.uid)!.group);
        this.units.set(e.uid, vis);
        this.scene.add(vis.group);
        vis.group.scale.setScalar(0.01);
        const col = new THREE.Color(COLOR_INFO[cardDef(e.unit.cardId).color].hex).getHex();
        this.burst(this.hexPos(e.unit, 0.3), col, 40, 3, 0.25, 0.9, 1.4);
        sfx.summon();
        await this.tween(0.38, (t) => vis.group.scale.setScalar(Math.max(0.01, t)), ease.outBack);
        break;
      }
      case 'move': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.move();
        for (let i = 1; i < e.path.length; i++) {
          const a = toWorld(e.path[i - 1]), b = toWorld(e.path[i]);
          await this.tween(0.16, (t) => {
            vis.group.position.set(a.x + (b.x - a.x) * t, TILE_TOP + Math.sin(t * Math.PI) * 0.35, a.z + (b.z - a.z) * t);
          }, ease.inOutQuad);
        }
        vis.data.c = e.path[e.path.length - 1].c; vis.data.r = e.path[e.path.length - 1].r;
        break;
      }
      case 'teleport': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        this.burst(vis.group.position.clone().setY(0.6), 0x3ab8ff, 20, 2);
        await this.tween(0.15, (t) => vis.group.scale.setScalar(1 - t * 0.99));
        vis.place(e.to);
        vis.data.c = e.to.c; vis.data.r = e.to.r;
        this.burst(this.hexPos(e.to, 0.6), 0x3ab8ff, 20, 2);
        await this.tween(0.2, (t) => vis.group.scale.setScalar(0.01 + t), ease.outBack);
        break;
      }
      case 'attack': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        const to = 'uid' in e.target ? this.unitPos(e.target.uid) : this.sanctumPos(e.target.sanctum);
        const col = new THREE.Color(COLOR_INFO[cardDef(vis.data.cardId).color].hex).getHex();
        if (e.ranged) {
          await this.projectile(this.unitPos(e.uid, 1.0), to, col);
        } else {
          const start = vis.group.position.clone();
          const dir = to.clone().setY(0).sub(start.clone().setY(0));
          const lunge = Math.min(0.7, dir.length() * 0.55);
          dir.normalize();
          await this.tween(0.13, (t) => vis.group.position.copy(start).addScaledVector(dir, -0.15 * t), ease.outCubic);
          await this.tween(0.1, (t) => vis.group.position.copy(start).addScaledVector(dir, -0.15 + (lunge + 0.15) * t), ease.linear);
          this.burst(to.clone(), 0xffffff, 12, 2.5, 0.2, 0.35);
          this.tween(0.22, (t) => vis.group.position.copy(start).addScaledVector(dir, lunge * (1 - t)), ease.outCubic);
        }
        break;
      }
      case 'damage': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.hit();
        vis.data.hp -= e.amount;
        vis.refresh(vis.data, false, v.round);
        this.floatText(this.unitPos(e.uid, 1.6), `-${e.amount}`, '#ff5a5a', e.amount >= 4);
        this.burst(this.unitPos(e.uid, 0.8), 0xff3030, 14, 2, 0.2, 0.5);
        const base = vis.body.position.x;
        await this.tween(0.25, (t) => { vis.body.position.x = base + Math.sin(t * 30) * 0.08 * (1 - t); });
        vis.body.position.x = base;
        break;
      }
      case 'sanctumDamage': {
        const s = this.sanctums[e.p];
        e.amount >= 3 ? sfx.bigHit() : sfx.hit();
        this.setSanctumHP(e.p, s.hp - e.amount);
        this.floatText(this.sanctumPos(e.p).add(new THREE.Vector3(0, 1.6, 0)), `-${e.amount}`, '#ff4d4d', true);
        this.burst(this.sanctumPos(e.p), e.p === seat ? MY_COLOR : ENEMY_COLOR, 50, 4, 0.3, 0.9);
        this.shake = Math.min(0.6, 0.12 + e.amount * 0.06);
        const g = s.group;
        await this.tween(0.35, (t) => { g.position.x = Math.sin(t * 40) * 0.15 * (1 - t); });
        g.position.x = 0;
        break;
      }
      case 'sanctumHeal': {
        sfx.heal();
        this.setSanctumHP(e.p, this.sanctums[e.p].hp + e.amount);
        this.floatText(this.sanctumPos(e.p).add(new THREE.Vector3(0, 1.6, 0)), `+${e.amount}`, '#7dff8a', true);
        this.burst(this.sanctumPos(e.p), 0x7dff8a, 30, 2, 0.25, 0.8, 1.5);
        await this.wait(250);
        break;
      }
      case 'heal': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.heal();
        vis.data.hp += e.amount;
        vis.refresh(vis.data, false, v.round);
        this.floatText(this.unitPos(e.uid, 1.6), `+${e.amount}`, '#7dff8a');
        this.burst(this.unitPos(e.uid, 0.5), 0x7dff8a, 16, 1.5, 0.2, 0.7, 1.5);
        await this.wait(200);
        break;
      }
      case 'barrier': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.barrier();
        vis.data.kw = vis.data.kw.filter((k) => k !== 'barrier');
        vis.refresh(vis.data, false, v.round);
        this.floatText(this.unitPos(e.uid, 1.6), 'Blocked!', '#ffe27a');
        this.burst(this.unitPos(e.uid, 0.8), 0xffe27a, 30, 3, 0.22, 0.6);
        await this.wait(250);
        break;
      }
      case 'death': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.death();
        this.burst(vis.group.position.clone().setY(0.6), 0x8a5cff, 35, 2.2, 0.28, 1.0, 1.2);
        const g = vis.group;
        await this.tween(0.4, (t) => { g.scale.setScalar(Math.max(0.01, 1 - t)); g.position.y = -t * 0.4; g.rotation.y = t * 3; }, ease.inOutQuad);
        this.scene.remove(g);
        this.units.delete(e.uid);
        break;
      }
      case 'levelUp': {
        const old = this.units.get(e.uid);
        if (old) this.scene.remove(old.group);
        const vis = new UnitVisual(e.unit, e.unit.owner === seat);
        this.units.set(e.uid, vis);
        this.scene.add(vis.group);
        sfx.levelUp();
        const at = vis.group.position.clone().setY(0.8);
        this.burst(at, 0xffd76a, 80, 4, 0.35, 1.2, 1.6);
        this.burst(at, 0xffffff, 40, 2.5, 0.25, 0.9, 2);
        this.floatText(at.clone().setY(2.2), 'LEVEL UP!', '#ffd76a', true);
        this.shake = 0.3;
        await this.tween(0.6, (t) => vis.group.scale.setScalar(1.8 - 0.8 * t), ease.outBack);
        break;
      }
      case 'bounce': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.spell();
        const g = vis.group;
        this.burst(g.position.clone().setY(0.6), 0x3ab8ff, 25, 2.5);
        await this.tween(0.35, (t) => { g.position.y = t * 3; g.scale.setScalar(Math.max(0.01, 1 - t)); });
        this.scene.remove(g);
        this.units.delete(e.uid);
        break;
      }
      case 'buff': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        const u = v.units.find((x) => x.uid === e.uid);
        if (e.atk || e.hp) {
          sfx.buff();
          vis.data.atk += e.atk; vis.data.hp += e.hp; vis.data.maxHp += e.hp;
          this.floatText(this.unitPos(e.uid, 1.7), `${e.atk >= 0 ? '+' : ''}${e.atk}/${e.hp >= 0 ? '+' : ''}${e.hp}`, '#ffd76a');
        } else if (u) {
          vis.data.kw = [...u.kw];
        }
        vis.refresh(vis.data, false, v.round);
        this.burst(this.unitPos(e.uid, 0.3), 0xffd76a, 18, 1.5, 0.18, 0.8, 2);
        await this.wait(180);
        break;
      }
      case 'freeze': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.freeze();
        vis.data.frozenUntil = Math.max(vis.data.frozenUntil, v.round); vis.data.exhausted = true;
        vis.refresh(vis.data, false, v.round);
        this.burst(this.unitPos(e.uid, 0.8), 0x9fe8ff, 24, 2, 0.2, 0.7);
        await this.wait(180);
        break;
      }
      case 'ready': {
        const vis = this.units.get(e.uid);
        if (!vis) break;
        sfx.buff();
        vis.data.exhausted = false; vis.data.frozenUntil = 0;
        vis.refresh(vis.data, true, v.round);
        this.burst(this.unitPos(e.uid, 0.2), 0xffe066, 20, 1.2, 0.2, 0.8, 2.5);
        await this.wait(150);
        break;
      }
      case 'orbPulse': {
        sfx.orb();
        const o = this.orbs.find((x) => x.hex.c === e.orb.c && x.hex.r === e.orb.r);
        if (!o) break;
        const col = e.p === seat ? MY_COLOR : ENEMY_COLOR;
        this.burst(o.orb.position.clone(), col, 30, 2.5, 0.25, 0.7);
        await this.projectile(o.orb.position.clone(), this.sanctumPos(1 - e.p), col, 0.45, 0.14);
        break;
      }
      case 'fx': {
        const col = FX_COLORS[e.kind] ?? 0xffffff;
        if (e.kind === 'start') break;
        if (e.at) {
          const at = this.hexPos(e.at, 0.6);
          if (e.kind === 'explosion') { sfx.bigHit(); this.burst(at, 0xff9a3a, 60, 4.5, 0.32, 0.8); this.burst(at, 0xffe08a, 30, 2.5, 0.25, 0.6); this.shake = 0.25; }
          else if (e.kind === 'lightning') { sfx.bigHit(); await this.projectile(at.clone().setY(8), at, col, 0.15, 0.12); }
          else if (e.kind === 'fire') { sfx.spell(); await this.projectile(this.sanctumPos(seat).setY(3), at, col, 0.3); }
          else { sfx.spell(); this.burst(at, col, 40, 2.8, 0.26, 0.8, 1.3); }
        } else {
          sfx.spell();
          for (let i = 0; i < 6; i++) this.burst(new THREE.Vector3((Math.random() - 0.5) * 12, 0.5, (Math.random() - 0.5) * 8), col, 25, 2.5, 0.28, 0.9);
        }
        await this.wait(200);
        break;
      }
      default:
        break;
    }
  }

  // ───── frame loop ─────
  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;

    // tweens
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      const t = Math.min(1, (time - tw.start) / tw.dur);
      tw.fn(tw.ease(t));
      if (t >= 1) done.push(tw);
    }
    if (done.length) { this.tweens = this.tweens.filter((t) => !done.includes(t)); done.forEach((t) => t.resolve()); }

    this.bursts = this.bursts.filter((b) => { const alive = b.update(dt); if (!alive) { this.scene.remove(b.points); b.points.geometry.dispose(); } return alive; });
    this.floaters = this.floaters.filter((f) => {
      f.life += dt; f.sp.position.y += f.vy * dt; f.vy *= 0.96;
      (f.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, f.life - 0.6) / 0.5);
      if (f.life > 1.1) { this.scene.remove(f.sp); return false; }
      return true;
    });

    for (const v of this.units.values()) v.tick(time, this.myTurn);
    for (const [, t] of this.tiles) {
      const m = t.overlay.material as THREE.MeshBasicMaterial;
      if (!t.hl) { m.opacity = 0; continue; }
      const st = HL_STYLE[t.hl];
      m.color.setHex(st.color);
      m.opacity = st.pulse ? st.opacity * (0.7 + 0.3 * Math.sin(time * 5)) : st.opacity;
    }
    if (this.hoverKey && !this.menuMode) {
      const t = this.tiles.get(this.hoverKey);
      if (t) { const m = t.overlay.material as THREE.MeshBasicMaterial; m.opacity = Math.max(m.opacity, 0.22) + 0.15; if (!t.hl) m.color.setHex(0xffffff); }
    }
    for (const o of this.orbs) {
      o.orb.position.y = 2.3 + Math.sin(time * 1.5 + o.hex.c) * 0.12;
      o.orb.rotation.y = time * 0.8;
      (o.beam.material as THREE.MeshBasicMaterial).opacity = o.owner === null ? 0.06 : 0.22 + Math.sin(time * 3) * 0.06;
      o.ring.rotation.z = Math.PI / 2 + time * 0.3;
    }
    this.sanctums.forEach((s, i) => {
      s.core.rotation.y = time * 0.6; s.core.rotation.x = time * 0.3;
      s.ring.rotation.z = time * (i ? -0.5 : 0.5);
      s.core.position.y = s.shell.position.y = 1.75 + Math.sin(time * 1.2 + i) * 0.08;
      const pulse = s.hl ? 1.5 + Math.sin(time * 8) * 0.8 : 1;
      s.light.intensity = 14 * pulse;
      (s.shell.material as THREE.MeshPhysicalMaterial).opacity = s.hl ? 0.45 : 0.22;
    });
    const mp = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ma = mp.array as Float32Array;
    for (let i = 1; i < ma.length; i += 3) { ma[i] += dt * 0.25; if (ma[i] > 8) ma[i] = 0; }
    mp.needsUpdate = true;

    // camera
    if (this.menuMode) {
      const a = time * 0.06;
      this.camera.position.set(Math.sin(a) * 19, 11 + Math.sin(time * 0.2) * 1.5, Math.cos(a) * 19);
      this.camera.lookAt(0, 0, 0);
    } else {
      const pos = this.camBase.clone();
      if (this.shake > 0) {
        pos.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
        this.shake = Math.max(0, this.shake - dt * 1.5);
      }
      this.camera.position.lerp(pos, this.shake > 0 ? 1 : 1 - Math.exp(-dt * 4));
      this.camera.lookAt(this.camTarget);
    }
    this.composer.render();
  }
}
