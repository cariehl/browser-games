// Multi-lane oscilloscope fed with the simulator's 1 kHz samples.
const CAP = 20000; // 20 s of history at 1 kHz
const COLORS = ["#f2b134", "#ff7a7a", "#7cc4ff", "#c9a7ff", "#5fe0b0", "#ffd25a", "#e9f1f8", "#3dd68c"];

export class Scope {
  private data: Float32Array[] = Array.from({ length: 8 }, () => new Float32Array(CAP));
  private head = 0;
  private count = 0;
  private ctx: CanvasRenderingContext2D;
  enabled = [true, true, true, true, false, true, true, false];
  windowMs = 5000;
  frozen = false;
  names: string[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  push(samples: number[][]) {
    if (this.frozen) return;
    for (const s of samples) {
      for (let c = 0; c < 8; c++) this.data[c][this.head] = s[c];
      this.head = (this.head + 1) % CAP;
      if (this.count < CAP) this.count++;
    }
  }

  clear() {
    this.count = 0;
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const chans = this.enabled.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
    if (!chans.length) return;
    const n = Math.min(this.count, this.windowMs);
    const left = 132, right = W - 8;
    const laneH = H / chans.length;
    g.font = "12px 'IBM Plex Sans Condensed', sans-serif";

    // time grid (10 divisions, like a scope)
    g.strokeStyle = "rgba(156,195,230,0.12)";
    g.lineWidth = 1;
    for (let d = 0; d <= 10; d++) {
      const x = left + ((right - left) * d) / 10;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    g.fillStyle = "rgba(156,195,230,0.7)";
    g.textAlign = "right";
    g.fillText(`${fmtTime(this.windowMs / 10)}/div`, right - 4, H - 6);
    g.textAlign = "left";

    chans.forEach((c, lane) => {
      const y0 = lane * laneH;
      // find range over the visible window
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = this.data[c][(this.head - n + k + CAP) % CAP];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
      const pad = (hi - lo) * 0.12;
      lo -= pad; hi += pad;
      const ymap = (v: number) => y0 + laneH - 4 - ((v - lo) / (hi - lo)) * (laneH - 8);

      g.strokeStyle = "rgba(156,195,230,0.18)";
      g.beginPath(); g.moveTo(0, y0 + laneH); g.lineTo(W, y0 + laneH); g.stroke();
      const last = n ? this.data[c][(this.head - 1 + CAP) % CAP] : 0;
      g.fillStyle = COLORS[c];
      g.fillText(this.names[c] ?? `ch${c}`, 8, y0 + 16);
      g.fillStyle = "#e9f1f8";
      g.fillText(fmtVal(last), 8, y0 + 32);

      // decimate to ~2 points per pixel column (min/max) so bounce stays visible
      g.strokeStyle = COLORS[c];
      g.lineWidth = 1.4;
      g.beginPath();
      // newest sample sits at the right edge; history fills leftwards
      const cols = Math.max(1, Math.floor(right - left));
      const empty = this.windowMs - n;
      let started = false;
      for (let px = 0; px < cols; px++) {
        const a = Math.floor((px * this.windowMs) / cols) - empty;
        const b = Math.max(a + 1, Math.floor(((px + 1) * this.windowMs) / cols) - empty);
        if (b <= 0) continue;
        let mn = Infinity, mx = -Infinity;
        for (let k = Math.max(0, a); k < b && k < n; k++) {
          const v = this.data[c][(this.head - n + k + CAP) % CAP];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (!isFinite(mn)) continue;
        const x = left + px;
        if (!started) { g.moveTo(x, ymap(mn)); started = true; }
        g.lineTo(x, ymap(mn));
        if (mx !== mn) g.lineTo(x, ymap(mx));
      }
      g.stroke();
    });
  }
}

function fmtTime(ms: number) {
  return ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
}
function fmtVal(v: number) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}
