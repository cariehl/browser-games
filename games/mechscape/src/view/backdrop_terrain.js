// The land beyond the areas' edges, worked out as plain numbers (no
// three.js, so tests can check it): a region's heights at every tile corner,
// its ground colours, where its scattered and placed props stand, and where
// its fences run. backdrop_view.js draws it.
//
// A region (data/scenery.json "regions") is one or more areas and the land
// around them, out to [margin] tiles. Nothing out there is walkable: the sim
// never sees it. Next to each area the land starts at that area's edge
// height and colour, so the seam doesn't show, then settles over the area's
// falloff towards the region's base level, with noise and hills rising out
// of it once it's a few tiles clear. Where two areas share a region (the
// Commons below, the Quiet Reach on its hilltop) the land between them is a
// blend of the two, which makes the cliff between. Out at the margin the
// land sinks to the floor level, where the endless floor (see
// environment.js) takes over under the fog.
//
// Coordinates in a region's data are tiles from its first area's top-left
// corner. Here they're world tiles (x, y), corners on whole numbers.

import { Content } from '../sim/defs.js';

/** The floor sits this far below a region's base level, so the land always covers it. */
const FLOOR_DROP = 0.6;
/** The land sinks to the floor over this many tiles at the margin. */
const RIM = 16;
const DEFAULT_GROUND = [0.36, 0.40, 0.33];
const ROCK = [0.38, 0.35, 0.32];

export const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => mix(a[i], b[i], t));

/** A small seeded random generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo, hi) => lo + next() * (hi - lo) };
}

function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, two octaves. */
export function noise(x, y, seed = 0) {
  let total = 0;
  let weight = 0;
  for (const [f, w] of [[1, 1], [2.1, 0.45]]) {
    const px = x * f;
    const py = y * f;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const tx = px - ix;
    const ty = py - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const s = seed + f * 101;
    const top = mix(hash(ix, iy, s), hash(ix + 1, iy, s), sx);
    const bottom = mix(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), sx);
    total += mix(top, bottom, sy) * w;
    weight += w;
  }
  return total / weight;
}

function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class BackdropRegion {
  /**
   * [world]: the World whose areas it surrounds. [id] and [data]: a region
   * from data/scenery.json. [levelHeight]: metres per ground level.
   */
  constructor(world, id, data, levelHeight) {
    this.id = id;
    this.data = data;
    this.L = levelHeight;
    this.world = world;
    this.areas = data.areas.map((areaId) => {
      const area = world.areas.find((a) => a.id === areaId);
      if (!area) throw new Error(`scenery region ${id}: no area "${areaId}" in the world.`);
      const falloff = (data.falloff && data.falloff[areaId]) || 10;
      return { area, falloff, x0: area.offset.x, y0: area.offset.y, x1: area.offset.x + area.size.x, y1: area.offset.y + area.size.y };
    });
    this.origin = { ...this.areas[0].area.offset };
    this.margin = data.margin || 80;
    this.base = (data.base_level || 0) * levelHeight;
    // The endless floor sits under the lowest ground anywhere in the region.
    let lowest = this.base;
    for (const { area } of this.areas) {
      for (let y = area.offset.y; y < area.offset.y + area.size.y; y++) {
        for (let x = area.offset.x; x < area.offset.x + area.size.x; x++) lowest = Math.min(lowest, world.heightAt({ x, y }) * levelHeight);
      }
    }
    /** Where the endless floor sits under this region (metres). */
    this.floorY = lowest - FLOOR_DROP;
    this.seed = seedOf(id);
    this.x0 = Math.min(...this.areas.map((a) => a.x0)) - this.margin;
    this.y0 = Math.min(...this.areas.map((a) => a.y0)) - this.margin;
    this.w = Math.max(...this.areas.map((a) => a.x1)) + this.margin - this.x0;
    this.h = Math.max(...this.areas.map((a) => a.y1)) + this.margin - this.y0;
    this._clear = (data.clear || []).map((r) => this._rect(r));
    this._buildHeights();
  }

  /** A [x1, y1, x2, y2] rectangle of tiles (inclusive, region coordinates) in world tiles. */
  _rect([x1, y1, x2, y2]) {
    const o = this.origin;
    return { x0: o.x + Math.min(x1, x2), y0: o.y + Math.min(y1, y2), x1: o.x + Math.max(x1, x2) + 1, y1: o.y + Math.max(y1, y2) + 1 };
  }

  /** Index of corner (cx, cy) in the height grid. */
  corner(cx, cy) {
    return (cy - this.y0) * (this.w + 1) + (cx - this.x0);
  }

  /** Distance from a point to an area's rectangle (0 on or inside it). */
  static distance(a, px, py) {
    const dx = Math.max(a.x0 - px, 0, px - a.x1);
    const dy = Math.max(a.y0 - py, 0, py - a.y1);
    return Math.hypot(dx, dy);
  }

  /** The area tile nearest a point. */
  static nearestTile(a, px, py) {
    return {
      x: Math.min(Math.max(Math.round(px - 0.5), a.x0), a.x1 - 1),
      y: Math.min(Math.max(Math.round(py - 0.5), a.y0), a.y1 - 1),
    };
  }

  /** Distance from a point to the nearest of this region's areas (or to the one with [areaId]). */
  distance(px, py, areaId = null) {
    let best = Infinity;
    for (const a of this.areas) if (!areaId || a.area.id === areaId) best = Math.min(best, BackdropRegion.distance(a, px, py));
    return best;
  }

  /** The land's height (metres) at corner (cx, cy), before it's stored. */
  _cornerHeight(cx, cy) {
    let sum = 0;
    let weights = 0;
    let dmin = Infinity;
    for (const [i, a] of this.areas.entries()) {
      const d = BackdropRegion.distance(a, cx, cy);
      const edge = this.world.heightAt(BackdropRegion.nearestTile(a, cx, cy)) * this.L;
      // On an area's edge: exactly its height, so the seam is closed.
      if (d === 0) return edge;
      dmin = Math.min(dmin, d);
      // Where two areas meet, a little noise in who's nearer makes the cliff between them wander.
      const dw = d * (0.65 + 0.7 * noise(cx / 5, cy / 5, this.seed + 31 + i));
      const w = 1 / (dw * dw * dw);
      sum += w * mix(edge, this.base, smoothstep(0, a.falloff, d));
      weights += w;
    }
    let h = sum / weights;
    // Bumps: noise and hills, only once the land is clear of the edges.
    const noiseData = this.data.noise || {};
    const scale = noiseData.scale || 16;
    let bumps = noise(cx / scale, cy / scale, this.seed) * (noiseData.levels ?? 2) * this.L;
    for (const hill of this.data.hills || []) {
      const d = Math.hypot(cx - (this.origin.x + hill.at[0]), cy - (this.origin.y + hill.at[1]));
      if (d >= hill.radius) continue;
      bumps += hill.levels * this.L * 0.5 * (1 + Math.cos(Math.PI * d / hill.radius));
    }
    h += smoothstep(1, 8, dmin) * bumps;
    // Down to the floor at the margin.
    return mix(h, this.floorY, smoothstep(this.margin - RIM, this.margin - 2, dmin));
  }

  _buildHeights() {
    const n = (this.w + 1) * (this.h + 1);
    this.heights = new Float32Array(n);
    for (let cy = this.y0; cy <= this.y0 + this.h; cy++) {
      for (let cx = this.x0; cx <= this.x0 + this.w; cx++) this.heights[this.corner(cx, cy)] = this._cornerHeight(cx, cy);
    }
  }

  /** Height (metres) of the land at a point, between its corners. */
  heightAt(px, py) {
    const fx = Math.min(Math.max(px, this.x0), this.x0 + this.w - 1e-6);
    const fy = Math.min(Math.max(py, this.y0), this.y0 + this.h - 1e-6);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const H = this.heights;
    const top = mix(H[this.corner(ix, iy)], H[this.corner(ix + 1, iy)], tx);
    const bottom = mix(H[this.corner(ix, iy + 1)], H[this.corner(ix + 1, iy + 1)], tx);
    return mix(top, bottom, ty);
  }

  /** How steep the land is around corner (cx, cy): the biggest rise per tile to a neighbour. */
  slopeAt(cx, cy) {
    const h = this.heights[this.corner(cx, cy)];
    let most = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < this.x0 || ny < this.y0 || nx > this.x0 + this.w || ny > this.y0 + this.h) continue;
      most = Math.max(most, Math.abs(this.heights[this.corner(nx, ny)] - h));
    }
    return most;
  }

  /**
   * How far corner (cx, cy) is pushed sideways ([dx, dy] tiles), so cliffs
   * look broken rather than ruled. Only steep corners clear of every area's
   * edge move; the seam never does.
   */
  offsetAt(cx, cy) {
    const steep = smoothstep(1, 2.5, this.slopeAt(cx, cy));
    if (steep === 0 || this.distance(cx, cy) < 0.75) return [0, 0];
    const k = 0.38 * steep;
    return [(hash(cx, cy, this.seed + 11) - 0.5) * 2 * k, (hash(cx, cy, this.seed + 13) - 0.5) * 2 * k];
  }

  /** Whether tile (x, y) belongs to an area of the world (drawn by the area, not here). */
  inArea(x, y) {
    return this.world.areaIdAt({ x, y }) >= 0;
  }

  _cleared(px, py) {
    return this._clear.some((r) => px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1);
  }

  /** The colour ([r, g, b], sRGB) of the land at corner (cx, cy). */
  colorAt(cx, cy) {
    const ground = this.data.ground || {};
    const far = groundColor(ground.color);
    let rgb = far;
    if (ground.patch) {
      const scale = ground.patch_scale || 18;
      const amount = ground.patch_amount ?? 0.5;
      const n = noise(cx / scale, cy / scale, this.seed + 7);
      rgb = mixRgb(far, groundColor(ground.patch), smoothstep(1 - amount - 0.08, 1 - amount + 0.08, n));
    }
    // Next to an area: its own ground, so the seam doesn't show.
    let dmin = Infinity;
    let nearest = null;
    for (const a of this.areas) {
      const d = BackdropRegion.distance(a, cx, cy);
      if (d < dmin) {
        dmin = d;
        nearest = a;
      }
    }
    const tile = BackdropRegion.nearestTile(nearest, cx, cy);
    const def = this.world.groundAt(tile) || nearest.area.ground;
    const edge = def ? def.color : DEFAULT_GROUND;
    rgb = mixRgb(edge, rgb, smoothstep(0.5, ground.edge_blend || 5, dmin));
    // Steep ground is bare rock, in bands like layered stone.
    const h = this.heights[this.corner(cx, cy)];
    const band = 1 + 0.1 * Math.sin(h * 2.3) + 0.05 * Math.sin(h * 5.1 + cx * 0.3);
    rgb = mixRgb(rgb, (ground.rock || ROCK).map((c) => c * band), smoothstep(0.55, 1.1, this.slopeAt(cx, cy)));
    const shade = 1 + (hash(cx, cy, this.seed + 3) - 0.5) * 0.1;
    return rgb.map((c) => c * shade);
  }

  /**
   * Every prop out here: { decor, x, y, height, turn, scale }, x and y in
   * world tiles (continuous), height in metres. Scattered by the region's
   * "scatter" rules, then its hand-placed "props".
   */
  props() {
    const out = [];
    (this.data.scatter || []).forEach((rule, i) => {
      const r = rng(this.seed + i * 7919);
      const every = rule.every || 4;
      const from = rule.from ?? 1;
      const to = rule.to ?? this.margin - RIM;
      const maxSlope = rule.max_slope ?? 1.2;
      const [s0, s1] = rule.scale || [1, 1];
      for (let gy = this.y0; gy < this.y0 + this.h; gy += every) {
        for (let gx = this.x0; gx < this.x0 + this.w; gx += every) {
          // Every cell draws the same numbers whether it's kept or not, so one rule's change doesn't move another's.
          const roll = r.next();
          const px = gx + r.next() * every;
          const py = gy + r.next() * every;
          const turn = r.next() * Math.PI * 2;
          const scale = mix(s0, s1, r.next());
          if (roll >= (rule.chance ?? 1)) continue;
          if (this.inArea(Math.floor(px), Math.floor(py)) || this._cleared(px, py)) continue;
          const d = this.distance(px, py, rule.area || null);
          if (d < from || d > to || this.distance(px, py) < Math.min(from, 1)) continue;
          if (this.slopeAt(Math.round(px), Math.round(py)) > maxSlope) continue;
          out.push({ decor: rule.decor, x: px, y: py, height: this.heightAt(px, py), turn, scale });
        }
      }
    });
    for (const prop of this.data.props || []) {
      const px = this.origin.x + prop.at[0];
      const py = this.origin.y + prop.at[1];
      out.push({
        decor: prop.decor, x: px, y: py, height: this.heightAt(px, py) - (prop.sink || 0),
        turn: ((prop.turn || 0) * Math.PI) / 180, scale: prop.scale || 1,
      });
    }
    return out;
  }

  /**
   * The fences round areas: { style, posts: [{ x, y, height }], panels: [{ a, b }] }
   * per fence, each panel joining two posts (indices). A fence runs [offset]
   * tiles outside its area's edge, with a post every [spacing] tiles, and
   * leaves out panels whose middle is in one of its "gaps".
   */
  fences() {
    return (this.data.fences || []).map((spec) => {
      const a = this.areas.find((e) => e.area.id === spec.area);
      if (!a) throw new Error(`scenery region ${this.id}: fence round "${spec.area}", which isn't one of its areas.`);
      const off = spec.offset ?? 0.4;
      const spacing = spec.spacing || 2;
      const gaps = (spec.gaps || []).map((g) => this._rect(g));
      const x0 = a.x0 - off;
      const y0 = a.y0 - off;
      const x1 = a.x1 + off;
      const y1 = a.y1 + off;
      // Round the rectangle clockwise from the top-left corner.
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const points = [];
      corners.forEach(([ax, ay], i) => {
        const [bx, by] = corners[(i + 1) % 4];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.round(length / spacing));
        for (let s = 0; s < steps; s++) points.push([mix(ax, bx, s / steps), mix(ay, by, s / steps)]);
      });
      const posts = points.map(([x, y]) => ({ x, y, height: this.heightAt(x, y) }));
      const panels = [];
      posts.forEach((p, i) => {
        const q = posts[(i + 1) % posts.length];
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        if (gaps.some((g) => mx >= g.x0 - off && mx <= g.x1 + off && my >= g.y0 - off && my <= g.y1 + off)) return;
        panels.push({ a: i, b: (i + 1) % posts.length });
      });
      return { style: spec, posts, panels };
    });
  }
}

/** A ground def's colour by id (from data/ground.json), or the default. */
export function groundColor(id) {
  const def = id && Content.ground[id];
  return def ? def.color.slice(0, 3) : DEFAULT_GROUND;
}

/** Every region of data/scenery.json for [world], built. Areas that aren't in the world are skipped with a warning. */
export function buildRegions(world, scenery, levelHeight) {
  const out = [];
  for (const [id, data] of Object.entries((scenery && scenery.regions) || {})) {
    if (!data.areas.every((a) => world.areas.some((area) => area.id === a))) {
      console.warn(`scenery region ${id}: not all of its areas are in this world; skipped.`);
      continue;
    }
    out.push(new BackdropRegion(world, id, data, levelHeight));
  }
  return out;
}
