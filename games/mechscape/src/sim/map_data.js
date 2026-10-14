// A map parsed from a .map text file (data/maps/): a legend that maps
// characters to content ids, and an ASCII grid with one character per tile.
// See data/maps/scrapyard.map and README.md (Maps) for the format.
//
// Parsing only reads the text and resolves ids; World.loadMap() places
// things. Placement order is fixed (terrain, then objects, then NPCs, each
// row by row), so the same map always gets the same object and NPC ids.

import { Content } from './defs.js';

export const MapKind = {
  FLOOR: 'floor', SPAWN: 'spawn', TERRAIN: 'terrain', NODE: 'node', STATION: 'station', NPC: 'npc',
};
const KINDS = Object.values(MapKind);
const FOLDERS = { terrain: 'data/terrain', node: 'data/nodes', station: 'data/stations', npc: 'data/npcs' };

/** Map text by path, registered before Worlds are built (fetched or read from disk). */
const sources = {};
/** Parsed maps by path, so building many Worlds reads each once. */
const cache = {};

export class MapData {
  constructor() {
    this.name = '';
    this.path = '';
    this.size = { x: 0, y: 0 };
    this.spawn = { x: 0, y: 0 };
    /** The grid rows as written. */
    this.rows = [];
    /** Each: { kind, def, tile }, in placement order. */
    this.placements = [];
    /** Problems found while parsing. A map with any errors isn't used. */
    this.errors = [];
  }

  /** Makes a map's text available under [path] for loadFile(). */
  static register(path, text) {
    sources[path] = text;
    delete cache[path];
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
    let section = '';
    let lineNumber = 0;
    for (const raw of text.split('\n')) {
      lineNumber++;
      const line = raw.replace(/\s+$/, '');
      if (line.trim() === '' || line.trim().startsWith('//')) continue;
      const where = `${source}:${lineNumber}: `;
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1).trim().toLowerCase();
        if (section !== 'legend' && section !== 'grid') map.errors.push(where + `unknown section [${section}].`);
        continue;
      }
      if (section === '') map._parseHeader(line, where);
      else if (section === 'legend') map._parseLegend(line, where, legend);
      else if (section === 'grid') {
        if (line !== line.trim()) map.errors.push(where + "grid rows can't have spaces at the ends.");
        map.rows.push(line.trim());
      }
    }
    map._build(legend, source);
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
    if (key === 'name') this.name = value;
    else this.errors.push(where + `unknown setting "${key}".`);
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
        if (!entry) {
          this.errors.push(`${source}: grid row ${y} has '${symbol}' at x = ${x}, which isn't in the legend.`);
          continue;
        }
        const placement = { kind: entry.kind, def: entry.def, tile: { x, y } };
        switch (entry.kind) {
          case MapKind.SPAWN: this.spawn = { x, y }; spawns++; break;
          case MapKind.TERRAIN: terrain.push(placement); break;
          case MapKind.NODE: case MapKind.STATION: objects.push(placement); break;
          case MapKind.NPC: npcs.push(placement); break;
        }
      }
    }
    if (spawns !== 1) this.errors.push(`${source}: the grid needs exactly one spawn tile (found ${spawns}).`);
    this.placements = [...terrain, ...objects, ...npcs];
  }

  ofKind(kind) {
    return this.placements.filter((p) => p.kind === kind);
  }
}
