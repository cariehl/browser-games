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

export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.solid = new Uint8Array(width * height);
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

  _open(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.solid[y * this.width + x] === 0;
  }

  /**
   * Tiles from [from] to [to], both included, or [] if [to] can't be reached
   * (or is solid).
   */
  findPath(from, to) {
    const w = this.width;
    if (!this.inBounds(from) || !this.inBounds(to) || this.isSolid(to)) return [];
    const start = from.y * w + from.x;
    const goal = to.y * w + to.x;
    if (start === goal) return [{ x: from.x, y: from.y }];
    const n = w * this.height;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (i) => {
      const dx = Math.abs((i % w) - to.x);
      const dy = Math.abs(Math.floor(i / w) - to.y);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this._open(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!this._open(cx + dx, cy) || !this._open(cx, cy + dy))) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const cost = g[cur] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (cost < g[ni] - 1e-9) {
          g[ni] = cost;
          parent[ni] = cur;
          heap.push(ni, cost + h(ni));
        }
      }
    }
    if (parent[goal] === -1) return [];
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
