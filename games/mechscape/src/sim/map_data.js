// A map parsed from a .map text file (data/maps/): a legend that maps
// characters to content ids, and an ASCII grid with one character per tile.
// See data/maps/scrapyard.map and README.md (Maps) for the format.
//
// Optional extras, all drawn from the same file:
//   [height]  a second grid of ground levels: 0-9 flat, a-i ramps between
//             one level and the next (a joins 0 and 1). See Grid.
//   [ground]  a grid of ground types (dirt, plate, sand...), by legend
//             entries of kind "ground"; "ground: <id>" in the header sets the
//             default.
//   decor     a legend kind: props that block nothing and aren't sim
//             objects (scrap piles, lamps, cables). Floor underneath.
//   zone      header lines "zone <id>: x1,y1 x2,y2" mark a rectangle
//             (inclusive) as a zone: safe, build, mech, arena...
//
// Parsing only reads the text and resolves ids; World.loadMap() places
// things. Placement order is fixed (terrain, then objects, then NPCs, each
// row by row), so the same map always gets the same object and NPC ids.
//
// A world can be several maps (areas) placed side by side in one coordinate
// space: a layout file (data/maps/world.json) lists them. See World.

import { Content } from './defs.js';

export const MapKind = {
  FLOOR: 'floor', SPAWN: 'spawn', TERRAIN: 'terrain', NODE: 'node', STATION: 'station', NPC: 'npc',
  DECOR: 'decor', GROUND: 'ground',
};
const KINDS = Object.values(MapKind);
const FOLDERS = {
  terrain: 'data/terrain', node: 'data/nodes', station: 'data/stations', npc: 'data/npcs', decor: 'data/decor', ground: 'data/ground',
};
const SECTIONS = ['legend', 'grid', 'height', 'ground'];
/** Height characters: digits are flat levels, a-i ramps between level n and n + 1. */
function heightOf(ch) {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'a' && ch <= 'i') return ch.charCodeAt(0) - 97 + 0.5;
  return NaN;
}

/** Map text by path, registered before Worlds are built (fetched or read from disk). */
const sources = {};
/** Parsed maps by path, so building many Worlds reads each once. */
const cache = {};

export class MapData {
  constructor() {
    this.name = '';
    this.path = '';
    this.size = { x: 0, y: 0 };
    /** The spawn tile, or null if this map has none (an area of a bigger world). */
    this.spawn = null;
    /** The grid rows as written. */
    this.rows = [];
    /** Each: { kind, def, tile }, in placement order. */
    this.placements = [];
    /** Each: { def, tile }. Drawn only. */
    this.decor = [];
    /** Ground level per tile, row by row. */
    this.heights = null;
    /** Ground def per tile (null for the default), row by row. */
    this.ground = null;
    /** The default ground def, or null. */
    this.defaultGround = null;
    /** Each: { id, from, to } (inclusive rectangles). */
    this.zones = [];
    /** Problems found while parsing. A map with any errors isn't used. */
    this.errors = [];
    this._spawnless = false;
  }

  /** Makes a map's (or a layout's) text available under [path] for loadFile(). */
  static register(path, text) {
    sources[path] = text;
    delete cache[path];
  }

  static has(path) {
    return path in sources;
  }

  /** The raw text registered at [path] (layout files), or null. */
  static source(path) {
    return path in sources ? sources[path] : null;
  }

  /** The parsed map registered at [path], or null (after logging why). */
  static loadFile(path) {
    if (cache[path]) return cache[path];
    if (!(path in sources)) {
      console.error(`Map file not found: ${path}`);
      return null;
    }
    const map = MapData.parse(sources[path], path);
    if (map.errors.length) {
      for (const line of map.errors) console.error(line);
      return null;
    }
    cache[path] = map;
    return map;
  }

  /** Parses map text. Always returns a MapData; check errors. */
  static parse(text, source = '<map>') {
    const map = new MapData();
    map.path = source;
    const legend = {};
    const grids = { grid: [], height: [], ground: [] };
    let section = '';
    let lineNumber = 0;
    for (const raw of text.split('\n')) {
      lineNumber++;
      const line = raw.replace(/\s+$/, '');
      if (line.trim() === '' || line.trim().startsWith('//')) continue;
      const where = `${source}:${lineNumber}: `;
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1).trim().toLowerCase();
        if (!SECTIONS.includes(section)) map.errors.push(where + `unknown section [${section}].`);
        continue;
      }
      if (section === '') map._parseHeader(line, where);
      else if (section === 'legend') map._parseLegend(line, where, legend);
      else if (section in grids) {
        if (line !== line.trim()) map.errors.push(where + "grid rows can't have spaces at the ends.");
        grids[section].push({ row: line.trim(), where });
      }
    }
    map.rows = grids.grid.map((r) => r.row);
    map._build(legend, source);
    if (map.rows.length) {
      map._buildHeights(grids.height, source);
      map._buildGround(grids.ground, legend, source);
    }
    return map;
  }

  _parseHeader(line, where) {
    const colon = line.indexOf(':');
    if (colon < 0) {
      this.errors.push(where + 'expected "key: value" before the first section.');
      return;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'name') {
      this.name = value;
    } else if (key === 'spawn' && value === 'none') {
      this._spawnless = true;
    } else if (key === 'ground') {
      this.defaultGround = Content.forMapKind('ground', value);
      if (!this.defaultGround) this.errors.push(where + `no ground with id "${value}" in data/ground.`);
    } else if (key.startsWith('zone ')) {
      const id = key.slice(5).trim();
      const m = value.match(/^(\d+)\s*,\s*(\d+)\s+(\d+)\s*,\s*(\d+)$/);
      if (!/^[a-z][a-z0-9_]*$/.test(id) || !m) {
        this.errors.push(where + 'zones look like "zone safe: 10,4 20,12".');
        return;
      }
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      this.zones.push({ id, from: { x: Math.min(x1, x2), y: Math.min(y1, y2) }, to: { x: Math.max(x1, x2), y: Math.max(y1, y2) } });
    } else {
      this.errors.push(where + `unknown setting "${key}".`);
    }
  }

  _parseLegend(line, where, legend) {
    const symbol = line[0];
    const words = line.slice(1).trim().split(/\s+/).filter(Boolean);
    if (symbol === ' ' || words.length === 0) {
      this.errors.push(where + 'legend lines look like "d  node crashed_drone".');
      return;
    }
    if (symbol in legend) {
      this.errors.push(where + `'${symbol}' is already in the legend.`);
      return;
    }
    const kind = words[0].toLowerCase();
    if (!KINDS.includes(kind)) {
      this.errors.push(where + `unknown kind "${kind}" (use one of ${KINDS.join(', ')}).`);
      return;
    }
    let def = null;
    if (kind === MapKind.FLOOR || kind === MapKind.SPAWN) {
      if (words.length !== 1) {
        this.errors.push(where + `"${kind}" takes no id.`);
        return;
      }
    } else {
      if (words.length !== 2) {
        this.errors.push(where + `"${kind}" needs exactly one id, e.g. "${kind} some_id".`);
        return;
      }
      def = Content.forMapKind(kind, words[1]);
      if (!def) {
        this.errors.push(where + `no ${kind} with id "${words[1]}" in ${FOLDERS[kind]}.`);
        return;
      }
    }
    legend[symbol] = { kind, def };
  }

  _build(legend, source) {
    if (this.rows.length === 0) {
      this.errors.push(source + ': the map has no [grid].');
      return;
    }
    this.size = { x: this.rows[0].length, y: this.rows.length };
    const terrain = [];
    const objects = [];
    const npcs = [];
    let spawns = 0;
    for (let y = 0; y < this.rows.length; y++) {
      const row = this.rows[y];
      if (row.length !== this.size.x) {
        this.errors.push(`${source}: grid row ${y} is ${row.length} wide; the first row is ${this.size.x}.`);
        continue;
      }
      for (let x = 0; x < row.length; x++) {
        const symbol = row[x];
        const entry = legend[symbol];
        if (!entry || entry.kind === MapKind.GROUND) {
          this.errors.push(`${source}: grid row ${y} has '${symbol}' at x = ${x}, which isn't in the legend${entry ? ' as a tile' : ''}.`);
          continue;
        }
        const placement = { kind: entry.kind, def: entry.def, tile: { x, y } };
        switch (entry.kind) {
          case MapKind.SPAWN: this.spawn = { x, y }; spawns++; break;
          case MapKind.TERRAIN: terrain.push(placement); break;
          case MapKind.NODE: case MapKind.STATION: objects.push(placement); break;
          case MapKind.NPC: npcs.push(placement); break;
          case MapKind.DECOR: this.decor.push({ def: entry.def, tile: { x, y } }); break;
        }
      }
    }
    if (this._spawnless ? spawns !== 0 : spawns !== 1) {
      this.errors.push(`${source}: the grid needs ${this._spawnless ? 'no spawn tile ("spawn: none")' : 'exactly one spawn tile'} (found ${spawns}).`);
    }
    for (const zone of this.zones) {
      if (zone.to.x >= this.size.x || zone.to.y >= this.size.y) this.errors.push(`${source}: zone ${zone.id} runs off the map.`);
    }
    this.placements = [...terrain, ...objects, ...npcs];
  }

  _buildHeights(rows, source) {
    const { x: w, y: h } = this.size;
    this.heights = new Float32Array(w * h);
    if (rows.length === 0) return;
    if (rows.length !== h) this.errors.push(`${source}: [height] has ${rows.length} rows; the grid has ${h}.`);
    rows.forEach(({ row, where }, y) => {
      if (y >= h) return;
      if (row.length !== w) {
        this.errors.push(where + `[height] row ${y} is ${row.length} wide; the grid is ${w}.`);
        return;
      }
      for (let x = 0; x < w; x++) {
        const v = heightOf(row[x]);
        if (Number.isNaN(v)) this.errors.push(where + `'${row[x]}' isn't a height (use 0-9, or a-i for ramps).`);
        else this.heights[y * w + x] = v;
      }
    });
  }

  _buildGround(rows, legend, source) {
    const { x: w, y: h } = this.size;
    this.ground = new Array(w * h).fill(null);
    if (rows.length === 0) return;
    if (rows.length !== h) this.errors.push(`${source}: [ground] has ${rows.length} rows; the grid has ${h}.`);
    rows.forEach(({ row, where }, y) => {
      if (y >= h) return;
      if (row.length !== w) {
        this.errors.push(where + `[ground] row ${y} is ${row.length} wide; the grid is ${w}.`);
        return;
      }
      for (let x = 0; x < w; x++) {
        if (row[x] === '.') continue;
        const entry = legend[row[x]];
        if (!entry || entry.kind !== MapKind.GROUND) this.errors.push(where + `'${row[x]}' in [ground] isn't a ground in the legend.`);
        else this.ground[y * w + x] = entry.def;
      }
    });
  }

  ofKind(kind) {
    return this.placements.filter((p) => p.kind === kind);
  }
}

/**
 * A world layout: which maps make up the world and where each sits.
 * { name, areas: [{ id, name, map, at: [x, y], dark, zones }], links: [{ from: [area, x, y], to: [area, x, y], text }] }
 * Returns null (after logging why) if it can't be read.
 */
export function loadLayout(path) {
  const text = MapData.source(path);
  if (text == null) {
    console.error(`Layout file not found: ${path}`);
    return null;
  }
  try {
    const layout = JSON.parse(text);
    if (!Array.isArray(layout.areas) || layout.areas.length === 0) throw new Error('no areas');
    return layout;
  } catch (error) {
    console.error(`${path}: ${error.message}`);
    return null;
  }
}
