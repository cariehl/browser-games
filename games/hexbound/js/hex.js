// Hex math: pointy-top axial coordinates (q, r). Shared global namespace G.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const SQ3 = Math.sqrt(3);

  const Hex = {
    DIRS,
    key: (q, r) => q + ',' + r,
    hk: (h) => h.q + ',' + h.r,
    parse: (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; },
    eq: (a, b) => a.q === b.q && a.r === b.r,
    add: (a, b) => ({ q: a.q + b.q, r: a.r + b.r }),
    sub: (a, b) => ({ q: a.q - b.q, r: a.r - b.r }),
    neighbor: (h, d) => ({ q: h.q + DIRS[d][0], r: h.r + DIRS[d][1] }),
    neighbors: (h) => DIRS.map(d => ({ q: h.q + d[0], r: h.r + d[1] })),
    dist: (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2,
    fromOffset: (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row }),
    toPixel: (h, size = 1) => ({ x: size * SQ3 * (h.q + h.r / 2), z: size * 1.5 * h.r }),
    // direction index from a to b (nearest of the six)
    dirTo(a, b) {
      const pa = Hex.toPixel(a), pb = Hex.toPixel(b);
      const ang = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
      let best = 0, bd = 1e9;
      for (let i = 0; i < 6; i++) {
        const p = Hex.toPixel({ q: DIRS[i][0], r: DIRS[i][1] });
        const a2 = Math.atan2(-p.z, p.x);
        let d = Math.abs(ang - a2); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    angleBetween(origin, a, b) { // angle at origin between a and b in radians
      const o = Hex.toPixel(origin), pa = Hex.toPixel(a), pb = Hex.toPixel(b);
      const v1 = [pa.x - o.x, pa.z - o.z], v2 = [pb.x - o.x, pb.z - o.z];
      const d = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      return Math.acos(Math.max(-1, Math.min(1, d)));
    },
    round(fq, fr) {
      const fs = -fq - fr;
      let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
      const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
      if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
      return { q, r };
    },
    // side = +1 / -1 picks which way to break ties when the line runs exactly along a hex edge
    line(a, b, side = 1) {
      const n = Hex.dist(a, b); const out = [];
      for (let i = 0; i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        out.push(Hex.round(a.q + (b.q - a.q) * t + side * 1e-6, a.r + (b.r - a.r) * t + side * 2e-6));
      }
      return out;
    },
    within(c, n) {
      const out = [];
      for (let dq = -n; dq <= n; dq++)
        for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) out.push({ q: c.q + dq, r: c.r + dr });
      return out;
    },
    // a hex "blast" (cone) of size n from origin toward a target hex: hexes within n inside a 60deg wedge
    blast(origin, toward, n) {
      const out = [];
      for (const h of Hex.within(origin, n)) {
        if (Hex.eq(h, origin)) continue;
        if (Hex.angleBetween(origin, toward, h) <= Math.PI / 6 + 0.32) out.push(h);
      }
      return out;
    },
  };
  G.Hex = Hex;
})();
if (typeof module !== 'undefined') module.exports = G;
