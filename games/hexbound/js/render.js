// three.js battlefield: tiles, props, low-poly units, overlays, animations, floating text.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const Hex = G.Hex;
  const SQ3 = Math.sqrt(3);
  let THREE, renderer, scene, camera, root, overlay, clock;
  let tileMeshes = new Map(), hlMeshes = new Map(), propGroups = new Map(), unitViews = new Map();
  let B = null, center = { x: 0, z: 0 };
  const cam = { tx: 0, tz: 0, yaw: -Math.PI / 2, pitch: 0.95, dist: 17, shake: 0 };
  const tweens = [];
  const particles = [];
  const flickers = [];
  let hoverCb = null, clickCb = null, rightCb = null;
  let raycaster, mouse;
  const S = () => (G.Settings && G.Settings.speed) || 1;
  const wait = (ms) => new Promise(r => setTimeout(r, ms / S()));

  const DT_COLOR = { fire: 0xff7a1a, cold: 0x8fe3ff, radiant: 0xfff2a0, force: 0xc9a0ff, thunder: 0xa0c8ff, lightning: 0xfff36b, poison: 0x8bd448, necrotic: 0x7a3fa0 };

  // ---------- helpers ----------
  function px(h) { return { x: SQ3 * (h.q + h.r / 2) - center.x, z: 1.5 * h.r - center.z }; }
  function topY(t) {
    if (!t) return 0;
    switch (t.terrain) {
      case 'water': return 0.05;
      case 'bridge': return 0.42;
      case 'rough': case 'tent': return 0.34;
      case 'frosting': case 'jam': return 0.36;
      case 'fire': case 'flames': case 'oven': return 0.32;
      default: return 0.3;
    }
  }
  function mat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0.05 }, o)); }
  function tween(dur, fn) {
    return new Promise(res => tweens.push({ t: 0, dur: Math.max(0.01, dur / S()), fn, res }));
  }
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  // ---------- init ----------
  function init(container) {
    THREE = window.THREE;
    root = container;
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    overlay = document.createElement('div'); overlay.className = 'r-overlay'; container.appendChild(overlay);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();
    resize(); window.addEventListener('resize', resize);
    bindInput();
    requestAnimationFrame(loop);
  }
  function resize() {
    if (!renderer) return;
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // ---------- input / camera ----------
  const keys = {};
  function bindInput() {
    const el = renderer.domElement;
    let drag = null;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, moved: false, yaw: cam.yaw, pitch: cam.pitch, tx: cam.tx, tz: cam.tz }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
        if (drag.moved) {
          if (drag.b === 2 || drag.b === 1 || e.shiftKey) { cam.yaw = drag.yaw - dx * 0.008; cam.pitch = Math.max(0.35, Math.min(1.45, drag.pitch + dy * 0.006)); }
          else {
            const s = cam.dist * 0.0022;
            const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
            // forward f = (-c, -sn), right r = (sn, -c)
            cam.tx = drag.tx - sn * dx * s + -c * dy * s;
            cam.tz = drag.tz + c * dx * s + -sn * dy * s;
            clampCam();
          }
        }
      }
      const h = pick(e.clientX, e.clientY);
      hoverCb && hoverCb(h, e);
    });
    el.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const h = pick(e.clientX, e.clientY);
        if (drag.b === 0) clickCb && clickCb(h, e);
        if (drag.b === 2) rightCb && rightCb(h, e);
      }
      drag = null;
    });
    el.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(7, Math.min(32, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
    window.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return; keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  }
  function clampCam() { cam.tx = Math.max(-16, Math.min(16, cam.tx)); cam.tz = Math.max(-12, Math.min(12, cam.tz)); }
  function updateCamera(dt) {
    const sp = 12 * dt;
    const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
    if (keys['w'] || keys['arrowup']) { cam.tx -= c * sp; cam.tz -= sn * sp; }
    if (keys['s'] || keys['arrowdown']) { cam.tx += c * sp; cam.tz += sn * sp; }
    if (keys['a'] || keys['arrowleft']) { cam.tx -= sn * sp; cam.tz += c * sp; }
    if (keys['d'] || keys['arrowright']) { cam.tx += sn * sp; cam.tz -= c * sp; }
    if (keys['q']) cam.yaw -= 1.6 * dt;
    if (keys['e'] && !keys['shift']) cam.yaw += 1.6 * dt;
    clampCam();
    if (cam.zoomTo) { cam.dist += (cam.zoomTo - cam.dist) * Math.min(1, dt * 3); if (Math.abs(cam.zoomTo - cam.dist) < 0.05) cam.zoomTo = null; }
    if (cam.follow) { cam.tx += (cam.follow.x - cam.tx) * Math.min(1, dt * 4); cam.tz += (cam.follow.z - cam.tz) * Math.min(1, dt * 4); if (Math.hypot(cam.follow.x - cam.tx, cam.follow.z - cam.tz) < 0.05) cam.follow = null; }
    const cy = Math.sin(cam.pitch) * cam.dist, ch = Math.cos(cam.pitch) * cam.dist;
    let sx = 0, sy = 0;
    if (cam.shake > 0) { sx = (Math.random() - 0.5) * cam.shake; sy = (Math.random() - 0.5) * cam.shake; cam.shake = Math.max(0, cam.shake - dt * 1.8); }
    camera.position.set(cam.tx + Math.cos(cam.yaw) * ch + sx, cy + sy, cam.tz + Math.sin(cam.yaw) * ch);
    camera.lookAt(cam.tx + sx * 0.5, 0.4, cam.tz);
  }
  function focus(h) { if (!h) return; const p = px(h); cam.follow = { x: p.x, z: p.z }; }
  // pan (and zoom out if needed) so two world points share the screen; resolves once the camera has mostly arrived
  async function frame(a, b) {
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    const need = Math.min(32, span * 1.25 + 7);
    const far = Math.hypot(mid.x - cam.tx, mid.z - cam.tz) > 1.5 || need > cam.dist + 0.5;
    cam.follow = mid;
    if (need > cam.dist) cam.zoomTo = need;
    if (far) await wait(380);
  }
  // does the active player drive this unit's movement themselves?
  const playerDriven = (u) => u.side === 'hero' && !(G.Settings && G.Settings.autoHeroes);
  function rotate(d) { cam.yaw += d; }
  function zoom(f) { cam.dist = Math.max(7, Math.min(32, cam.dist * f)); }

  function pick(cx, cy) {
    if (!B) return null;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((cx - r.left) / r.width) * 2 - 1; mouse.y = -((cy - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // intersect with y=0.3 plane then round to hex (robust and cheap)
    const ray = raycaster.ray; if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (0.3 - ray.origin.y) / ray.direction.y; if (t < 0) return null;
    const x = ray.origin.x + ray.direction.x * t + center.x, z = ray.origin.z + ray.direction.z * t + center.z;
    const r_ = z / 1.5, q = x / SQ3 - r_ / 2;
    const h = Hex.round(q, r_);
    return B.tiles.has(Hex.hk(h)) ? h : null;
  }

  // ---------- battle setup ----------
  function clearScene() {
    while (scene.children.length) scene.remove(scene.children[0]);
    tileMeshes.clear(); hlMeshes.clear(); propGroups.clear(); unitViews.clear(); flickers.length = 0; particles.length = 0;
    overlay.innerHTML = '';
  }
  let hexGeo, hlGeo, ringGeo;
  function loadBattle(battle) {
    B = battle;
    clearScene();
    const pal = B.scen.palette;
    scene.background = new THREE.Color(pal.sky);
    scene.fog = new THREE.Fog(pal.fog, 28, 60);
    const hemi = new THREE.HemisphereLight(0xffffff, pal.ground, 0.65); scene.add(hemi);
    const sun = new THREE.DirectionalLight(pal.light, 0.95);
    sun.position.set(-10, 18, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
    scene.add(sun);
    // bounds
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const t of B.tiles.values()) { const x = SQ3 * (t.q + t.r / 2), z = 1.5 * t.r; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
    center = { x: (mnx + mxx) / 2, z: (mnz + mxz) / 2 };
    cam.tx = 0; cam.tz = 0.5; cam.yaw = Math.PI / 2; cam.pitch = 1.0; cam.dist = 25;
    hexGeo = new THREE.CylinderGeometry(0.97, 1.0, 1, 6); hexGeo.translate(0, -0.5, 0);
    hlGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.04, 6);
    ringGeo = new THREE.RingGeometry(0.62, 0.78, 6); ringGeo.rotateX(-Math.PI / 2); ringGeo.rotateY(Math.PI / 6);
    // ground skirt
    const skirt = new THREE.Mesh(new THREE.CircleGeometry(40, 32), mat(new THREE.Color(pal.ground).multiplyScalar(0.55)));
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.6; skirt.receiveShadow = true; scene.add(skirt);
    for (const t of B.tiles.values()) buildTile(t);
    for (const u of B.units) if (!u.dead) addUnitView(u);
    syncAll();
  }

  const TCOL = {
    grass: 0x6a9a45, rough: 0x4f7a34, road: 0xb59a6a, tree: 0x4f7a34, rock: 0x6a9a45, water: 0x3a7fb8, bridge: 0x3a7fb8,
    wagon: 0xb59a6a, tent: 0x8a9a55, fire: 0x7a6a50, wall: 0x9a8f86, tile: 0xffffff, oven: 0xb5654a, frosting: 0xff9ec7,
    pillar: 0xffffff, counter: 0xffffff, flames: 0x8a3a10, jam: 0x9a1030, floor: 0x9a9a9a,
  };
  function tileColor(t) {
    if (t.terrain === 'tile' || t.terrain === 'pillar' || t.terrain === 'counter') {
      const k = ((t.q - t.r) % 3 + 3) % 3;
      return [0xfbe3ec, 0xfffaf2, 0xd8f3e6][k];
    }
    const base = new THREE.Color(TCOL[t.terrain] || 0x888888);
    const n = (Math.sin(t.q * 12.9898 + t.r * 78.233) * 43758.5453) % 1;
    base.offsetHSL(0, 0, (n - 0.5) * 0.05);
    return base;
  }
  function buildTile(t) {
    const k = Hex.hk(t);
    if (tileMeshes.has(k)) { scene.remove(tileMeshes.get(k)); }
    if (propGroups.has(k)) { scene.remove(propGroups.get(k)); propGroups.delete(k); }
    const y = topY(t);
    const isWater = t.terrain === 'water' || t.terrain === 'bridge';
    const m = new THREE.Mesh(hexGeo, mat(tileColor(t), isWater ? { roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 } : (['frosting', 'jam'].includes(t.terrain) ? { roughness: 0.3 } : {})));
    const p = px(t);
    const by = t.terrain === 'bridge' ? topY({ terrain: 'water' }) : y; // bridge decks sit above the water surface
    m.position.set(p.x, by, p.z); m.scale.y = by + 0.6;
    m.receiveShadow = true;
    scene.add(m); tileMeshes.set(k, m);
    if (['fire', 'flames', 'oven'].includes(t.terrain)) m.material.emissive = new THREE.Color(t.terrain === 'flames' ? 0x6a1a00 : 0x220800);
    const g = new THREE.Group(); g.position.set(p.x, y, p.z);
    const rnd = (i) => { const n = Math.sin((t.q + 31) * 12.9898 * (i + 1) + (t.r + 17) * 78.233) * 43758.5453; return n - Math.floor(n); };
    switch (t.terrain) {
      case 'tree': {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.8, 6), mat(0x6b4a2b)); trunk.position.y = 0.4; g.add(trunk);
        const s = 0.8 + rnd(1) * 0.4;
        for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.75 - i * 0.18, 0.9, 7), mat(new THREE.Color(0x2f6b2a).offsetHSL(rnd(i) * 0.04, 0, rnd(i + 2) * 0.08))); c.position.y = 0.9 + i * 0.5; g.add(c); }
        g.scale.setScalar(s); g.rotation.y = rnd(3) * 6; break;
      }
      case 'rock': {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), mat(0x8a8a8a)); r.position.y = 0.35; r.scale.set(1, 0.75, 1); r.rotation.set(rnd(1), rnd(2) * 3, 0); g.add(r); break;
      }
      case 'rough': {
        for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + rnd(i) * 0.1, 0), mat(0x3f6b2a)); b.position.set((rnd(i + 5) - 0.5) * 1.1, 0.08, (rnd(i + 9) - 0.5) * 1.1); g.add(b); }
        break;
      }
      case 'bridge': {
        // One half-span per link, from the tile centre to the shared edge, so neighbouring pieces meet flush.
        // The end pieces reach onto the bank and ramp down to it.
        for (const lk of bridgeLinks(t)) {
          const seg = new THREE.Group(); seg.rotation.y = lk.yaw; g.add(seg);
          const len = lk.bank ? 1.3 : SQ3 / 2 + 0.02;
          const drop = lk.bank ? y - topY(lk.tile) : 0;
          const deck = new THREE.Group(); deck.rotation.x = drop ? Math.atan2(drop, len) * 0.9 : 0; seg.add(deck);
          const nb = Math.max(2, Math.round(len / 0.24));
          for (let i = 0; i < nb; i++) { const pl = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, len / nb - 0.03), mat(new THREE.Color(0x8b6a43).offsetHSL(0, 0, (rnd(i + 20) - 0.5) * 0.08))); pl.position.set(0, 0, (i + 0.5) * len / nb); deck.add(pl); }
          for (const sx of [0.6, -0.6]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), mat(0x6b4a2b)); rail.position.set(sx, 0.32, len / 2); deck.add(rail);
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), mat(0x5a3a20)); post.position.set(sx, 0.16, lk.bank ? len - 0.12 : 0); deck.add(post);
          }
        }
        break;
      }
      case 'wall': { const w = new THREE.Mesh(hexGeo, mat(0x8f857b)); w.scale.set(0.98, 1.4, 0.98); w.position.y = 1.4; g.add(w); break; }
      case 'wagon': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.85), mat(0x8b5a2b)); body.position.y = 0.55; g.add(body);
        for (const [x, z] of [[-0.45, 0.48], [0.45, 0.48], [-0.45, -0.48], [0.45, -0.48]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), mat(0x3a2a1a)); w.rotation.x = Math.PI / 2; w.position.set(x, 0.28, z); g.add(w); }
        const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 10, 1, false, 0, Math.PI), mat(0xe8dcc0)); cover.rotation.z = Math.PI / 2; cover.position.y = 0.82; g.add(cover);
        g.rotation.y = rnd(1) * 3; g.rotation.z = 0.15; break;
      }
      case 'tent': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.1, 4), mat(0xc9b48a)); c.position.y = 0.55; c.rotation.y = Math.PI / 4; g.add(c); break; }
      case 'fire': case 'flames': {
        if (t.terrain === 'fire') for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), mat(0x5a3a1a)); l.rotation.z = Math.PI / 2; l.rotation.y = i * 1.05; l.position.y = 0.06; g.add(l); }
        const n = t.terrain === 'fire' ? 3 : 4;
        for (let i = 0; i < n; i++) {
          const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 + rnd(i) * 0.1, 0.5, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb23a : 0xff5a1a, transparent: true, opacity: 0.9 }));
          f.position.set((rnd(i + 3) - 0.5) * (t.terrain === 'fire' ? 0.4 : 1.1), 0.25, (rnd(i + 7) - 0.5) * (t.terrain === 'fire' ? 0.4 : 1.1)); g.add(f); flickers.push({ m: f, s: rnd(i) * 10 });
        }
        if (t.terrain === 'fire') { const l = new THREE.PointLight(0xff8a3a, 1.2, 6); l.position.y = 0.8; g.add(l); flickers.push({ light: l, s: 0 }); }
        break;
      }
      case 'oven': {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.0), mat(0xa0522d)); box.position.set(0, 0.6, -0.35); g.add(box);
        const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xff7a1a })); mouth.position.set(0, 0.3, 0.16); g.add(mouth); flickers.push({ m: mouth, s: rnd(2) * 10, glow: true });
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 6), mat(0x7a3a1d)); ch.position.set(0.4, 1.4, -0.5); g.add(ch);
        break;
      }
      case 'frosting': case 'jam': {
        for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.25 + rnd(i) * 0.15, 8, 6), mat(t.terrain === 'jam' ? 0xb0103a : [0xff9ec7, 0xb6f0ff, 0xfff2a0][i], { roughness: 0.25 })); b.scale.y = 0.35; b.position.set((rnd(i + 2) - 0.5) * 1.0, 0.0, (rnd(i + 4) - 0.5) * 1.0); g.add(b); }
        if (t.terrain === 'frosting') for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: [0xff4d6d, 0x4dd2ff, 0xffd84d, 0x7ae582][i % 4] })); sp.position.set((rnd(i + 11) - 0.5) * 1.2, 0.07, (rnd(i + 13) - 0.5) * 1.2); sp.rotation.y = rnd(i) * 6; g.add(sp); }
        break;
      }
      case 'pillar': {
        for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10), mat(i % 2 ? 0xff5a7a : 0xffffff)); s.position.y = 0.14 + i * 0.28; g.add(s); }
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), mat(0xff9ec7)); top.position.y = 2.35; top.scale.y = 0.6; g.add(top); break;
      }
      case 'counter': {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.2), mat(0xc49a6c)); c.position.y = 0.4; g.add(c);
        const tp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.3), mat(0xffffff)); tp.position.y = 0.84; g.add(tp);
        const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12), mat(0xffc0d9)); cake.position.y = 1.03; g.add(cake);
        break;
      }
      case 'water': { m.material.emissive = new THREE.Color(0x0a2a4a); flickers.push({ m, s: rnd(1) * 10, water: true }); break; }
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (g.children.length) { scene.add(g); propGroups.set(k, g); }
    // highlight plate
    if (!hlMeshes.has(k)) {
      const hm = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
      hm.position.set(p.x, y + 0.03, p.z); hm.visible = false; hm.renderOrder = 2;
      const edge = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      edge.position.y = 0.03; hm.add(edge); hm.userData.edge = edge;
      scene.add(hm); hlMeshes.set(k, hm);
    } else hlMeshes.get(k).position.y = y + 0.03;
  }

  // Directions a bridge tile spans: to each neighbouring bridge tile, plus out to the bank at the open ends.
  function bridgeLinks(t) {
    const at = (h) => B.tiles.get(Hex.hk(h));
    const yawTo = (h) => { const a = px(t), b = px(h); return Math.atan2(b.x - a.x, b.z - a.z); };
    const nbs = Hex.neighbors(t).map(h => ({ h, tile: at(h) })).filter(n => n.tile);
    const links = nbs.filter(n => n.tile.terrain === 'bridge').map(n => ({ yaw: yawTo(n.h) }));
    const land = nbs.filter(n => n.tile.terrain !== 'bridge' && n.tile.terrain !== 'water');
    const bankOpposite = (yaw) => {
      let best = null, bd = 0.4;
      for (const n of land) { const d = -Math.cos(yawTo(n.h) - yaw); if (d > bd) { bd = d; best = n; } }
      return best && { yaw: yawTo(best.h), bank: true, tile: best.tile };
    };
    if (links.length === 1) { const b = bankOpposite(links[0].yaw); if (b) links.push(b); }
    else if (!links.length && land.length) { const a = { yaw: yawTo(land[0].h), bank: true, tile: land[0].tile }; links.push(a); const b = bankOpposite(a.yaw); if (b) links.push(b); }
    return links;
  }

  // ---------- units ----------
  function addUnitView(u) {
    const g = new THREE.Group();
    const body = buildBody(u);
    // Large creatures (u.rad 1) stand on a 7-hex footprint, so their body, base and ring grow to fill it
    const big = u.rad ? 1 + u.rad * 1.5 : 1;
    const US = (u.object ? 1 : 1.2) * (u.rad ? 1.55 : 1);
    body.group.scale.multiplyScalar(US);
    g.add(body.group);
    const height = body.height * US;
    if (!u.object) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * big, 0.6 * big, 0.06, u.rad ? 36 : 20), new THREE.MeshStandardMaterial({ color: u.side === 'hero' ? 0x3a8dff : 0xe0453a, emissive: u.side === 'hero' ? 0x0a2a6a : 0x5a0a0a, roughness: 0.5, transparent: !!u.rad, opacity: u.rad ? 0.55 : 1 }));
      base.position.y = 0.03; g.add(base);
    }
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.66 * big, 0.8 * big, 32), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2; sel.position.y = 0.08; g.add(sel);
    // dying marker: a pulsing red ring under the fallen unit
    const dyingRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    dyingRing.rotation.x = -Math.PI / 2; dyingRing.position.y = 0.07; g.add(dyingRing);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    sel.castShadow = false; // the (usually invisible) selection ring shouldn't cast a ring-shaped shadow
    scene.add(g);
    const label = document.createElement('div');
    label.className = 'ulabel ' + (u.side === 'hero' ? 'hero' : u.object ? 'obj' : 'enemy') + (u.solo ? ' solo' : '') + (u.minion ? ' minion' : '');
    label.innerHTML = `<div class="ul-name">${u.name}</div><div class="ul-bar"><i class="hp"></i><i class="tmp"></i></div><div class="ul-conds"></div><div class="ul-dying"></div>`;
    overlay.appendChild(label);
    const v = { u, g, body: body.group, bs: US, height, sel, dyingRing, label, hp: u.hp, temp: u.tempHp, pos: Object.assign({}, u.pos), mats: [], dead: false, bob: Math.random() * 6 };
    g.traverse(o => { if (o.isMesh && o.material && o.material.emissive) v.mats.push(o.material); });
    unitViews.set(u.uid, v);
    placeView(v, u.pos);
    return v;
  }
  function placeView(v, h) {
    const t = B.tiles.get(Hex.hk(h)); const p = px(h);
    v.g.position.set(p.x, topY(t), p.z); v.pos = { q: h.q, r: h.r };
  }
  function facing(v, h) { const a = px(v.pos), b = px(h); v.body.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); }

  // Recurve longbow: two curved limbs meeting at a wrapped grip, with a taut string. Held upright at (x, y, z).
  function longbow(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const wood = mat(0x9a6434), dark = mat(0x3a2414);
    const R = 0.55, arc = 1.05;
    for (const sy of [1, -1]) {
      const limb = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 5, 10, arc), wood);
      // arc starts at the grip and curves up (or down), bowing away from the string
      limb.position.set(-R, 0, 0); limb.scale.y = sy; g.add(limb);
      const ex = -R + R * Math.cos(arc), ey = sy * R * Math.sin(arc);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), dark); tip.position.set(ex + 0.02, ey + sy * 0.03, 0); tip.rotation.z = sy > 0 ? -0.5 : Math.PI + 0.5; g.add(tip);
      if (sy > 0) g.userData.top = { x: ex, y: ey }; else g.userData.bot = { x: ex, y: ey };
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), dark); g.add(grip);
    const t = g.userData.top, b = g.userData.bot;
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, t.y - b.y, 3), new THREE.MeshBasicMaterial({ color: 0xf0ead8 })); str.position.set(t.x, 0, 0); g.add(str);
    g.rotation.y = -Math.PI / 3; // back of the bow faces forward (string toward the archer), angled so it reads in profile
    return g;
  }

  function buildBody(u) {
    const L = u.look || {}; const g = new THREE.Group(); let height = 1.5;
    const add = (geo, color, x, y, z, o) => { const m = new THREE.Mesh(geo, mat(color, o)); m.position.set(x, y, z); g.add(m); return m; };
    const Cyl = (a, b, h, s = 8, open = false) => new THREE.CylinderGeometry(a, b, h, s, 1, open);
    const Sph = (r, s = 10) => new THREE.SphereGeometry(r, s, Math.max(6, s - 2));
    switch (L.kind || (u.side === 'hero' ? 'hero' : 'human')) {
      case 'hero': case undefined: {
        const col = L.color || 0x888888;
        const skin = { dwarf: 0xe0b48a, elf: 0xf2d3b3, halfling: 0xf0c8a0, emberkin: 0xc0504a, orc: 0x7a9a5a, human: 0xe8c39e }[L.ancestry] || 0xe8c39e;
        const short = L.ancestry === 'dwarf' || L.ancestry === 'halfling';
        const sc = short ? 0.82 : 1;
        add(Cyl(0.28, 0.36, 0.75), col, 0, 0.45, 0);
        add(Cyl(0.22, 0.28, 0.25), col, 0, 0.92, 0);
        const head = add(Sph(0.22), skin, 0, 1.18, 0);
        // Headgear wraps the head (slightly larger, centred on it) and leaves the face (+z) open, so nothing clips through.
        const HY = 1.18;
        const helmet = (color, o = {}) => {
          const cap = add(new THREE.SphereGeometry(0.245, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), color, 0, HY, 0, Object.assign({ metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }, o));
          cap.rotation.x = -0.18;
          const rim = add(new THREE.TorusGeometry(0.245, 0.025, 4, 16), color, 0, HY, 0, Object.assign({ metalness: 0.6, roughness: 0.4 }, o)); rim.rotation.x = Math.PI / 2 - 0.18;
          return cap;
        };
        const hood = (color) => {
          const h = add(new THREE.SphereGeometry(0.255, 12, 9, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.68), color, 0, HY + 0.01, -0.01, { side: THREE.DoubleSide });
          const tip = add(new THREE.ConeGeometry(0.1, 0.22, 6), color, 0, HY + 0.12, -0.25); tip.rotation.x = -2.0;
          add(Cyl(0.3, 0.26, 0.08, 10), color, 0, 0.98, -0.02);
          return h;
        };
        if (L.ancestry === 'elf') { add(new THREE.ConeGeometry(0.05, 0.24, 4), skin, 0.29, 1.22, 0.04).rotation.z = -1.2; add(new THREE.ConeGeometry(0.05, 0.24, 4), skin, -0.29, 1.22, 0.04).rotation.z = 1.2; }
        if (L.ancestry === 'dwarf') add(new THREE.ConeGeometry(0.18, 0.35, 6), 0x8a5a2a, 0, 1.0, 0.16).rotation.x = Math.PI;
        if (L.ancestry === 'emberkin') for (const sx of [1, -1]) { const hn = add(new THREE.ConeGeometry(0.05, 0.26, 5), 0xf0e0c0, sx * 0.13, 1.42, 0.02); hn.rotation.set(-0.7, 0, -sx * 0.35); }
        if (L.ancestry === 'orc') { add(new THREE.ConeGeometry(0.035, 0.1, 4), 0xffffff, 0.08, 1.1, 0.19); add(new THREE.ConeGeometry(0.035, 0.1, 4), 0xffffff, -0.08, 1.1, 0.19); }
        // class flair
        if (L.cls === 'wizard') { add(new THREE.ConeGeometry(0.28, 0.6, 8), 0x1f3a7a, 0, 1.55, 0); add(Cyl(0.03, 0.03, 1.5, 5), 0x6b4a2b, 0.42, 0.75, 0.1); const orb = add(Sph(0.11), 0x8fd3ff, 0.42, 1.55, 0.1, { emissive: 0x2a7aff, emissiveIntensity: 0.9 }); }
        if (L.cls === 'cleric') { const halo = add(new THREE.TorusGeometry(0.2, 0.03, 6, 16), 0xffe066, 0, 1.48, 0, { emissive: 0xffd000, emissiveIntensity: 0.8 }); halo.rotation.x = Math.PI / 2; add(Cyl(0.04, 0.04, 0.5, 5), 0x999999, 0.38, 0.75, 0.15); add(Sph(0.11, 6), 0xcccccc, 0.38, 1.02, 0.15); }
        if (L.cls === 'rogue') { hood(0x1a1a24); add(new THREE.BoxGeometry(0.05, 0.4, 0.02), 0xdddddd, 0.36, 0.7, 0.15); add(new THREE.BoxGeometry(0.05, 0.4, 0.02), 0xdddddd, -0.36, 0.7, 0.15); }
        if (L.cls === 'ranger') {
          hood(0x2f5a2a);
          // quiver on the back
          const qv = add(Cyl(0.08, 0.07, 0.5, 8), 0x5a3a20, 0.12, 0.85, -0.3); qv.rotation.z = -0.35;
          for (let i = 0; i < 3; i++) { const f = add(new THREE.BoxGeometry(0.02, 0.12, 0.07), [0xe8e0d0, 0xc0392b, 0xe8e0d0][i], 0.21 + i * 0.025, 1.14 + i * 0.01, -0.3 + (i - 1) * 0.04); f.rotation.z = -0.35; }
          if (L.sub === 'archer') g.add(longbow(-0.4, 0.82, 0.12)); else { add(new THREE.BoxGeometry(0.06, 0.6, 0.02), 0xdddddd, 0.36, 0.7, 0.15); add(new THREE.BoxGeometry(0.06, 0.6, 0.02), 0xdddddd, -0.36, 0.7, 0.15); } }
        if (L.cls === 'fighter') {
          helmet(0x9aa0a8); add(new THREE.BoxGeometry(0.035, 0.16, 0.03), 0x9aa0a8, 0, HY + 0.02, 0.245, { metalness: 0.6, roughness: 0.4 });
          if (L.sub === 'shield') { const sh = add(Cyl(0.36, 0.36, 0.06, 6), 0x9a2a1f, -0.38, 0.7, 0.12); sh.rotation.z = Math.PI / 2; add(new THREE.BoxGeometry(0.07, 0.8, 0.03), 0xdddddd, 0.4, 0.8, 0.15); }
          else { add(Cyl(0.03, 0.03, 1.3, 5), 0x6b4a2b, 0.4, 0.75, 0.1); add(new THREE.BoxGeometry(0.35, 0.3, 0.04), 0xcccccc, 0.5, 1.3, 0.1); }
        }
        if (L.cls === 'warlord') { helmet(0xc0a040); add(new THREE.BoxGeometry(0.04, 0.16, 0.3), 0xc0392b, 0, HY + 0.3, -0.05); const cape = add(new THREE.PlaneGeometry(0.6, 0.85), 0x6a1a8a, 0, 0.6, -0.33, { side: THREE.DoubleSide }); cape.rotation.x = 0.15; add(new THREE.BoxGeometry(0.07, 0.8, 0.03), 0xdddddd, 0.4, 0.8, 0.15); }
        g.scale.setScalar(sc); height = 1.75 * sc; break;
      }
      case 'goblin': {
        const c = L.color; const s = L.scale || 0.8;
        add(Cyl(0.22, 0.3, 0.55), c === 0x7a5c9e ? 0x5a3a7a : 0x6b4a2b, 0, 0.32, 0);
        add(Sph(0.27), c, 0, 0.82, 0);
        add(new THREE.ConeGeometry(0.08, 0.38, 4), c, 0.3, 0.88, 0).rotation.z = -1.3;
        add(new THREE.ConeGeometry(0.08, 0.38, 4), c, -0.3, 0.88, 0).rotation.z = 1.3;
        add(Sph(0.045, 6), 0xffee00, 0.1, 0.86, 0.22, { emissive: 0xffaa00 }); add(Sph(0.045, 6), 0xffee00, -0.1, 0.86, 0.22, { emissive: 0xffaa00 });
        if (L.hood) add(new THREE.ConeGeometry(0.28, 0.35, 7), 0x2a2a22, 0, 1.08, -0.02);
        if (L.hat) add(new THREE.ConeGeometry(0.25, 0.6, 7), 0x3a1a5a, 0, 1.3, 0).rotation.z = 0.2;
        if (L.staff) { add(Cyl(0.025, 0.025, 1.2, 5), 0x4a3a2a, 0.32, 0.6, 0.1); add(Sph(0.08, 6), 0x9aff6a, 0.32, 1.22, 0.1, { emissive: 0x2aaa00 }); }
        if (L.crown) { const cr = add(Cyl(0.2, 0.2, 0.14, 6, true), 0xffd700, 0, 1.1, 0, { metalness: 0.8, roughness: 0.3, emissive: 0x553300 }); add(new THREE.BoxGeometry(0.1, 0.55, 0.06), 0xaaaaaa, 0.36, 0.55, 0.1); }
        else if (L.sling) add(new THREE.TorusGeometry(0.12, 0.02, 4, 8), 0x6b4a2b, 0.3, 0.55, 0.12);
        else if (!L.staff) add(new THREE.BoxGeometry(0.05, 0.35, 0.02), 0xaaaaaa, 0.3, 0.45, 0.12);
        g.scale.setScalar(s); height = 1.25 * s + (L.hat ? 0.3 : 0); break;
      }
      case 'wolf': {
        const c = L.color;
        add(new THREE.BoxGeometry(0.45, 0.42, 1.0), c, 0, 0.55, 0);
        add(new THREE.BoxGeometry(0.36, 0.34, 0.42), c, 0, 0.75, 0.6);
        add(new THREE.BoxGeometry(0.2, 0.16, 0.25), 0x3a2e28, 0, 0.66, 0.85);
        add(new THREE.ConeGeometry(0.07, 0.18, 4), c, 0.12, 0.98, 0.55); add(new THREE.ConeGeometry(0.07, 0.18, 4), c, -0.12, 0.98, 0.55);
        for (const [x, z] of [[0.15, 0.35], [-0.15, 0.35], [0.15, -0.35], [-0.15, -0.35]]) add(Cyl(0.06, 0.05, 0.4, 5), c, x, 0.2, z);
        add(Cyl(0.04, 0.08, 0.5, 5), c, 0, 0.7, -0.6).rotation.x = -0.8;
        add(Sph(0.04, 5), 0xff3300, 0.1, 0.82, 0.8, { emissive: 0xff0000 }); add(Sph(0.04, 5), 0xff3300, -0.1, 0.82, 0.8, { emissive: 0xff0000 });
        height = 1.2; break;
      }
      case 'human': {
        const c = L.color; const s = L.scale || 1;
        add(Cyl(0.27, 0.34, 0.75), c, 0, 0.45, 0); add(Cyl(0.22, 0.27, 0.25), c, 0, 0.92, 0);
        add(Sph(0.21), 0xe0b08a, 0, 1.17, 0);
        if (L.hood) add(new THREE.ConeGeometry(0.26, 0.4, 7), 0x1a1a1a, 0, 1.36, -0.02);
        if (L.hat) { add(Cyl(0.35, 0.35, 0.04, 12), 0x5a0a0a, 0, 1.33, 0); add(Cyl(0.18, 0.2, 0.22, 10), 0x5a0a0a, 0, 1.45, 0); add(new THREE.BoxGeometry(0.04, 0.05, 0.4), 0xffffff, 0.15, 1.5, -0.1).rotation.x = 0.6; }
        else if (!L.hood) add(Sph(0.22, 8), 0x3a2a1a, 0, 1.24, -0.03).scale.y = 0.6;
        if (L.cape) { const cp = add(new THREE.PlaneGeometry(0.62, 0.9), 0x8a0a0a, 0, 0.6, -0.33, { side: THREE.DoubleSide }); cp.rotation.x = 0.15; add(new THREE.BoxGeometry(0.03, 0.75, 0.02), 0xeeeeee, 0.38, 0.8, 0.15); }
        else if (L.crossbow) { add(new THREE.BoxGeometry(0.08, 0.08, 0.6), 0x5a3a2a, 0.3, 0.75, 0.25); add(new THREE.BoxGeometry(0.5, 0.04, 0.04), 0x3a2a1a, 0.3, 0.78, 0.45); }
        else if (s > 1.1) { add(Cyl(0.04, 0.04, 1.0, 5), 0x5a3a2a, 0.42, 0.7, 0.12); add(new THREE.BoxGeometry(0.28, 0.25, 0.25), 0x666666, 0.42, 1.2, 0.12); }
        else add(Cyl(0.05, 0.07, 0.6, 5), 0x4a3a2a, 0.36, 0.6, 0.15);
        g.scale.setScalar(s); height = 1.7 * s; break;
      }
      case 'barrel': {
        add(Cyl(0.33, 0.33, 0.75, 12), 0x7a4a1f, 0, 0.38, 0);
        for (const y of [0.15, 0.6]) add(Cyl(0.345, 0.345, 0.06, 12), 0x333333, 0, y, 0, { metalness: 0.6 });
        add(Cyl(0.08, 0.08, 0.03, 8), 0xffcc00, 0, 0.76, 0, { emissive: 0x664400 });
        height = 0.9; break;
      }
      case 'jar': {
        add(Cyl(0.3, 0.3, 0.62, 12), 0xa4133c, 0, 0.32, 0, { transparent: true, opacity: 0.85, roughness: 0.15 });
        add(Cyl(0.32, 0.32, 0.12, 12), 0xf0e6d0, 0, 0.72, 0);
        add(Cyl(0.335, 0.335, 0.07, 12, true), 0xff6b9a, 0, 0.7, 0, { side: THREE.DoubleSide });
        height = 0.9; break;
      }
      case 'golem': {
        const tiers = [[1.05, 0.7, 0xf5deb3], [0.8, 0.6, 0xffc0d9], [0.55, 0.55, 0xfffaf0]];
        let y = 0;
        tiers.forEach(([r, h, c], i) => {
          add(Cyl(r, r * 1.02, h, 16), c, 0, y + h / 2, 0, { flatShading: false, roughness: 0.6 });
          const drip = add(new THREE.TorusGeometry(r, 0.09, 6, 20), i === 1 ? 0xffffff : 0xff9ec7, 0, y + h, 0, { roughness: 0.3, flatShading: false }); drip.rotation.x = Math.PI / 2;
          for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + i; add(Sph(0.08, 6), [0xff4d6d, 0x4dd2ff, 0xffd84d, 0x7ae582][k % 4], Math.cos(a) * r * 0.98, y + h * 0.55, Math.sin(a) * r * 0.98); }
          y += h;
        });
        add(Sph(0.24, 12), 0xd0021b, 0, y + 0.2, 0, { roughness: 0.2, flatShading: false, emissive: 0x330000 });
        add(Cyl(0.02, 0.02, 0.3, 4), 0x2a6a1a, 0.05, y + 0.48, 0).rotation.z = -0.4;
        // face on middle tier
        const eyeY = 0.7 + 0.32;
        add(Sph(0.11, 8), 0x1a0a0a, 0.26, eyeY, 0.74, { emissive: 0x330000 }); add(Sph(0.11, 8), 0x1a0a0a, -0.26, eyeY, 0.74, { emissive: 0x330000 });
        add(Sph(0.04, 6), 0xff2020, 0.26, eyeY + 0.02, 0.84, { emissive: 0xff0000 }); add(Sph(0.04, 6), 0xff2020, -0.26, eyeY + 0.02, 0.84, { emissive: 0xff0000 });
        const mouth = add(new THREE.TorusGeometry(0.18, 0.04, 4, 10, Math.PI), 0x5a1a1a, 0, 0.85, 0.79); mouth.rotation.z = Math.PI;
        // rolling pin arms
        for (const sx of [1, -1]) {
          const arm = add(Cyl(0.13, 0.13, 0.9, 10), 0xd2a679, sx * 1.35, 0.95, 0.15); arm.rotation.x = Math.PI / 2;
          add(Cyl(0.06, 0.06, 0.4, 6), 0x8b5a2b, sx * 1.35, 0.95, 0.75).rotation.x = Math.PI / 2;
          add(Cyl(0.08, 0.08, 0.5, 6), 0xf5deb3, sx * 1.15, 0.95, 0).rotation.z = Math.PI / 2;
        }
        height = 2.6; break;
      }
      case 'ginger': {
        const c = L.color;
        const b = add(new THREE.BoxGeometry(0.5, 0.6, 0.16), c, 0, 0.55, 0);
        add(Cyl(0.24, 0.24, 0.16, 12), c, 0, 1.05, 0).rotation.x = Math.PI / 2;
        for (const [x, y, rz] of [[0.36, 0.7, -0.8], [-0.36, 0.7, 0.8], [0.14, 0.15, 0.1], [-0.14, 0.15, -0.1]]) add(new THREE.BoxGeometry(0.16, 0.38, 0.15), c, x, y, 0).rotation.z = rz;
        for (const y of [0.45, 0.6, 0.75]) add(Sph(0.04, 6), 0xffffff, 0, y, 0.09);
        add(Sph(0.035, 5), 0xffffff, 0.08, 1.09, 0.09); add(Sph(0.035, 5), 0xffffff, -0.08, 1.09, 0.09);
        const pike = add(Cyl(0.03, 0.03, 1.2, 6), 0xffffff, 0.45, 0.75, 0.1);
        for (let i = 0; i < 4; i++) add(Cyl(0.032, 0.032, 0.12, 6), 0xff2a2a, 0.45, 0.3 + i * 0.28, 0.1);
        height = 1.4; break;
      }
      case 'puff': {
        add(Sph(0.42, 12), 0xf6d7a7, 0, 0.42, 0, { flatShading: false });
        add(Sph(0.32, 10), 0xfffbf0, 0, 0.72, 0, { flatShading: false });
        for (let i = 0; i < 6; i++) add(Sph(0.07, 6), 0xffffff, Math.cos(i) * 0.25, 0.9, Math.sin(i) * 0.25);
        add(Sph(0.05, 6), 0x2a1a1a, 0.13, 0.5, 0.38); add(Sph(0.05, 6), 0x2a1a1a, -0.13, 0.5, 0.38);
        height = 1.15; break;
      }
      case 'macaron': {
        const c = L.color;
        add(Sph(0.42, 14), c, 0, 0.32, 0, { flatShading: false }).scale.y = 0.45;
        add(Cyl(0.4, 0.4, 0.14, 16), 0xfff0f5, 0, 0.5, 0);
        add(Sph(0.42, 14), c, 0, 0.66, 0, { flatShading: false }).scale.y = 0.45;
        add(Sph(0.055, 6), 0x1a1a1a, 0.13, 0.52, 0.39); add(Sph(0.055, 6), 0x1a1a1a, -0.13, 0.52, 0.39);
        const barrel = add(Cyl(0.1, 0.12, 0.35, 8), 0xd88aa8, 0, 0.9, 0); barrel.rotation.x = -0.6;
        height = 1.2; break;
      }
      case 'roll': {
        const r = add(new THREE.TorusGeometry(0.42, 0.2, 10, 24), L.color, 0, 0.62, 0, { flatShading: false });
        add(new THREE.TorusGeometry(0.2, 0.12, 8, 16), 0xa0662a, 0, 0.62, 0, { flatShading: false });
        add(new THREE.TorusGeometry(0.42, 0.08, 6, 24, Math.PI), 0xffffff, 0, 0.66, 0.05);
        add(Sph(0.06, 6), 0x1a1a1a, 0.15, 0.85, 0.22); add(Sph(0.06, 6), 0x1a1a1a, -0.15, 0.85, 0.22);
        height = 1.3; break;
      }
      default: add(Cyl(0.3, 0.3, 1, 8), 0x888888, 0, 0.5, 0);
    }
    return { group: g, height };
  }

  // ---------- highlights ----------
  const HL = {
    reach: [0x3a9bff, 0.16], shift: [0x3ae0ff, 0.32], dash: [0x3a6bff, 0.16], target: [0xff4a4a, 0.42], area: [0xff9a2a, 0.45], path: [0xffffff, 0.55],
    ally: [0x4aff8a, 0.4],
    // power range / area tints: helpful (green), harmful (red), mixed (orange); kept pale so they read differently from blue move range
    range_help: [0x8affa8, 0.32], range_harm: [0xff7a70, 0.32], range_mixed: [0xffb860, 0.34],
    area_help: [0x4aff8a, 0.45], area_harm: [0xff5a4a, 0.45], flank: [0xffc83a, 0.4], deploy: [0x7affb0, 0.35], choice: [0xd07aff, 0.45], telegraph: [0xff1a1a, 0.5], zone: [0x8bd448, 0.3], hover: [0xffee66, 0.55], danger: [0xff7a3a, 0.3],
  };
  let hlState = {};
  function setHighlights(state) { hlState = state || {}; applyHL(); }
  function applyHL() {
    for (const m of hlMeshes.values()) { m.visible = false; m.userData.kind = null; }
    const order = ['zone', 'deploy', 'dash', 'reach', 'range_help', 'range_harm', 'range_mixed', 'flank', 'shift', 'danger', 'ally', 'target', 'choice', 'area', 'area_help', 'area_harm', 'telegraph', 'path', 'hover'];
    for (const kind of order) {
      const list = hlState[kind]; if (!list) continue;
      for (const h of list) {
        const m = hlMeshes.get(Hex.hk(h)); if (!m) continue;
        m.visible = true; m.userData.kind = kind;
        m.material.color.setHex(HL[kind][0]); m.material.opacity = HL[kind][1];
        m.userData.edge.material.color.setHex(HL[kind][0]); m.userData.edge.material.opacity = Math.min(1, HL[kind][1] + 0.4);
      }
    }
    // zones & telegraphs always visible
    if (B) {
      for (const z of B.zones) for (const h of z.hexes) { const m = hlMeshes.get(Hex.hk(h)); if (m && !m.visible) { m.visible = true; m.userData.kind = 'zone'; m.material.color.setHex(z.color || 0x8bd448); m.material.opacity = 0.32; m.userData.edge.material.opacity = 0.3; } }
      // a telegraphed slam outranks every planning overlay except the hovered path, hovered hex and area preview
      for (const tg of B.telegraphs) for (const h of tg.hexes) { const m = hlMeshes.get(Hex.hk(h)); if (m && !['path', 'hover', 'area', 'area_help', 'area_harm', 'choice'].includes(m.userData.kind)) { m.visible = true; m.userData.kind = 'telegraph'; m.material.color.setHex(0xff1a1a); m.material.opacity = 0.45; m.userData.edge.material.color.setHex(0xff1a1a); m.userData.edge.material.opacity = 0.9; } }
    }
  }
  function setActive(uid) { for (const v of unitViews.values()) v.active = v.u.uid === uid; }
  function setTargetable(uids) { for (const v of unitViews.values()) v.targetable = uids && uids.includes(v.u.uid); }

  // ---------- loop ----------
  let last = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    if (!B) { renderer && renderer.render(scene, camera); return; }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt; const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      p.v.y -= (p.grav == null ? 9 : p.grav) * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.material.opacity != null) p.m.material.opacity = Math.max(0, p.life / p.max);
      if (p.spin) p.m.rotation.x += dt * p.spin;
      if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
    }
    const time = t / 1000;
    for (const f of flickers) {
      if (f.light) f.light.intensity = 1.0 + Math.sin(time * 13 + f.s) * 0.25 + Math.random() * 0.15;
      else if (f.water) f.m.material.emissive.setRGB(0.04, 0.16 + Math.sin(time * 1.5 + f.s) * 0.04, 0.3);
      else if (f.glow) f.m.material.color.setRGB(1, 0.42 + Math.sin(time * 6 + f.s) * 0.12, 0.1);
      else { f.m.scale.y = 0.8 + Math.sin(time * 14 + f.s) * 0.25; f.m.scale.x = f.m.scale.z = 0.9 + Math.sin(time * 9 + f.s) * 0.1; }
    }
    for (const m of hlMeshes.values()) if (m.visible && m.userData.kind === 'telegraph') m.material.opacity = 0.3 + Math.abs(Math.sin(time * 4)) * 0.35;
    for (const v of unitViews.values()) {
      if (v.dead) continue;
      v.sel.material.opacity = v.active ? 0.7 + Math.sin(time * 5) * 0.25 : v.targetable ? 0.45 + Math.sin(time * 8) * 0.3 : 0;
      v.sel.material.color.setHex(v.active ? 0xffe066 : 0xff4a4a);
      v.dyingRing.material.opacity = E().isDying(v.u) ? 0.35 + Math.abs(Math.sin(time * 3)) * 0.45 : 0;
      if (v.down) continue;
      if (!v.anim) v.body.position.y = (v.u.look && ['puff', 'macaron', 'golem'].includes(v.u.look.kind)) ? Math.abs(Math.sin(time * 2.2 + v.bob)) * 0.06 : Math.sin(time * 2 + v.bob) * 0.015;
      if (v.u.look && v.u.look.kind === 'golem' && !v.anim) v.body.scale.set(v.bs * (1 + Math.sin(time * 1.6) * 0.02), v.bs * (1 - Math.sin(time * 1.6) * 0.02), v.bs * (1 + Math.sin(time * 1.6) * 0.02));
    }
    updateCamera(dt);
    renderer.render(scene, camera);
    updateLabels();
  }
  const COND_ICON = { marked: '◎', slowed: '🐌', immobilized: '⛓', dazed: '💫', stunned: '✸', prone: '⤓', weakened: '↓', blinded: '◌', ongoing: '🔥', quarry: '⌖', cagrant: '⚠', atkBonus: '⚔', defBonus: '🛡', hidden: '👁', vuln: '✚', asleep: 'Z', dying: '☠' };
  function updateLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const v3 = new THREE.Vector3();
    for (const v of unitViews.values()) {
      if (v.dead) { v.label.style.display = 'none'; continue; }
      v3.set(v.g.position.x, v.g.position.y + v.height + 0.25, v.g.position.z);
      v3.project(camera);
      if (v3.z > 1) { v.label.style.display = 'none'; continue; }
      v.label.style.display = '';
      v.label.style.transform = `translate(-50%,-100%) translate(${(v3.x * 0.5 + 0.5) * w}px,${(-v3.y * 0.5 + 0.5) * h}px)`;
      const u = v.u;
      const hp = Math.max(0, v.hp), mx = u.maxHp;
      const hpEl = v.label.querySelector('.hp'), tEl = v.label.querySelector('.tmp');
      const tot = Math.max(mx, hp + v.temp);
      hpEl.style.width = (hp / tot * 100) + '%';
      hpEl.className = 'hp' + (hp <= mx / 2 ? ' bl' : '') + (hp <= mx / 4 ? ' cr' : '');
      tEl.style.width = (v.temp / tot * 100) + '%';
      const ck = u.conds.map(c => c.c).join(',') + (E().isDying(u) ? 'dying' + (u.deathFails || 0) : '');
      if (v.ck !== ck) {
        v.ck = ck;
        const seen = new Set();
        const df = u.deathFails || 0;
        v.label.querySelector('.ul-dying').innerHTML = E().isDying(u) ? `☠ DYING ${[0, 1, 2].map(i => `<span class="${i < df ? 'x' : ''}">${i < df ? '✖' : '○'}</span>`).join('')}` : '';
        v.label.querySelector('.ul-conds').innerHTML = u.conds.filter(c => COND_ICON[c.c] && c.c !== 'dying' && !seen.has(c.c) && seen.add(c.c)).map(c => `<span title="${c.label || c.c}">${COND_ICON[c.c]}</span>`).join('');
      }
      v.label.classList.toggle('active', !!v.active);
      v.label.classList.toggle('dying', E().isDying(u));
    }
  }
  const E = () => G.Engine;

  // ---------- floating text / particles ----------
  function screenOf(h, yOff = 1.2) {
    const p = px(h); const t = B.tiles.get(Hex.hk(h));
    const v = new THREE.Vector3(p.x, topY(t) + yOff, p.z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth, y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight };
  }
  function floatText(h, text, cls, yOff = 1.6, dur = 1300) {
    if (!h) return;
    const s = screenOf(h, yOff);
    const el = document.createElement('div'); el.className = 'ftext ' + (cls || ''); el.textContent = text;
    el.style.left = s.x + (Math.random() - 0.5) * 30 + 'px'; el.style.top = s.y + 'px';
    el.style.animationDuration = (dur / S()) + 'ms';
    overlay.appendChild(el); setTimeout(() => el.remove(), dur / S() + 50);
  }
  // Speech bubbles stack per unit: a new line appears at the bottom and pushes older ones up.
  function bubble(uid, text, dur = 2600) {
    const v = unitViews.get(uid); if (!v) return;
    const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
    overlay.appendChild(el);
    const stack = v.bubbles || (v.bubbles = []);
    stack.unshift(el);
    for (const b of stack) b.classList.toggle('old', b !== el);
    const lift = (b) => { let y = 0; for (const o of stack) { if (o === b) break; y += o.offsetHeight + 12; } return y; };
    const upd = () => { const s = screenOf(v.pos, v.height + 0.9); for (const b of stack) { b.style.left = s.x + 'px'; b.style.top = (s.y - lift(b)) + 'px'; } };
    upd(); const iv = setInterval(() => { if (stack[0] === el) upd(); }, 30);
    setTimeout(() => { clearInterval(iv); el.remove(); const i = stack.indexOf(el); if (i >= 0) stack.splice(i, 1); if (stack.length) upd(); }, dur);
  }
  function burst(h, color, n = 14, opts = {}) {
    const p = px(h); const t = B.tiles.get(Hex.hk(h)); const y = topY(t) + (opts.y || 0.7);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(opts.cube ? new THREE.BoxGeometry(0.1, 0.1, 0.1) : new THREE.SphereGeometry(opts.size || 0.07, 5, 4), new THREE.MeshBasicMaterial({ color: Array.isArray(color) ? color[i % color.length] : color, transparent: true, opacity: 1 }));
      m.position.set(p.x, y, p.z);
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 2.5) * (0.5 + Math.random());
      particles.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, (opts.up || 3) * (0.5 + Math.random()), Math.sin(a) * sp), life: (opts.life || 0.8) / S(), max: (opts.life || 0.8) / S(), grav: opts.grav, spin: opts.cube ? 8 : 0 });
      scene.add(m);
    }
  }
  function flashUnit(v, color, ms = 180) {
    for (const m of v.mats) { m.userData.e = m.userData.e || m.emissive.clone(); m.emissive.setHex(color); }
    setTimeout(() => { for (const m of v.mats) if (m.userData.e) m.emissive.copy(m.userData.e); }, ms / S());
  }

  // knocked prone or dying: the model topples over; standing up reverses it
  async function fall(v, dur = 0.35) {
    if (v.down) return; v.down = true;
    await tween(dur, k => { const e = k < 0.8 ? ease(k / 0.8) * 1.04 : 1.04 - (k - 0.8) / 0.2 * 0.04; v.body.rotation.x = -1.45 * e; v.body.position.y = -0.1 * Math.min(1, k * 1.5); });
  }
  async function rise(v, dur = 0.3) {
    if (!v.down) return;
    await tween(dur, k => { v.body.rotation.x = -1.45 * (1 - ease(k)); v.body.position.y = -0.1 * (1 - k); });
    v.body.rotation.x = 0; v.body.position.y = 0; v.down = false;
  }
  // big tumbling d20 over a unit for the rolls that decide a hero's fate
  async function deathRoll(v, ev) {
    const u = v.u;
    focus(v.pos); await wait(300);
    const s = screenOf(v.pos, v.height + 1.2);
    const el = document.createElement('div'); el.className = 'deathroll';
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    el.innerHTML = `<small>${u.name} · Death Save</small><div class="dr-die">?</div><div class="dr-res"></div>`;
    overlay.appendChild(el);
    const die = el.querySelector('.dr-die'), res = el.querySelector('.dr-res');
    if (ev.roll != null) {
      G.Audio && G.Audio.play('dice');
      const spinMs = 1100 / S(); const t0 = performance.now();
      while (performance.now() - t0 < spinMs) { die.textContent = 1 + Math.floor(Math.random() * 20); await new Promise(r => setTimeout(r, 70)); }
      die.textContent = ev.roll;
    } else die.textContent = '✖';
    const fails = ev.fails != null ? ev.fails : (u.deathFails || 0);
    const pips = [0, 1, 2].map(i => `<span class="${i < fails ? 'x' : ''}">${i < fails ? '✖' : '○'}</span>`).join('');
    const nat20 = ev.roll === 20;
    el.classList.add(nat20 ? 'nat20' : ev.ok ? 'ok' : 'fail');
    res.innerHTML = nat20 ? 'Rallies from death\'s door!' : ev.ok ? `Clings to life <em>${pips}</em>` : fails >= 3 ? `Slips away… <em>${pips}</em>` : `${ev.roll == null ? 'Struck while dying' : 'Failed'} <em>${pips}</em>`;
    G.Audio && G.Audio.play(nat20 ? 'sting' : ev.ok ? 'buff' : 'down');
    if (!ev.ok) { flashUnit(v, 0x801010, 400); cam.shake = Math.max(cam.shake, fails >= 3 ? 0.4 : 0.15); }
    await wait(1700);
    el.classList.add('out'); setTimeout(() => el.remove(), 400 / S());
    await wait(200);
  }

  // ---------- fx playback ----------
  async function playFx(ev) {
    const v = ev.u != null ? unitViews.get(ev.u) : null;
    switch (ev.t) {
      case 'step': {
        if (!v) return;
        const from = Object.assign({}, v.pos); const to = ev.to;
        const a = px(from), b = px(to);
        const ta = B.tiles.get(Hex.hk(from)), tb = B.tiles.get(Hex.hk(to));
        const ya = topY(ta), yb = topY(tb);
        facing(v, to); v.anim = true;
        const hop = ev.kind === 'forced' ? 0.05 : 0.22;
        const follow = ev.kind === 'forced' || !playerDriven(v.u);
        G.Audio && G.Audio.play(ev.kind === 'forced' ? 'shove' : 'step');
        await tween(ev.kind === 'forced' ? 0.16 : 0.2, k => {
          const e = ease(k); v.g.position.set(a.x + (b.x - a.x) * e, ya + (yb - ya) * e + Math.sin(k * Math.PI) * hop, a.z + (b.z - a.z) * e);
          if (follow) cam.follow = { x: v.g.position.x, z: v.g.position.z };
        });
        v.anim = false; v.pos = { q: to.q, r: to.r };
        return;
      }
      case 'teleport': {
        if (!v) return; burst(v.pos, 0xc9a0ff, 16); G.Audio && G.Audio.play('blink');
        await tween(0.15, k => v.g.scale.setScalar(1 - k)); placeView(v, ev.to); burst(ev.to, 0xc9a0ff, 16);
        await tween(0.15, k => v.g.scale.setScalar(k)); return;
      }
      case 'attack': {
        const tv = unitViews.get(ev.tgt); if (!v || !tv) return;
        facing(v, tv.pos);
        if (ev.kind === 'melee') {
          const a = px(v.pos), b = px(tv.pos); const dx = (b.x - a.x) * 0.35, dz = (b.z - a.z) * 0.35;
          const base = v.g.position.clone(); v.anim = true;
          G.Audio && G.Audio.play('swing');
          await tween(0.12, k => v.g.position.set(base.x + dx * k, base.y + Math.sin(k * Math.PI) * 0.1, base.z + dz * k));
          tween(0.16, k => v.g.position.set(base.x + dx * (1 - k), base.y, base.z + dz * (1 - k))).then(() => { v.anim = false; });
        } else {
          await frame(v.g.position, tv.g.position);
          const col = DT_COLOR[ev.dtype] || (v.u.side === 'hero' ? 0xfff0c0 : 0xd0d0d0);
          const proj = new THREE.Mesh(new THREE.SphereGeometry(ev.dtype ? 0.14 : 0.07, 8, 6), new THREE.MeshBasicMaterial({ color: col }));
          scene.add(proj);
          const a = v.g.position.clone(); a.y += v.height * 0.7; const b = tv.g.position.clone(); b.y += tv.height * 0.6;
          const dist = a.distanceTo(b);
          G.Audio && G.Audio.play(ev.dtype ? 'cast' : 'shoot');
          await tween(Math.min(0.45, 0.08 + dist * 0.035), k => { proj.position.lerpVectors(a, b, k); proj.position.y += Math.sin(k * Math.PI) * dist * 0.08; if (Math.random() < 0.5) burst0(proj.position, col); });
          scene.remove(proj);
        }
        return;
      }
      case 'area': {
        if (v) { const tv = ev.aim; if (tv) { facing(v, tv); if (ev.kind === 'areaBurst') await frame(v.g.position, px(tv)); } }
        G.Audio && G.Audio.play(ev.dtype === 'fire' ? 'fire' : ev.dtype === 'cold' ? 'ice' : 'boom');
        const col = DT_COLOR[ev.dtype] || 0xffb05a;
        const ms = [];
        for (const h of ev.hexes) {
          const p = px(h); const t = B.tiles.get(Hex.hk(h));
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.05, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
          m.position.set(p.x, topY(t) + 0.08, p.z); scene.add(m); ms.push(m);
          if (Math.random() < 0.6) burst(h, col, 4, { speed: 1, up: 2.5, life: 0.6 });
        }
        await tween(0.35, k => { for (const m of ms) { m.scale.y = 1 + k * 30; m.material.opacity = 0.8 * (1 - k); m.position.y += 0.002; } });
        for (const m of ms) scene.remove(m);
        return;
      }
      case 'self': { if (v) { burst(v.pos, DT_COLOR[ev.dtype] || 0x9fd8ff, 10, { speed: 1, up: 2 }); G.Audio && G.Audio.play('buff'); } await wait(150); return; }
      case 'roll': {
        const tv = unitViews.get(ev.tgt);
        // final values only; the combat log keeps the d20 + bonus breakdown
        if (tv) floatText(tv.pos, `${ev.roll === 20 ? '★ ' : ''}${ev.roll + ev.bonus} vs ${ev.vs} ${ev.def}`, 'roll ' + (ev.hit ? 'hit' : 'miss') + (ev.roll === 20 ? ' nat20' : ''), tv.height + 1.0, 3000);
        if (G.UI && G.UI.onRoll) G.UI.onRoll(ev);
        if (!ev.hit) { if (tv) floatText(tv.pos, ev.reroll ? 'MISS (reroll)' : 'MISS', 'miss', tv.height + 0.4, 2000); G.Audio && G.Audio.play('miss'); }
        await wait(ev.hit ? 320 : 560);
        return;
      }
      case 'damage': {
        if (!v) return;
        v.hp = ev.hp; v.temp = ev.temp;
        flashUnit(v, 0xff2020);
        floatText(v.pos, (ev.crit ? '💥' : '') + ev.amt, 'dmg' + (ev.crit ? ' crit' : '') + (ev.amt >= 15 ? ' big' : ''), v.height + 0.3, 1900);
        burst(v.pos, ev.dtype ? (DT_COLOR[ev.dtype] || 0xff3030) : (v.u.look && ['golem', 'ginger', 'puff', 'macaron', 'roll'].includes(v.u.look.kind) ? [0xffc0d9, 0xfff2a0, 0xb6f0ff] : 0xb01010), Math.min(24, 6 + ev.amt), { size: 0.06 });
        if (ev.crit) { cam.shake = 0.35; G.Audio && G.Audio.play('crit'); } else G.Audio && G.Audio.play('hit');
        if (ev.amt >= 15) cam.shake = Math.max(cam.shake, 0.18);
        const base = v.body.position.x;
        await tween(0.18, k => { v.body.position.x = base + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k); });
        v.body.position.x = 0;
        return;
      }
      case 'heal': { if (!v) return; v.hp = ev.hp; floatText(v.pos, '+' + ev.amt, 'heal', v.height + 0.3); burst(v.pos, [0x7affb0, 0xffffff], 12, { speed: 0.8, up: 2.5, grav: -1 }); flashUnit(v, 0x10a040, 250); G.Audio && G.Audio.play('heal'); await wait(200); return; }
      case 'temp': { if (!v) return; v.temp = ev.amt; floatText(v.pos, '+' + ev.amt + ' temp', 'temp', v.height + 0.6); G.Audio && G.Audio.play('buff'); await wait(120); return; }
      case 'cond': {
        if (!v) return; floatText(v.pos, condName(ev.c), 'cond', v.height + 0.9, 1800);
        if (ev.c === 'prone' && !v.down) { G.Audio && G.Audio.play('shove'); await fall(v); }
        await wait(160); return;
      }
      case 'save': { if (!v) return; if (ev.c === 'death') return deathRoll(v, ev); floatText(v.pos, ev.ok ? `Saved! (${condName(ev.c)})` : `Save failed`, ev.ok ? 'save' : 'cond', v.height + 1.1, 1200); await wait(100); return; }
      case 'banner': { const tv = v; if (tv) floatText(tv.pos, ev.text, 'banner ' + (ev.cls || ''), tv.height + 1.3, 1600); if (ev.cls === 'crit') G.Audio && G.Audio.play('sting'); await wait(160); return; }
      case 'bark': { bubble(ev.u, ev.text); G.Audio && G.Audio.play('bark'); await wait(500); return; }
      case 'power': { if (v && G.UI) G.UI.powerBanner(v.u, ev.name, ev.kind); await wait(ev.side === 'hero' ? 250 : 650); return; }
      case 'death': {
        if (!v || v.dead) return;
        v.dead = true; v.label.style.display = 'none';
        burst(v.pos, v.u.look && ['golem', 'ginger', 'puff', 'macaron', 'roll'].includes(v.u.look.kind) ? [0xffc0d9, 0xfff2a0, 0xb6f0ff, 0xffffff] : [0x777777, 0xaaaaaa, 0x444444], v.u.solo ? 80 : 22, { cube: true, speed: v.u.solo ? 5 : 3, up: v.u.solo ? 7 : 4, life: 1.1 });
        G.Audio && G.Audio.play(v.u.solo ? 'bossdie' : 'die');
        if (v.u.solo) cam.shake = 0.6;
        const g = v.g;
        await tween(ev.flee ? 0.3 : 0.4, k => { g.rotation.z = k * 1.2; g.scale.setScalar(1 - k * 0.95); g.position.y -= 0.01; });
        scene.remove(g);
        return;
      }
      case 'dying': {
        if (!v) return; G.Audio && G.Audio.play('down'); focus(v.pos);
        await fall(v, 0.6); cam.shake = Math.max(cam.shake, 0.2);
        floatText(v.pos, 'DYING', 'banner blood', v.height + 0.6, 2200); await wait(500); return;
      }
      // revived heroes stay prone until they spend a move to stand
      case 'revive': { if (!v) return; burst(v.pos, 0xffffff, 16, { grav: -2 }); floatText(v.pos, 'Revived!', 'banner heal', v.height + 0.6, 1800); if (!E().hasCond(v.u, 'prone')) await rise(v); await wait(250); return; }
      case 'stand': { if (v) await rise(v); return; }
      case 'explode': {
        const r = ev.r || 1; G.Audio && G.Audio.play(ev.big ? 'bigboom' : 'boom');
        for (const h of Hex.within(ev.at, r)) if (B.tiles.has(Hex.hk(h))) burst(h, [ev.color, 0xffe08a, 0x553322], ev.big ? 10 : 8, { speed: 2, up: 5, life: 0.9 });
        const p = px(ev.at); const light = new THREE.PointLight(ev.color, 4, 10); light.position.set(p.x, 1.5, p.z); scene.add(light);
        cam.shake = ev.big ? 0.7 : 0.45;
        await tween(0.4, k => { light.intensity = 4 * (1 - k); });
        scene.remove(light); return;
      }
      case 'retile': { const t = B.tiles.get(Hex.hk(ev.h)); if (t) buildTile(t); applyHL(); return; }
      case 'spawn': {
        const u = B.units.find(x => x.uid === ev.u); if (!u) return;
        const nv = unitViews.get(u.uid) || addUnitView(u); burst(u.pos, [0xffffff, 0xdddddd], 14, { speed: 1.5, up: 2 });
        G.Audio && G.Audio.play('spawn');
        focus(u.pos);
        await tween(0.35, k => nv.g.scale.setScalar(Math.max(0.01, k)));
        if (ev.init && G.UI && G.UI.joinInitiative) await G.UI.joinInitiative(ev);
        return;
      }
      case 'zone': case 'telegraph': applyHL(); if (ev.t === 'telegraph') G.Audio && G.Audio.play('warn'); await wait(ev.t === 'telegraph' ? 500 : 50); return;
      case 'turn': { if (v) { setActive(ev.u); focus(v.pos); if (G.UI && G.UI.turnBanner) G.UI.turnBanner(v.u); } await wait(120); return; }
      case 'round': { G.UI && G.UI.roundBanner(ev.n); await wait(900); return; }
      case 'story': { if (G.UI && G.UI.event) await G.UI.event(ev.text); return; }
      case 'initiative': { if (G.UI && G.UI.rollInitiative) await G.UI.rollInitiative(ev); return; }
      case 'momentum': { G.UI && G.UI.momentumPulse(); G.Audio && G.Audio.play('momentum'); return; }
      case 'forced': return;
    }
  }
  function burst0(pos, col) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
    m.position.copy(pos); scene.add(m);
    particles.push({ m, v: new THREE.Vector3(0, 0.3, 0), life: 0.3, max: 0.3, grav: 0 });
  }
  function condName(c) { return { cagrant: 'exposed', atkBonus: 'attack bonus', defBonus: 'defense bonus', ongoing: 'burning', vuln: 'vulnerable' }[c] || c; }

  // reconcile visuals with engine state
  function syncAll() {
    if (!B) return;
    for (const u of B.units) {
      let v = unitViews.get(u.uid);
      if (!v && !u.dead) v = addUnitView(u);
      if (!v) continue;
      if (u.dead && !v.dead) { v.dead = true; scene.remove(v.g); v.label.style.display = 'none'; continue; }
      if (u.dead) continue;
      if (!v.anim && (v.pos.q !== u.pos.q || v.pos.r !== u.pos.r)) placeView(v, u.pos);
      v.hp = u.hp; v.temp = u.tempHp;
      const down = E().isDying(u) || E().hasCond(u, 'prone');
      if (!v.anim && v.down !== down) { v.down = down; v.body.rotation.x = down ? -1.45 : 0; v.body.position.y = down ? -0.1 : 0; }
    }
    applyHL();
  }
  function unitScreen(uid) { const v = unitViews.get(uid); if (!v) return null; return screenOf(v.pos, v.height); }
  // page (viewport) coordinates above a unit's head, for HUD elements that fly from the board
  function unitPage(uid, yOff = 0.4) {
    const v = unitViews.get(uid); if (!v) return null;
    const s = screenOf(v.pos, v.height + yOff); const r = renderer.domElement.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }
  function snapshot() { return renderer.domElement.toDataURL('image/png'); }

  G.Render = {
    hexScreen: (h) => { const s = screenOf(h, 0); const r = renderer.domElement.getBoundingClientRect(); return { x: s.x + r.left, y: s.y + r.top }; },
    init, loadBattle, setHighlights, playFx, syncAll, focus, frame, rotate, zoom, pick, setActive, setTargetable, unitScreen, unitPage, floatText, snapshot,
    onHover: (f) => hoverCb = f, onClick: (f) => clickCb = f, onRight: (f) => rightCb = f, resize,
    get camera() { return cam; },
  };
})();
