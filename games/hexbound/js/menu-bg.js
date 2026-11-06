// Main menu backdrop: a small floating hex island that slowly turns under drifting embers.
// Its own renderer and scene, separate from the battle view; it only renders while the menu is showing.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  let renderer, scene, camera, island, embers, host, running = false, t0 = 0;
  const SQ3 = Math.sqrt(3);

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function build() {
    const THREE = window.THREE;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1424, 18, 46);
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xc8b8ff, 0x2a1830, 0.75));
    const sun = new THREE.DirectionalLight(0xffd8a0, 1.15); sun.position.set(8, 14, 6); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8a6aff, 0.5); rim.position.set(-10, 4, -8); scene.add(rim);

    island = new THREE.Group(); scene.add(island);
    const R = rng(7);
    const hexGeo = new THREE.CylinderGeometry(0.98, 0.98, 1, 6);
    const mats = {
      grass: [0x4f9a45, 0x5aa84c, 0x468c3e].map(c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: .9 })),
      stone: new THREE.MeshStandardMaterial({ color: 0x7c766a, flatShading: true, roughness: .9 }),
      water: new THREE.MeshStandardMaterial({ color: 0x3a8ad8, flatShading: true, roughness: .3, emissive: 0x0a2850, transparent: true, opacity: .9 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x5a4030, flatShading: true, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x5a3a22, flatShading: true }),
      leaf: [0x2f7a3a, 0x3a8a40, 0x27693a].map(c => new THREE.MeshStandardMaterial({ color: c, flatShading: true })),
      rock: new THREE.MeshStandardMaterial({ color: 0x8c877c, flatShading: true }),
      banner: new THREE.MeshStandardMaterial({ color: 0xc0392b, flatShading: true, side: THREE.DoubleSide }),
      pole: new THREE.MeshStandardMaterial({ color: 0xe8c26a, flatShading: true, metalness: .4 }),
    };
    const N = 6;
    for (let q = -N; q <= N; q++) for (let r = -N; r <= N; r++) {
      const s = -q - r; const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(s)); if (d > N) continue;
      if (d === N && R() < 0.45) continue; // ragged edge
      const x = SQ3 * (q + r / 2), z = 1.5 * r;
      const river = Math.abs(q + 2 * r * 0.35 - 1) < 0.8 && d < N;
      let h = river ? 0.25 : 0.6 + R() * 0.35 + (d < 2 ? 0.25 : 0) + (q > 2 && r < -1 ? 0.7 : 0);
      const m = river ? mats.water : (h > 1.4 ? mats.stone : mats.grass[Math.floor(R() * 3)]);
      const top = new THREE.Mesh(hexGeo, m); top.scale.y = 0.35; top.position.set(x, h - 0.17, z); island.add(top);
      // earthen column below, tapering into the void
      const depth = 1.2 + (N - d) * 0.45 + R() * 0.8;
      const col = new THREE.Mesh(hexGeo, mats.dirt); col.scale.set(0.97, depth, 0.97); col.position.set(x, h - 0.34 - depth / 2, z); island.add(col);
      if (river) continue;
      const roll = R();
      if (roll < 0.22 && d > 1) {
        const tr = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5), mats.trunk); trunk.position.y = 0.25; tr.add(trunk);
        const lm = mats.leaf[Math.floor(R() * 3)];
        for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.55 - k * 0.13, 0.7, 7), lm); c.position.y = 0.65 + k * 0.38; tr.add(c); }
        tr.position.set(x + (R() - .5) * .4, h, z + (R() - .5) * .4); tr.scale.setScalar(0.8 + R() * 0.6); island.add(tr);
      } else if (roll < 0.3) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + R() * 0.2, 0), mats.rock); rock.position.set(x, h + 0.15, z); rock.rotation.set(R() * 3, R() * 3, 0); island.add(rock);
      }
    }
    // a banner at the heart of the island
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), mats.pole); pole.position.set(0, 1.2 + 1.1, 0); island.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 6, 2), mats.banner); flag.position.set(0.47, 3.0, 0); island.add(flag);
    island.userData.flag = flag;
    // embers
    const n = 160, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (R() - .5) * 30; pos[i * 3 + 1] = R() * 14 - 4; pos[i * 3 + 2] = (R() - .5) * 30; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    embers = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc070, size: 0.09, transparent: true, opacity: .85, depthWrite: false }));
    scene.add(embers);
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // keep the island to one side on wide screens so the menu reads clearly
    camera.setViewOffset(w, h, w > 900 ? -w * 0.2 : 0, 0, w, h);
    camera.updateProjectionMatrix();
  }

  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!host.isConnected || !host.closest('.screen.on')) { running = false; return; }
    const s = (t - t0) / 1000;
    const a = s * 0.06;
    camera.position.set(Math.cos(a) * 25, 11.5 + Math.sin(s * 0.2) * 0.6, Math.sin(a) * 21);
    camera.lookAt(0, -0.5, 0);
    island.position.y = Math.sin(s * 0.5) * 0.25;
    const f = island.userData.flag, p = f.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.45; p.setZ(i, Math.sin(s * 4 + x * 5) * 0.08 * x); }
    p.needsUpdate = true;
    const e = embers.geometry.attributes.position;
    for (let i = 0; i < e.count; i++) { let y = e.getY(i) + 0.012; if (y > 10) y = -4; e.setY(i, y); e.setX(i, e.getX(i) + Math.sin(s + i) * 0.004); }
    e.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // mount the backdrop into a container (the menu re-renders its HTML, so this is called each time)
  function mount(el) {
    if (!window.THREE) return;
    try {
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        build();
        window.addEventListener('resize', resize);
      }
    } catch (e) { renderer = null; return; } // no WebGL: the CSS gradient stays
    host = el; el.appendChild(renderer.domElement);
    resize();
    if (!running) { running = true; t0 = t0 || performance.now(); requestAnimationFrame(frame); }
  }
  G.MenuBG = { mount };
})();
