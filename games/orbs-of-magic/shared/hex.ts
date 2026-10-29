// Board geometry. The battlefield is a "honeycomb" of 7 rows of pointy-top hexes.
// Even rows hold 8 cells, odd rows hold 9, which makes the board point-symmetric
// so both players get an identical view of it.
//
// Internally we use "doubled-width" coordinates for math: dc = 2*c + (even row ? 1 : 0).

export interface Hex { c: number; r: number }

export const ROWS = 7;
export const rowLen = (r: number) => (r % 2 === 0 ? 8 : 9);

export const key = (h: Hex) => `${h.c},${h.r}`;
export const fromKey = (k: string): Hex => { const [c, r] = k.split(',').map(Number); return { c, r }; };
export const same = (a: Hex, b: Hex) => a.c === b.c && a.r === b.r;

export function inBounds(h: Hex) {
  return h.r >= 0 && h.r < ROWS && h.c >= 0 && h.c < rowLen(h.r);
}

const dcol = (h: Hex) => 2 * h.c + (h.r % 2 === 0 ? 1 : 0);
const fromD = (dc: number, r: number): Hex => ({ c: (dc - (r % 2 === 0 ? 1 : 0)) / 2, r });

export function dist(a: Hex, b: Hex) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(dcol(a) - dcol(b));
  return dr + Math.max(0, (dc - dr) / 2);
}

const DIRS: [number, number][] = [[2, 0], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
export function neighbors(h: Hex): Hex[] {
  const d = dcol(h);
  const out: Hex[] = [];
  for (const [ddc, dr] of DIRS) {
    const n = fromD(d + ddc, h.r + dr);
    if (inBounds(n)) out.push(n);
  }
  return out;
}

export const ALL_HEXES: Hex[] = (() => {
  const out: Hex[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < rowLen(r); c++) out.push({ c, r });
  return out;
})();

/** World-space position (x, z) of the hex centre. Board centred at origin, player 0 at +z (near camera). */
export const HEX_SIZE = 1; // centre-to-corner
export function toWorld(h: Hex): { x: number; z: number } {
  const w = Math.sqrt(3) * HEX_SIZE;
  const x = (dcol(h) / 2 - 4) * w;
  const z = (3 - h.r) * 1.5 * HEX_SIZE;
  return { x, z };
}

/** Player 0 deploys on rows 0-1, player 1 on rows 5-6. */
export const deployRows = (p: number) => (p === 0 ? [0, 1] : [5, 6]);
export const backRow = (p: number) => (p === 0 ? 0 : ROWS - 1);
export const enemyBackRow = (p: number) => backRow(1 - p);
/** Units standing in the enemy's deployment zone ("enemy territory") can attack the enemy Sanctum. */
export const inEnemyTerritory = (p: number, h: Hex) => deployRows(1 - p).includes(h.r);
/** Ranged units can attack the enemy Sanctum from anywhere in enemy territory; melee units only from its back row. */
export const canHitSanctum = (p: number, range: number, h: Hex) => (range > 1 ? inEnemyTerritory(p, h) : h.r === enemyBackRow(p));
/** Rows that count as "your half" (for Infiltrate etc). */
export const ownHalfRows = (p: number) => (p === 0 ? [0, 1, 2, 3] : [3, 4, 5, 6]);

/** The three Ley Orbs sit on the centre row. */
export const LEY_ORBS: Hex[] = [{ c: 1, r: 3 }, { c: 4, r: 3 }, { c: 7, r: 3 }];
export const isOrb = (h: Hex) => LEY_ORBS.some((o) => same(o, h));
