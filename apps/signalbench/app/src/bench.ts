// The 3D bench: every device on it is driven by the latest simulator snapshot.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { CanEntry, Snapshot } from "./types";

const C = {
  bg: 0x0d2136,
  line: 0x9cc3e6,
  paper: 0xe9f1f8,
  amber: 0xf2b134,
  red: 0xff3b3b,
  blue: 0x2f7dff,
  white: 0xf4f8ff,
  green: 0x3dd68c,
  pcb: 0x0f4a3a,
  alu: 0x8a97a6,
  dark: 0x1a2430,
};

const EXIT_CONNECTOR_Y = 0.075; // PDM back-face connector height (world y; PDM sits on the bench)
const HEAD_COLORS = Array.from({ length: 12 }, (_, i) => (i < 5 ? C.red : i < 7 ? C.white : C.blue));
const ARM_LEN = 1.05;

function std(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts });
}

function box(w: number, h: number, d: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Canvas texture for silkscreen / panel text. */
function textTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 256) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A polyline with rounded corners: straight runs joined by small quadratic
 * bends. Unlike a spline it never overshoots, so routed wires stay on the
 * bench and hug the mounts they climb.
 */
function routed(pts: THREE.Vector3[], bend = 0.06): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cur = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const din = p.clone().sub(a), dout = b.clone().sub(p);
    const r = Math.min(bend, din.length() / 2, dout.length() / 2);
    const pIn = p.clone().sub(din.normalize().multiplyScalar(r));
    const pOut = p.clone().add(dout.normalize().multiplyScalar(r));
    if (cur.distanceTo(pIn) > 1e-5) path.add(new THREE.LineCurve3(cur, pIn));
    path.add(new THREE.QuadraticBezierCurve3(pIn, p.clone(), pOut));
    cur = pOut;
  }
  path.add(new THREE.LineCurve3(cur, pts[pts.length - 1].clone()));
  return path;
}

class Wire {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  curve: THREE.CurvePath<THREE.Vector3>;
  constructor(points: THREE.Vector3[], radius: number, color: number, bend = 0.06) {
    this.curve = routed(points, bend);
    this.mat = std(color, { roughness: 0.45, emissive: 0x000000 });
    const segments = Math.max(64, Math.round(this.curve.getLength() * 140));
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve, segments, radius, 8, false), this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
}

interface Pulse {
  mesh: THREE.Mesh;
  t: number;
  speed: number;
  active: boolean;
  forward: boolean;
}

export class Bench {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private snap: Snapshot | null = null;
  private armShown = 0;

  // dynamic parts
  private heads: THREE.MeshStandardMaterial[] = [];
  private lbLights: THREE.PointLight[] = [];
  private boardLeds: THREE.MeshStandardMaterial[] = [];
  private pdmLeds: THREE.MeshStandardMaterial[] = [];
  private keyMats: THREE.MeshStandardMaterial[] = [];
  private keyMeshes: THREE.Mesh[] = [];
  private armPivot = new THREE.Group();
  private sceneLens!: THREE.MeshStandardMaterial;
  private sceneSpot!: THREE.SpotLight;
  private rearLens: THREE.MeshStandardMaterial[] = [];
  private rearLight!: THREE.PointLight;
  private sirenCone!: THREE.Mesh;
  private mdtScreen!: THREE.MeshStandardMaterial;
  private wires: Wire[] = [];
  private batteryWire!: Wire;
  private canWire!: Wire;
  private canPdmT = 0.35;
  private pulses: Pulse[] = [];
  private textLabels: Record<string, HTMLElement> = {};
  private raycaster = new THREE.Raycaster();
  private pressedKey = -1;

  constructor(private host: HTMLElement, private onKey: (idx: number, pressed: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "label-layer";
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    this.camera.position.set(0.4, 3.4, 5.0);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0.1, 0.35, -0.1);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 10;

    this.scene.background = new THREE.Color(C.bg);
    this.scene.fog = new THREE.Fog(C.bg, 9, 18);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildEnvironment();
    this.buildBattery();
    this.buildPdm();
    this.buildBoard();
    this.buildKeypad();
    this.buildLightbar();
    this.buildSiren();
    this.buildArm();
    this.buildRear();
    this.buildMdt();
    this.buildHarness();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.labels.domElement.addEventListener("pointerdown", (e) => this.pointer(e, true));
    window.addEventListener("pointerup", (e) => this.pointer(e, false));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------- building --

  private label(key: string, parent: THREE.Object3D, pos: THREE.Vector3, title: string) {
    const div = document.createElement("div");
    div.className = "dev-label";
    div.innerHTML = `<b>${title}</b><span></span>`;
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    parent.add(obj);
    this.textLabels[key] = div.querySelector("span")!;
  }

  private setLabel(key: string, html: string, state: "" | "on" | "warn" | "bad" = "") {
    const el = this.textLabels[key];
    if (!el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
    const p = el.parentElement!;
    p.dataset.state = state;
  }

  private buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0xdcecff, 0x1a3350, 1.5);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(0x9cc3e6, 0.9);
    fill.position.set(-4, 3, 3);
    this.scene.add(fill);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3, bottom: -3 });
    this.scene.add(key);

    // bench top with a drafting grid
    const tex = textTexture((g, w, h) => {
      g.fillStyle = "#1f5283";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(190,220,245,0.22)";
      g.lineWidth = 1;
      for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
      for (let j = 0; j <= h; j += 16) { g.beginPath(); g.moveTo(0, j); g.lineTo(w, j); g.stroke(); }
      g.strokeStyle = "rgba(190,220,245,0.45)";
      for (let i = 0; i <= w; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
      for (let j = 0; j <= h; j += 128) { g.beginPath(); g.moveTo(0, j); g.lineTo(w, j); g.stroke(); }
    }, 1024, 1024);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1.8);
    const top = box(6.4, 0.08, 3.6, std(0xffffff, { map: tex, roughness: 0.85 }));
    top.position.y = -0.04;
    this.scene.add(top);

    // back wall + floor in darkness
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), std(0x163a5e, { roughness: 1 }));
    wall.position.set(0, 2, -2.2);
    wall.receiveShadow = true;
    this.scene.add(wall);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), std(0x0a1a2b, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.9;
    this.scene.add(floor);
  }

  private buildBattery() {
    const g = new THREE.Group();
    g.position.set(-2.55, 0, 0.75);
    const body = box(0.62, 0.42, 0.36, std(0x20262e, { roughness: 0.8 }));
    body.position.y = 0.21;
    g.add(body);
    const lid = box(0.64, 0.05, 0.38, std(0x2c333d));
    lid.position.y = 0.445;
    g.add(lid);
    for (const [x, col] of [[-0.2, C.red], [0.2, 0x111111]] as const) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.07, 16), std(col, { metalness: 0.6 }));
      post.position.set(x, 0.5, 0);
      g.add(post);
    }
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.25),
      new THREE.MeshBasicMaterial({
        map: textTexture((c, w, h) => {
          c.fillStyle = "#e9f1f8";
          c.font = "600 64px 'IBM Plex Sans Condensed', sans-serif";
          c.fillText("12 V", 24, 96);
          c.font = "36px 'IBM Plex Sans Condensed', sans-serif";
          c.fillText("demo battery  4 Ah", 24, 170);
          c.strokeStyle = "#e9f1f8"; c.lineWidth = 4; c.strokeRect(8, 8, w - 16, h - 16);
        }),
        transparent: true,
      }),
    );
    face.position.set(0, 0.22, 0.181);
    g.add(face);
    this.scene.add(g);
    this.label("battery", g, new THREE.Vector3(0, 0.62, 0), "Battery");
  }

  private buildPdm() {
    const g = new THREE.Group();
    g.position.set(-1.45, 0, 0.35);
    const body = box(0.78, 0.22, 0.5, std(C.alu, { metalness: 0.55, roughness: 0.38 }));
    body.position.y = 0.11;
    g.add(body);
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.46),
      new THREE.MeshStandardMaterial({
        map: textTexture((c, w, h) => {
          c.fillStyle = "#7f8c9b"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#16222f";
          c.font = "600 44px 'IBM Plex Sans Condensed', sans-serif";
          c.fillText("SB-PDM8", 20, 52);
          c.font = "22px 'IBM Plex Sans Condensed', sans-serif";
          c.fillText("8-channel power distribution · CAN 500k", 20, 84);
          ["LB", "SIR", "SCN", "ARM", "REAR", "MDT", "AX1", "AX2"].forEach((n, i) => {
            c.fillText(n, 22 + i * 61, 236);
          });
        }, 512, 256),
        metalness: 0.4,
        roughness: 0.5,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.221;
    g.add(top);
    for (let i = 0; i < 8; i++) {
      const mat = std(0x222222, { emissive: 0x000000 });
      const led = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 16), mat);
      led.position.set(-0.33 + i * 0.0935, 0.226, 0.1);
      g.add(led);
      this.pdmLeds.push(mat);
    }
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), std(0xb87333, { metalness: 0.8 }));
    stud.rotation.z = Math.PI / 2;
    stud.position.set(-0.42, 0.12, 0);
    g.add(stud);
    const gnd = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 12), std(0x2a2f36, { metalness: 0.7 }));
    gnd.rotation.z = Math.PI / 2;
    gnd.position.set(-0.41, 0.05, 0.17);
    g.add(gnd);
    // output and CAN connectors on the back face
    const conn = box(0.56, 0.05, 0.03, std(0x15191e));
    conn.position.set(-0.07, EXIT_CONNECTOR_Y, -0.255);
    g.add(conn);
    this.scene.add(g);
    this.label("pdm", g, new THREE.Vector3(0, 0.42, 0), "PDM");
  }

  private buildBoard() {
    const g = new THREE.Group();
    g.position.set(-0.25, 0.06, 0.95);
    const silk = textTexture((c, w, h) => {
      c.fillStyle = "#0f4a3a"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(200,220,190,0.25)"; c.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        c.beginPath(); c.moveTo(150 + i * 8, 120); c.lineTo(150 + i * 8, 60 + (i % 5) * 6); c.lineTo(40 + i * 12, 20); c.stroke();
      }
      c.fillStyle = "#e9f1f8";
      c.font = "600 30px 'IBM Plex Sans Condensed', sans-serif";
      c.fillText("SB-CTRL  rev C", 300, 316);
      c.font = "18px 'IBM Plex Sans Condensed', sans-serif";
      c.fillText("MCU", 205, 250); c.fillText("CAN", 60, 330); c.fillText("H-BRIDGE", 400, 110);
      c.fillText("TMP102", 92, 170); c.fillText("HB  FLT  CAN", 300, 60);
    }, 640, 360);
    const pcb = box(0.9, 0.025, 0.55, std(0xffffff, { map: silk, roughness: 0.7 }));
    pcb.position.y = 0.06;
    g.add(pcb);
    for (const [x, z] of [[-0.4, -0.24], [0.4, -0.24], [-0.4, 0.24], [0.4, 0.24]]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), std(0xc0a060, { metalness: 0.7 }));
      so.position.set(x, 0.03, z);
      g.add(so);
    }
    const mcu = box(0.17, 0.02, 0.17, std(0x111317, { roughness: 0.4 }));
    mcu.position.set(-0.08, 0.083, 0.02);
    g.add(mcu);
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.15),
      new THREE.MeshBasicMaterial({
        transparent: true,
        map: textTexture((c) => {
          c.fillStyle = "#9aa3ad";
          c.font = "600 40px 'IBM Plex Mono', monospace";
          c.fillText("ARM", 60, 90); c.fillText("CORTEX-M4", 60, 150);
          c.font = "28px 'IBM Plex Mono', monospace";
          c.fillText("SB32F4  168MHz", 60, 200);
        }, 512, 256),
      }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(-0.08, 0.0935, 0.02);
    g.add(mark);
    const hb = box(0.12, 0.05, 0.1, std(0x30363d, { metalness: 0.6, roughness: 0.3 }));
    hb.position.set(0.27, 0.098, -0.15);
    g.add(hb);
    for (let k = 0; k < 6; k++) {
      const fin = box(0.12, 0.05, 0.006, std(0x9aa6b2, { metalness: 0.8, roughness: 0.3 }));
      fin.position.set(0.27, 0.14, -0.19 + k * 0.016);
      g.add(fin);
    }
    for (const [x, z, w] of [[-0.33, 0.17, 0.08], [-0.3, -0.1, 0.04]] as const) {
      const ic = box(w, 0.012, 0.05, std(0x15181c));
      ic.position.set(x, 0.079, z);
      g.add(ic);
    }
    [C.green, C.red, C.amber].forEach((col, i) => {
      const mat = std(0x333333, { emissive: 0x000000 });
      const led = box(0.022, 0.012, 0.014, mat);
      led.position.set(0.1 + i * 0.05, 0.08, -0.205);
      g.add(led);
      this.boardLeds.push(mat);
      (mat.userData as { on: number }).on = col;
    });
    for (let k = 0; k < 3; k++) {
      const hdr = box(0.12, 0.03, 0.03, std(0x101010));
      hdr.position.set(-0.36 + k * 0.0, 0.088, -0.2 + k * 0.0);
      hdr.position.x = 0.36;
      hdr.position.z = 0.05 + k * 0.07;
      g.add(hdr);
    }
    this.scene.add(g);
    this.label("board", g, new THREE.Vector3(0, 0.3, -0.05), "SB-CTRL");
  }

  private buildKeypad() {
    const g = new THREE.Group();
    g.position.set(0.95, 0.0, 1.2);
    g.rotation.x = -0.15;
    const base = box(0.86, 0.06, 0.32, std(0x1b2129, { roughness: 0.5 }));
    base.position.y = 0.05;
    g.add(base);
    const names = ["LGT", "SIR", "HRN", "SCN", "ARM", "TKD", "REAR", "AUX"];
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      const mat = std(0x2b3440, {
        emissive: 0x000000,
        map: textTexture((c, w, h) => {
          c.fillStyle = "#2b3440"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#cfd9e4";
          c.font = "600 70px 'IBM Plex Sans Condensed', sans-serif";
          c.textAlign = "center";
          c.fillText(names[i], w / 2, h / 2 + 24);
        }, 256, 160),
      });
      const key = box(0.17, 0.035, 0.11, mat);
      key.position.set(-0.3 + col * 0.2, 0.095, -0.065 + row * 0.13);
      key.userData.key = i;
      g.add(key);
      this.keyMats.push(mat);
      this.keyMeshes.push(key);
    }
    this.scene.add(g);
    this.label("keypad", g, new THREE.Vector3(0, 0.28, -0.1), "Keypad");
  }

  private buildLightbar() {
    const g = new THREE.Group();
    g.position.set(0.15, 0, -1.05);
    for (const x of [-1.0, 1.0]) {
      const leg = box(0.05, 0.95, 0.05, std(0x3a4552, { metalness: 0.5 }));
      leg.position.set(x, 0.475, 0);
      g.add(leg);
    }
    const rail = box(2.3, 0.04, 0.08, std(0x3a4552, { metalness: 0.5 }));
    rail.position.y = 0.95;
    g.add(rail);
    const housing = box(2.5, 0.14, 0.3, std(0x161b22, { roughness: 0.35, metalness: 0.3 }));
    housing.position.y = 1.06;
    g.add(housing);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x222a33,
        emissive: HEAD_COLORS[i],
        emissiveIntensity: 0,
        roughness: 0.2,
        metalness: 0,
      });
      const lens = box(0.17, 0.09, 0.02, mat);
      lens.position.set(-1.1 + i * 0.2, 1.06, 0.152);
      g.add(lens);
      this.heads.push(mat);
    }
    for (const [x, col] of [[-0.7, C.red], [0.0, C.white], [0.7, C.blue]] as const) {
      const l = new THREE.PointLight(col, 0, 5, 1.6);
      l.position.set(x, 1.0, 0.5);
      g.add(l);
      this.lbLights.push(l);
    }
    this.scene.add(g);
    this.label("lightbar", g, new THREE.Vector3(0, 1.32, 0), "Lightbar SB-LB12");
  }

  private buildSiren() {
    const g = new THREE.Group();
    g.position.set(-2.2, 0, -0.95);
    const bracket = box(0.06, 0.5, 0.06, std(0x3a4552, { metalness: 0.5 }));
    bracket.position.y = 0.25;
    g.add(bracket);
    const body = box(0.42, 0.34, 0.24, std(0x1c2229, { roughness: 0.5 }));
    body.position.y = 0.62;
    g.add(body);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.14, 32), std(0x0c0f13, { roughness: 0.9 }));
    grille.position.set(0, 0.62, 0.121);
    g.add(grille);
    this.sirenCone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.06, 32, 1, true), std(0x3c4652, { side: THREE.DoubleSide }));
    this.sirenCone.rotation.x = -Math.PI / 2;
    this.sirenCone.position.set(0, 0.62, 0.13);
    g.add(this.sirenCone);
    this.scene.add(g);
    this.label("siren", g, new THREE.Vector3(0, 0.95, 0), "Siren");
  }

  private buildArm() {
    const g = new THREE.Group();
    g.position.set(1.85, 0, -0.55);
    const base = box(0.3, 0.12, 0.3, std(0x2a323c, { metalness: 0.4 }));
    base.position.y = 0.06;
    g.add(base);
    const post = box(0.1, 0.3, 0.1, std(0x3a4552, { metalness: 0.5 }));
    post.position.y = 0.27;
    g.add(post);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 20), std(0x56606c, { metalness: 0.7, roughness: 0.3 }));
    motor.rotation.x = Math.PI / 2;
    motor.position.set(0, 0.42, -0.1);
    g.add(motor);
    this.armPivot.position.set(0, 0.42, 0);
    g.add(this.armPivot);
    const boom = box(ARM_LEN, 0.06, 0.06, std(C.amber, { roughness: 0.45, metalness: 0.2 }));
    boom.position.x = -ARM_LEN / 2;
    this.armPivot.add(boom);
    const head = new THREE.Group();
    head.position.x = -ARM_LEN;
    this.armPivot.add(head);
    const lamp = box(0.12, 0.2, 0.22, std(0x1a1f26, { metalness: 0.4 }));
    head.add(lamp);
    this.sceneLens = new THREE.MeshStandardMaterial({ color: 0x2a3038, emissive: 0xfff4e0, emissiveIntensity: 0 });
    const lens = box(0.012, 0.17, 0.19, this.sceneLens);
    lens.position.x = -0.065;
    head.add(lens);
    this.sceneSpot = new THREE.SpotLight(0xfff1dc, 0, 9, 0.62, 0.45, 1.2);
    this.sceneSpot.position.set(-0.08, 0, 0);
    this.sceneSpot.castShadow = true;
    this.sceneSpot.shadow.mapSize.set(1024, 1024);
    head.add(this.sceneSpot);
    const target = new THREE.Object3D();
    target.position.set(-0.3, 0, 0.9);
    this.scene.add(target);
    this.sceneSpot.target = target;
    this.scene.add(g);
    this.label("arm", g, new THREE.Vector3(0.0, 0.1, 0.3), "Scene-light arm");
  }

  private buildRear() {
    const g = new THREE.Group();
    g.position.set(2.75, 0, 0.35);
    const bar = box(0.12, 0.42, 0.08, std(0x2a323c));
    bar.position.y = 0.21;
    g.add(bar);
    for (const y of [0.18, 0.36]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffa21a, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24), mat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(0, y, 0.06);
      g.add(lamp);
      this.rearLens.push(mat);
    }
    this.rearLight = new THREE.PointLight(0xffa21a, 0, 3, 1.8);
    this.rearLight.position.set(0, 0.3, 0.4);
    g.add(this.rearLight);
    this.scene.add(g);
    this.label("rear", g, new THREE.Vector3(0, 0.6, 0), "Rear flashers");
  }

  private buildMdt() {
    const g = new THREE.Group();
    g.position.set(2.35, 0, 1.15);
    g.rotation.y = -0.5;
    const stand = box(0.05, 0.22, 0.05, std(0x2a323c));
    stand.position.y = 0.11;
    g.add(stand);
    const bezel = box(0.5, 0.33, 0.04, std(0x14181d));
    bezel.position.y = 0.36;
    bezel.rotation.x = -0.2;
    g.add(bezel);
    this.mdtScreen = new THREE.MeshStandardMaterial({
      color: 0x050709,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      emissiveMap: textTexture((c, w, h) => {
        c.fillStyle = "#0a1e33"; c.fillRect(0, 0, w, h);
        c.fillStyle = "#9cc3e6";
        c.font = "600 34px 'IBM Plex Sans Condensed', sans-serif";
        c.fillText("Unit 14 — in service", 24, 52);
        c.font = "24px 'IBM Plex Mono', monospace";
        ["CAD   connected", "GPS   42.24N 83.61W", "RADIO ch 3 / talk", "CALLS 0 pending"].forEach((t, i) => c.fillText(t, 24, 110 + i * 38));
      }),
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.27), this.mdtScreen);
    screen.position.set(0, 0.36, 0.021);
    screen.rotation.x = -0.2;
    screen.position.z = 0.025;
    g.add(screen);
    this.scene.add(g);
    this.label("mdt", g, new THREE.Vector3(0, 0.62, 0), "MDT / radio");
  }

  /**
   * Wiring, routed like a real bench harness: every PDM output leaves the
   * PDM's back face, drops to the bench, runs east or west in its own lane of
   * a parallel trunk, peels off without crossing another wire, and climbs the
   * device's mount. (+x is east, -z is toward the back wall.)
   */
  private buildHarness() {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const R = 0.014;          // harness wire radius; wires lie on the bench at y = R
    const BACK = 0.1;         // PDM back face (z)
    const EXIT_Y = 0.07;      // height of the PDM output connector

    // Leave the PDM back face, drop to the bench, head out to this wire's lane.
    const fromPdm = (x: number, lane: number, ...rest: THREE.Vector3[]) => [
      V(x, EXIT_Y, BACK), V(x, EXIT_Y, 0.03), V(x, R, 0.03), V(x, R, lane), ...rest,
    ];

    // Lanes: east-bound wires that exit further west take deeper lanes, so
    // every peel-off turns away from the wires still in the trunk.
    const routes: THREE.Vector3[][] = [
      // 0 lightbar: east, then north to the left stand leg and up its front face
      fromPdm(-1.69, -0.40, V(-0.835, R, -0.40), V(-0.835, R, -0.995), V(-0.835, 0.99, -0.995)),
      // 1 siren: the only west-bound wire, so it gets the leftmost connector pin
      fromPdm(-1.78, -0.25, V(-2.2, R, -0.25), V(-2.2, R, -0.9), V(-2.2, 0.45, -0.9)),
      // 2 scene light and 3 arm motor: into the arm base's west face
      fromPdm(-1.59, -0.36, V(1.52, R, -0.36), V(1.52, R, -0.6), V(1.70, R, -0.6)),
      fromPdm(-1.50, -0.32, V(1.58, R, -0.32), V(1.58, R, -0.5), V(1.70, R, -0.5)),
      // 4 rear flashers: along the trunk, then forward to the bracket
      fromPdm(-1.41, -0.28, V(2.5, R, -0.28), V(2.5, R, 0.35), V(2.69, R, 0.35)),
      // 5 MDT: forward early, behind the keypad, to the terminal stand
      fromPdm(-1.31, -0.24, V(2.2, R, -0.24), V(2.2, R, 1.15), V(2.315, R, 1.15)),
    ];
    for (const pts of routes) {
      const w = new Wire(pts, R, 0x4b5563);
      this.wires.push(w);
      this.scene.add(w.mesh);
    }

    // Cable ties holding the trunk together
    for (const x of [-1.05, -0.2, 0.6, 1.3]) {
      const lanesHere = x < -0.85 ? [-0.42, -0.22] : [-0.38, -0.22];
      const depth = lanesHere[1] - lanesHere[0];
      const tie = box(0.018, 0.036, depth + 0.02, std(0x1b1f24, { roughness: 0.7 }));
      tie.position.set(x, 0.018, (lanesHere[0] + lanesHere[1]) / 2);
      this.scene.add(tie);
    }

    // Battery: red feed over the battery top and behind it to the PDM stud,
    // black ground behind it to a chassis stud. Routed so they never cross.
    this.batteryWire = new Wire(
      [V(-2.75, 0.535, 0.75), V(-2.75, 0.6, 0.75), V(-2.75, 0.6, 0.35), V(-2.75, 0.022, 0.35),
       V(-2.0, 0.022, 0.35), V(-2.0, 0.12, 0.35), V(-1.9, 0.12, 0.35)],
      0.022, 0x8a1c1c, 0.08,
    );
    this.scene.add(this.batteryWire.mesh);
    const ground = new Wire(
      [V(-2.35, 0.535, 0.75), V(-2.35, 0.6, 0.75), V(-2.35, 0.6, 0.52), V(-2.35, 0.02, 0.52),
       V(-1.95, 0.02, 0.52), V(-1.95, 0.05, 0.52), V(-1.85, 0.05, 0.52)],
      0.02, 0x16191d, 0.08,
    );
    this.scene.add(ground.mesh);

    // CAN bus: control board -> PDM (in the front face, out the back) ->
    // over the trunk on a small bridge -> up the lightbar leg beside the power wire.
    const X = -1.22; // clear of the harness pins (-1.78 .. -1.31)
    const canPts = [
      V(-0.70, 0.12, 1.05), V(-0.78, 0.12, 1.05), V(-0.78, 0.01, 1.05),
      V(X, 0.01, 1.05), V(X, 0.01, 0.66), V(X, 0.08, 0.66), V(X, 0.08, 0.35), // into the PDM
      V(X, 0.08, 0.0), V(X, 0.055, -0.14), V(X, 0.055, -0.48), V(X, 0.01, -0.58),
      V(X, 0.01, -0.995), V(-0.866, 0.01, -0.995), V(-0.866, 0.99, -0.995),
    ];
    this.canWire = new Wire(canPts, 0.01, 0xc9a227, 0.05);
    this.canWire.mat.emissive.setHex(0x3a2c06);
    this.scene.add(this.canWire.mesh);
    // where the PDM sits along the cable, for the traffic animation
    const upTo = (n: number) => canPts.slice(1, n + 1).reduce((s, p, i) => s + p.distanceTo(canPts[i]), 0);
    this.canPdmT = upTo(6) / upTo(canPts.length - 1);

    // Keypad ribbon to the control board's edge header
    const ribbon = new Wire(
      [V(0.20, 0.12, 1.1), V(0.27, 0.12, 1.1), V(0.27, 0.01, 1.1), V(0.42, 0.01, 1.1), V(0.42, 0.01, 1.22), V(0.53, 0.05, 1.22)],
      0.01, 0x8d99a6, 0.04,
    );
    this.scene.add(ribbon.mesh);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      this.scene.add(m);
      this.pulses.push({ mesh: m, t: 0, speed: 1, active: false, forward: true });
    }
  }

  // ---------------------------------------------------------- interaction --

  private pointer(e: PointerEvent, down: boolean) {
    if (!down) {
      if (this.pressedKey >= 0) {
        this.onKey(this.pressedKey, false);
        this.pressedKey = -1;
        this.controls.enabled = true;
      }
      return;
    }
    const r = this.labels.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.keyMeshes)[0];
    if (hit) {
      this.pressedKey = hit.object.userData.key as number;
      this.controls.enabled = false;
      this.onKey(this.pressedKey, true);
    }
  }

  setView(name: "overview" | "board" | "lightbar" | "arm") {
    const views = {
      overview: [new THREE.Vector3(0.4, 3.4, 5.0), new THREE.Vector3(0.1, 0.35, -0.1)],
      board: [new THREE.Vector3(-0.1, 1.5, 2.2), new THREE.Vector3(-0.5, 0.1, 0.8)],
      lightbar: [new THREE.Vector3(0.2, 1.6, 1.6), new THREE.Vector3(0.15, 1.0, -1.05)],
      arm: [new THREE.Vector3(2.6, 1.6, 1.4), new THREE.Vector3(1.4, 0.5, -0.5)],
    } as const;
    const [pos, tgt] = views[name];
    this.camera.position.copy(pos);
    this.controls.target.copy(tgt);
  }

  // -------------------------------------------------------------- updates --

  canTraffic(frames: CanEntry[]) {
    let n = 0;
    for (const f of frames) {
      if (n > 6) break;
      const p = this.pulses.find((q) => !q.active);
      if (!p) break;
      p.active = true;
      p.forward = f.src === "CTRL";
      p.t = p.forward ? 0 : f.src === "PDM" ? this.canPdmT : 1;
      p.speed = 0.9 + Math.random() * 0.3;
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(f.src === "CTRL" ? 0xffd25a : f.src === "PDM" ? 0x9cc3e6 : 0xff7a7a);
      p.mesh.visible = true;
      n++;
    }
  }

  update(s: Snapshot) {
    this.snap = s;
    const out = (pin: number) => ((s.gpio_out >>> pin) & 1) === 1;

    // control board LEDs
    [16, 17, 18].forEach((pin, i) => {
      const m = this.boardLeds[i];
      const on = out(pin);
      m.emissive.setHex(on ? (m.userData as { on: number }).on : 0x000000);
      m.emissiveIntensity = on ? 3 : 0;
    });
    // keypad backlights
    this.keyMats.forEach((m, i) => {
      const on = out(24 + i);
      m.emissive.setHex(on ? C.amber : 0x000000);
      m.emissiveIntensity = on ? 0.9 : 0;
      this.keyMeshes[i].position.y = s.buttons[i] ? 0.085 : 0.095;
    });
    // PDM channel LEDs + harness
    s.pdm.forEach((ch, i) => {
      const led = this.pdmLeds[i];
      const blink = (performance.now() / 250) % 2 < 1;
      let col = 0x000000;
      if (ch.tripped) col = blink ? C.red : 0x000000;
      else if (ch.open_load) col = C.amber;
      else if (ch.duty_eff > 0) col = C.green;
      led.emissive.setHex(col);
      led.emissiveIntensity = col ? 2.5 : 0;
      const w = this.wires[i];
      if (!w) return;
      const load = Math.min(1, ch.current / ch.limit);
      if (s.faults.short[i]) {
        w.mat.emissive.setHex(C.red);
        w.mat.emissiveIntensity = blink ? 1.2 : 0.3;
      } else if (ch.tripped) {
        w.mat.emissive.setHex(C.red);
        w.mat.emissiveIntensity = 0.35;
      } else if (ch.current > 0.05) {
        w.mat.emissive.setHex(0xff8a2a);
        w.mat.emissiveIntensity = 0.25 + load * 1.6;
      } else {
        w.mat.emissive.setHex(0x000000);
        w.mat.emissiveIntensity = 0;
      }
    });
    this.batteryWire.mat.emissive.setHex(0xff3a2a);
    this.batteryWire.mat.emissiveIntensity = Math.min(1.5, s.i_total / 40);

    // lightbar heads + coloured spill light
    let red = 0, white = 0, blue = 0;
    const k = s.lb_intensity / 255;
    this.heads.forEach((m, i) => {
      const lit = ((s.lb_lit >> i) & 1) === 1;
      m.emissiveIntensity = lit ? 2.2 + 3 * k : 0;
      if (lit) i < 5 ? red++ : i < 7 ? white++ : blue++;
    });
    this.lbLights[0].intensity = red * 1.6 * k;
    this.lbLights[1].intensity = white * 2.0 * k;
    this.lbLights[2].intensity = blue * 2.2 * k;

    // scene light, rear, MDT
    this.sceneLens.emissiveIntensity = s.scene_level * 6;
    this.sceneSpot.intensity = s.scene_level * 28;
    this.rearLens.forEach((m) => (m.emissiveIntensity = s.rear_lit ? 4 : 0));
    this.rearLight.intensity = s.rear_lit ? 2.5 : 0;
    this.mdtScreen.emissiveIntensity = s.mdt_on ? 0.95 : 0;

    this.canTraffic(s.can);
    this.updateLabels(s);
  }

  private updateLabels(s: Snapshot) {
    const a = (v: number) => `${v.toFixed(1)} A`;
    const lowV = s.vbat < 11.9;
    this.setLabel("battery", `${s.vbat.toFixed(2)} V · ${(s.soc * 100).toFixed(0)}%${s.engine ? " · charging" : ""}`, lowV ? "warn" : s.engine ? "on" : "");
    const trips = s.pdm.filter((c) => c.tripped).length;
    this.setLabel("pdm", s.pdm_failsafe ? "failsafe (no CAN cmd)" : `${a(s.i_total)} total${trips ? ` · ${trips} tripped` : ""}`, s.pdm_failsafe || trips ? "bad" : s.i_total > 0.1 ? "on" : "");
    const fw = s.fw.state;
    this.setLabel("board", fw === "running" ? `running · ${s.board_temp.toFixed(1)} °C` : fw, fw === "running" ? "on" : fw === "stalled" ? "bad" : "warn");
    this.setLabel("lightbar", s.lb_alive ? `${a(s.pdm[0].current)} · ${(s.lb_intensity / 2.55).toFixed(0)}%` : "off", s.pdm[0].tripped ? "bad" : s.lb_alive ? "on" : "");
    this.setLabel("siren", s.siren_sounding ? `${s.siren_freq} Hz · ${a(s.pdm[1].current)}` : "quiet", s.pdm[1].tripped ? "bad" : s.siren_sounding ? "on" : "");
    this.setLabel("arm", `${s.arm_deg.toFixed(1)}° · motor ${a(Math.abs(s.arm_current))}`, s.pdm[3].tripped || s.faults.arm_jam ? "bad" : Math.abs(s.arm_current) > 0.1 ? "on" : "");
    this.setLabel("rear", s.pdm[4].tripped ? "tripped" : s.rear_lit ? "flash" : "off", s.pdm[4].tripped ? "bad" : s.rear_lit ? "on" : "");
    this.setLabel("mdt", s.mdt_on ? a(s.pdm[5].current) : "off", s.pdm[5].tripped ? "bad" : s.mdt_on ? "on" : "");
    const lit = Array.from({ length: 8 }, (_, i) => ((s.gpio_out >>> (24 + i)) & 1 ? "■" : "□")).join("");
    this.setLabel("keypad", lit, "");
  }

  // ---------------------------------------------------------------- frame --

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const s = this.snap;
    if (s) {
      // arm: ease toward the reported angle (snapshots arrive at ~30 Hz)
      this.armShown += (s.arm_deg - this.armShown) * Math.min(1, dt * 12);
      this.armPivot.rotation.z = -THREE.MathUtils.degToRad(this.armShown);
      // siren cone vibrates while sounding
      const amp = s.siren_sounding ? 0.12 : 0;
      this.sirenCone.scale.setScalar(1 + amp * Math.sin(performance.now() * 0.08));
    }
    for (const p of this.pulses) {
      if (!p.active) continue;
      p.t += (p.forward ? 1 : -1) * dt * p.speed;
      if (p.t > 1 || p.t < 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.copy(this.canWire.curve.getPointAt(p.t));
    }
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }
}
