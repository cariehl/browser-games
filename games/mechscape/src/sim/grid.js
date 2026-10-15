// Tiles, and the walkability grid with A* pathfinding.
//
// Movement rules match the Godot build (AStarGrid2D with
// DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES and the octile heuristic): eight
// directions, but a diagonal step never squeezes past a blocked corner, like
// OSRS.

export const NO_TARGET = Object.freeze({ x: -1, y: -1 });

export const tile = (x, y) => ({ x, y });
export const eq = (a, b) => a.x === b.x && a.y === b.y;
export const key = (t) => `${t.x},${t.y}`;
export const fromKey = (k) => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
/** Chebyshev distance: king moves. */
export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const UP = tile(0, -1);
export const DOWN = tile(0, 1);
export const LEFT = tile(-1, 0);
export const RIGHT = tile(1, 0);

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Two tiles whose heights differ by more than this have a cliff between them. */
export const MAX_STEP = 0.5;

export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.solid = new Uint8Array(width * height);
    /**
     * Ground height of every tile, in levels: 0, 1, 2... for flat ground and
     * halves (0.5, 1.5...) for ramps. Walking needs a step of at most
     * MAX_STEP, so a ramp joins two levels and anything steeper is a cliff.
     */
    this.heights = new Float32Array(width * height);
  }

  inBounds(t) {
    return t.x >= 0 && t.y >= 0 && t.x < this.width && t.y < this.height;
  }

  isSolid(t) {
    return this.solid[t.y * this.width + t.x] === 1;
  }

  setSolid(t, solid) {
    this.solid[t.y * this.width + t.x] = solid ? 1 : 0;
  }

  heightAt(t) {
    return this.inBounds(t) ? this.heights[t.y * this.width + t.x] : 0;
  }

  /** Whether a step between two touching tiles isn't up or down a cliff. */
  edgeOk(a, b) {
    return Math.abs(this.heightAt(a) - this.heightAt(b)) <= MAX_STEP;
  }

  _open(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.solid[y * this.width + x] === 0;
  }

  /**
   * Tiles from [from] to [to], both included, or [] if [to] can't be reached
   * (or is solid).
   *
   * [mask]: a Uint8Array over the grid; 1 makes a tile solid for this path
   * only (NPCs keep out of safe zones, a mech stays in its zone).
   * [size]: the mover's footprint, size × size tiles with [from] and [to] its
   * top-left corner. Every tile it covers must be open and on one level.
   */
  findPath(from, to, { mask = null, size = 1 } = {}) {
    const w = this.width;
    const hts = this.heights;
    const open = (x, y) => {
      if (x < 0 || y < 0 || x + size > w || y + size > this.height) return false;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const k = (y + j) * w + x + i;
          if (this.solid[k] === 1 || (mask && mask[k] === 1)) return false;
          if (hts[k] < lo) lo = hts[k];
          if (hts[k] > hi) hi = hts[k];
        }
      }
      return hi - lo <= MAX_STEP;
    };
    const level = (x, y) => (size === 1 ? hts[y * w + x] : hts[y * w + x + ((size - 1) >> 1) + ((size - 1) >> 1) * w]);
    const step = (ax, ay, bx, by) => Math.abs(level(ax, ay) - level(bx, by)) <= MAX_STEP;
    if (!this.inBounds(from) || !this.inBounds(to) || !open(to.x, to.y)) return [];
    const start = from.y * w + from.x;
    const goal = to.y * w + to.x;
    if (start === goal) return [{ x: from.x, y: from.y }];
    // Search buffers are kept between searches (the world is mostly void
    // between areas, so allocating them per search is costly); a tile's
    // entries count only when its stamp matches this search's.
    const n = w * this.height;
    if (!this._g || this._g.length !== n) {
      this._g = new Float64Array(n);
      this._parent = new Int32Array(n);
      this._seen = new Uint32Array(n);
      this._closed = new Uint32Array(n);
      this._search = 0;
    }
    const search = ++this._search;
    const g = this._g;
    const parent = this._parent;
    const seen = this._seen;
    const closed = this._closed;
    const heap = new MinHeap();
    const h = (i) => {
      const dx = Math.abs((i % w) - to.x);
      const dy = Math.abs(Math.floor(i / w) - to.y);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    g[start] = 0;
    parent[start] = -1;
    seen[start] = search;
    heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur] === search) continue;
      closed[cur] = search;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!open(nx, ny) || !step(cx, cy, nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          // No squeezing past a blocked corner, or round the top of a cliff.
          if (!open(cx + dx, cy) || !open(cx, cy + dy)) continue;
          if (!step(cx, cy, cx + dx, cy) || !step(cx + dx, cy, nx, ny) || !step(cx, cy, cx, cy + dy) || !step(cx, cy + dy, nx, ny)) continue;
        }
        const ni = ny * w + nx;
        if (closed[ni] === search) continue;
        const cost = g[cur] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (seen[ni] !== search || cost < g[ni] - 1e-9) {
          seen[ni] = search;
          g[ni] = cost;
          parent[ni] = cur;
          heap.push(ni, cost + h(ni));
        }
      }
    }
    if (seen[goal] !== search) return [];
    const path = [];
    for (let i = goal; i !== -1; i = parent[i]) {
      path.push({ x: i % w, y: Math.floor(i / w) });
      if (i === start) break;
    }
    return path.reverse();
  }
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, priority) {
    const items = this.items;
    const prio = this.prio;
    let i = items.length;
    items.push(item);
    prio.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prio[p] <= priority) break;
      items[i] = items[p];
      prio[i] = prio[p];
      i = p;
    }
    items[i] = item;
    prio[i] = priority;
  }

  pop() {
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prio.pop();
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && prio[c + 1] < prio[c]) c++;
        if (prio[c] >= lastPrio) break;
        items[i] = items[c];
        prio[i] = prio[c];
        i = c;
      }
      items[i] = lastItem;
      prio[i] = lastPrio;
    }
    return top;
  }
}
