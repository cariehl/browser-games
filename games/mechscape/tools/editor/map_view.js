// The map painter. Pick a map, a layer (things, height, ground, zones) and a
// brush, then paint, drag rectangles or flood-fill. Right-click picks up
// what's under the cursor. Every change goes straight into the .map text, so
// Save writes it; Ctrl+Z / Ctrl+Y undo and redo.

import { Store } from './store.js';
import { COLLECTIONS, LAYOUT, idsOf, nameOf } from './schema.js';
import { parseMap, writeMap, legendEntries } from './mapfile.js';
import { el, button, cssColor } from './ui.js';

const KIND_COLL = { terrain: 'terrain', node: 'nodes', station: 'stations', npc: 'npcs', decor: 'decor', ground: 'ground' };
const HEIGHTS = '0123456789abcdefghi'.split('');
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?!$~^<>{}()[]|/\\;:,\'"`-_'.split('');
const ZONE_COLORS = ['#e0a040', '#4f9fd8', '#6cc070', '#d95454', '#c86fd0', '#e0c040', '#5fd0c8'];

/** Open maps by path: { text, map, undo, redo }, kept while the page is open. */
const open = {};
const view = { path: null, layer: 'things', brush: null, tool: 'paint', zoom: 14, zone: 0, showGlyphs: true, showZones: true };

function areas() {
  return ((Store.data(LAYOUT) || {}).areas || []);
}

function mapPaths() {
  const listed = areas().map((a) => a.map);
  const rest = Store.paths().filter((p) => p.endsWith('.map') && !listed.includes(p));
  return [...listed, ...rest];
}

function doc(path) {
  const text = Store.text(path);
  if (!open[path] || open[path].text !== text) open[path] = { text, map: parseMap(text), undo: [], redo: [] };
  return open[path];
}

function defOf(kind, id) {
  const coll = KIND_COLL[kind];
  return coll ? (Store.data(COLLECTIONS[coll].file) || {})[id] : null;
}

function legendBySym(map) {
  const out = {};
  for (const e of legendEntries(map)) out[e.sym] = e;
  return out;
}

export function mapView(main, path, choose) {
  const paths = mapPaths();
  if (!path || !paths.includes(path)) path = view.path && paths.includes(view.path) ? view.path : paths[0];
  if (view.path !== path) {
    view.path = path;
    view.brush = null;
  }
  const d = doc(path);
  const map = d.map;
  const area = areas().find((a) => a.map === path);

  const side = el('div', 'map-side', '', main);
  const viewBox = el('div', 'map-view', '', main);
  const bar = el('div', 'map-bar', '', viewBox);
  const canvas = el('canvas', '', '', viewBox);
  const ctx = canvas.getContext('2d');

  // --- Side panel -------------------------------------------------------------
  const pick = el('select', '', '', side);
  pick.style.width = '100%';
  for (const p of paths) {
    const a = areas().find((x) => x.map === p);
    el('option', '', `${a ? a.name || a.id : p.replace(/^.*\//, '')}${Store.isDirty(p) ? ' •' : ''}`, pick).value = p;
  }
  pick.value = path;
  pick.addEventListener('change', () => choose(pick.value));
  el('div', 'muted small', `${path} · ${map.rows[0] ? map.rows[0].length : 0} × ${map.rows.length}${area ? ` · world offset ${area.at.join(', ')}` : ' · not in the world layout'}`, side);

  el('h3', '', 'Map', side);
  const setting = (label, key, list) => {
    const row = el('div', 'row', '', side);
    el('span', 'muted', label, row).style.width = '70px';
    const input = el('input', 'grow', '', row);
    input.value = map.settings[key] || '';
    if (list) input.setAttribute('list', list);
    input.addEventListener('change', () => edit(() => {
      if (input.value.trim()) map.settings[key] = input.value.trim();
      else delete map.settings[key];
    }));
  };
  setting('name', 'name');
  setting('ground', 'ground', 'dl-ground');
  const spawnRow = el('label', 'row small', '', side);
  const spawnNone = el('input', '', '', spawnRow);
  spawnNone.type = 'checkbox';
  spawnNone.checked = map.settings.spawn === 'none';
  el('span', '', 'No spawn tile (an area joined by links)', spawnRow);
  spawnNone.addEventListener('change', () => edit(() => {
    if (spawnNone.checked) map.settings.spawn = 'none';
    else delete map.settings.spawn;
  }));

  el('h3', '', 'Layer', side);
  const layers = el('div', 'row', '', side);
  for (const [id, label] of [['things', 'Things'], ['height', 'Height'], ['ground', 'Ground'], ['zones', 'Zones']]) {
    button(label, layers, () => {
      view.layer = id;
      view.brush = null;
      redrawSide();
      draw();
    }, view.layer === id ? 'small on' : 'small');
  }
  const palette = el('div', '', '', side);

  el('h3', '', 'Size', side);
  const sizeRow = el('div', 'row small', '', side);
  const wIn = el('input', '', '', sizeRow);
  const hIn = el('input', '', '', sizeRow);
  for (const i of [wIn, hIn]) (i.type = 'number'), (i.style.width = '60px');
  wIn.value = map.rows[0] ? map.rows[0].length : 0;
  hIn.value = map.rows.length;
  button('Resize', sizeRow, () => resize(Number(wIn.value), Number(hIn.value)));
  el('div', 'muted small', 'Grows or crops at the right and bottom edges.', side);

  function redrawSide() {
    for (const b of layers.children) b.classList.toggle('on', b.textContent.toLowerCase() === view.layer);
    palette.innerHTML = '';
    if (view.layer === 'zones') return zonePanel(palette);
    const counts = countSymbols();
    const entries = paletteEntries();
    if (view.brush == null && entries.length) view.brush = entries[0].sym;
    const list = el('div', 'palette', '', palette);
    for (const e of entries) {
      const row = el('div', e.sym === view.brush ? 'pal active' : 'pal', '', list);
      const sw = el('span', 'swatch', '', row);
      sw.style.background = e.color || 'transparent';
      el('span', 'sym', e.sym === ' ' ? '␣' : e.sym, row);
      el('span', '', e.label, row);
      if (e.kind) el('span', 'kind', e.kind, row);
      el('span', 'count', counts[e.sym] ? String(counts[e.sym]) : '', row);
      row.title = e.title || '';
      row.addEventListener('click', () => {
        view.brush = e.sym;
        redrawSide();
      });
      if (e.removable && !counts[e.sym]) {
        button('×', row, () => edit(() => {
          map.legend.splice(map.legend.indexOf(e.entry), 1);
          if (view.brush === e.sym) view.brush = null;
        })).title = 'Remove from the legend (unused)';
      }
    }
    if (view.layer !== 'height') addLegendForm(palette);
  }

  function paletteEntries() {
    if (view.layer === 'height') {
      return HEIGHTS.map((h) => ({ sym: h, label: h <= '9' ? `level ${h}` : `ramp ${h.charCodeAt(0) - 97}–${h.charCodeAt(0) - 96}`, color: heightColor(h) }));
    }
    const out = [];
    if (view.layer === 'ground') out.push({ sym: '.', label: `default (${map.settings.ground || 'none'})`, color: groundColor(null) });
    for (const e of legendEntries(map)) {
      if ((view.layer === 'ground') !== (e.kind === 'ground')) continue;
      const def = defOf(e.kind, e.id);
      const coll = KIND_COLL[e.kind];
      out.push({
        sym: e.sym, kind: e.kind, entry: e, removable: true,
        label: e.id ? (def ? def.display_name || e.id : `${e.id} (missing!)`) : e.kind,
        title: e.id ? `${e.kind} ${e.id}${coll ? ` (${nameOf(coll, e.id)})` : ''}` : e.kind,
        color: e.kind === 'spawn' ? '#ff4fd8' : e.kind === 'floor' ? 'transparent' : def ? cssColor(def.color) : '#f00',
      });
    }
    return out;
  }

  function addLegendForm(parent) {
    el('h3', '', 'Add to the legend', parent);
    const row = el('div', 'row', '', parent);
    const kind = el('select', '', '', row);
    const kinds = view.layer === 'ground' ? ['ground'] : ['terrain', 'node', 'station', 'npc', 'decor', 'floor', 'spawn'];
    for (const k of kinds) el('option', '', k, kind).value = k;
    const id = el('input', 'grow', '', row);
    id.placeholder = 'id';
    const sync = () => {
      const coll = KIND_COLL[kind.value];
      id.disabled = !coll;
      if (coll) id.setAttribute('list', `dl-${coll}`);
    };
    kind.addEventListener('change', sync);
    sync();
    const row2 = el('div', 'row', '', parent);
    el('span', 'muted small', 'symbol', row2);
    const sym = el('input', '', '', row2);
    sym.maxLength = 1;
    sym.style.width = '34px';
    sym.value = freeSymbol();
    button('+ Add', row2, () => {
      const coll = KIND_COLL[kind.value];
      if (coll && !idsOf(coll).includes(id.value)) return id.classList.add('bad');
      const s = sym.value;
      if (!s || s === ' ' || legendBySym(map)[s]) return sym.classList.add('bad');
      edit(() => {
        let at = map.legend.length;
        while (at > 0 && map.legend[at - 1].raw != null && map.legend[at - 1].raw.trim() === '') at--;
        map.legend.splice(at, 0, { sym: s, kind: kind.value, id: coll ? id.value : '' });
        view.brush = s;
      });
    });
  }

  function freeSymbol() {
    const used = legendBySym(map);
    return SYMBOLS.find((s) => !used[s]) || '';
  }

  function zonePanel(parent) {
    el('div', 'muted small', 'Pick a zone, then drag on the map to set its rectangle. Zones: safe (no fighting), hab, build, pad, mech (where a mech can walk), arena...', parent);
    map.zones.forEach((z, i) => {
      const row = el('div', 'zone-row', '', parent);
      row.style.outline = i === view.zone ? `1px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}` : '';
      const id = el('input', '', '', row);
      id.value = z.id;
      id.style.color = ZONE_COLORS[i % ZONE_COLORS.length];
      id.addEventListener('focus', () => {
        view.zone = i;
        draw();
      });
      id.addEventListener('change', () => edit(() => (z.id = id.value.trim() || z.id)));
      for (const k of ['x1', 'y1', 'x2', 'y2']) {
        const n = el('input', '', '', row);
        n.type = 'number';
        n.value = z[k];
        n.title = k;
        n.addEventListener('change', () => edit(() => (z[k] = Number(n.value))));
      }
      button('×', row, () => edit(() => map.zones.splice(i, 1)));
      row.addEventListener('click', () => {
        if (view.zone !== i) {
          view.zone = i;
          redrawSide();
          draw();
        }
      });
    });
    button('+ Zone', parent, () => edit(() => {
      map.zones.push({ id: 'safe', x1: 0, y1: 0, x2: 3, y2: 3 });
      view.zone = map.zones.length - 1;
    }));
  }

  // --- Toolbar ------------------------------------------------------------------
  const tools = el('span', 'row', '', bar);
  for (const [id, label, tip] of [['paint', 'Paint', 'Click or drag to paint'], ['rect', 'Rectangle', 'Drag to fill a rectangle'], ['fill', 'Fill', 'Flood-fill the touching area'], ['pick', 'Pick', 'Pick up the brush under the cursor (or right-click)']]) {
    const b = button(label, tools, () => {
      view.tool = id;
      for (const x of tools.children) x.classList.toggle('on', x === b);
    }, view.tool === id ? 'small on' : 'small');
    b.title = tip;
  }
  el('span', 'muted', '|', bar);
  button('−', bar, () => setZoom(view.zoom - 2)).title = 'Zoom out';
  button('+', bar, () => setZoom(view.zoom + 2)).title = 'Zoom in';
  button('Undo', bar, undo).title = 'Ctrl+Z';
  button('Redo', bar, redo).title = 'Ctrl+Y';
  const toggles = [['showGlyphs', 'Symbols'], ['showZones', 'Zones']];
  for (const [key, label] of toggles) {
    const l = el('label', 'row small', '', bar);
    const c = el('input', '', '', l);
    c.type = 'checkbox';
    c.checked = view[key];
    el('span', '', label, l);
    c.addEventListener('change', () => {
      view[key] = c.checked;
      draw();
    });
  }
  const hover = el('span', 'muted', '', bar);
  hover.id = 'hover';

  // --- Editing ------------------------------------------------------------------
  function snapshot() {
    return JSON.stringify({ rows: map.rows, height: map.height, ground: map.ground, zones: map.zones, legend: map.legend, settings: map.settings });
  }
  function restore(s) {
    Object.assign(map, JSON.parse(s));
    commit();
    redrawSide();
    draw();
  }
  function commit() {
    d.text = writeMap(map);
    Store.setText(path, d.text);
  }
  /** Runs [fn] as one undoable change, then saves it into the map's text. */
  function edit(fn, quiet = false) {
    d.undo.push(snapshot());
    if (d.undo.length > 200) d.undo.shift();
    d.redo = [];
    fn();
    commit();
    if (!quiet) redrawSide();
    draw();
  }
  function undo() {
    if (!d.undo.length) return;
    d.redo.push(snapshot());
    restore(d.undo.pop());
  }
  function redo() {
    if (!d.redo.length) return;
    d.undo.push(snapshot());
    restore(d.redo.pop());
  }

  function layerRows() {
    if (view.layer === 'height') {
      if (!map.height) map.height = map.rows.map((r) => '0'.repeat(r.length));
      return map.height;
    }
    if (view.layer === 'ground') {
      if (!map.ground) map.ground = map.rows.map((r) => '.'.repeat(r.length));
      return map.ground;
    }
    return map.rows;
  }
  function get(rows, x, y) {
    return rows && rows[y] ? rows[y][x] : undefined;
  }
  function set(rows, x, y, c) {
    if (!rows[y] || x < 0 || x >= rows[y].length || rows[y][x] === c) return false;
    rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
    return true;
  }
  /** Paints the brush on [tiles]; a new spawn replaces the old one. */
  function paint(tiles) {
    const rows = layerRows();
    const brush = view.brush;
    if (brush == null) return;
    const entry = legendBySym(map)[brush];
    if (view.layer === 'things' && entry && entry.kind === 'spawn') {
      const floor = legendEntries(map).find((e) => e.kind === 'floor');
      for (let y = 0; y < rows.length; y++) {
        const x = rows[y].indexOf(brush);
        if (x >= 0 && floor) set(rows, x, y, floor.sym);
      }
      tiles = tiles.slice(-1);
    }
    for (const [x, y] of tiles) set(rows, x, y, brush);
  }
  function flood(x0, y0) {
    const rows = layerRows();
    const from = get(rows, x0, y0);
    if (from === undefined || from === view.brush) return [];
    const out = [];
    const seen = new Set();
    const stack = [[x0, y0]];
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = `${x},${y}`;
      if (seen.has(k) || get(rows, x, y) !== from) continue;
      seen.add(k);
      out.push([x, y]);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return out;
  }
  function rect(a, b) {
    const out = [];
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
      for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) out.push([x, y]);
    }
    return out;
  }
  function line(a, b) {
    const out = [];
    let [x, y] = a;
    const dx = Math.abs(b[0] - x);
    const dy = -Math.abs(b[1] - y);
    const sx = x < b[0] ? 1 : -1;
    const sy = y < b[1] ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push([x, y]);
      if (x === b[0] && y === b[1]) return out;
      const e2 = 2 * err;
      if (e2 >= dy) (err += dy), (x += sx);
      if (e2 <= dx) (err += dx), (y += sy);
    }
  }
  function resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    const floor = (legendEntries(map).find((e) => e.kind === 'floor') || { sym: '.' }).sym;
    const fit = (rows, fill) => {
      if (!rows) return rows;
      const out = rows.slice(0, h).map((r) => (r.length >= w ? r.slice(0, w) : r + fill(r).repeat(w - r.length)));
      while (out.length < h) out.push(fill(out[out.length - 1] || '').repeat(w));
      return out;
    };
    const common = (r) => {
      const counts = {};
      for (const c of r) counts[c] = (counts[c] || 0) + 1;
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '0';
    };
    edit(() => {
      map.rows = fit(map.rows, () => floor);
      map.height = fit(map.height, common);
      map.ground = fit(map.ground, () => '.');
    });
    choose(path);
  }
  function countSymbols() {
    const counts = {};
    const rows = view.layer === 'height' ? map.height || [] : view.layer === 'ground' ? map.ground || [] : map.rows;
    for (const r of rows) for (const c of r) counts[c] = (counts[c] || 0) + 1;
    return counts;
  }

  // --- Drawing --------------------------------------------------------------------
  function groundColor(sym) {
    const entry = sym && sym !== '.' ? legendBySym(map)[sym] : null;
    const def = entry ? defOf('ground', entry.id) : defOf('ground', map.settings.ground);
    return def ? cssColor(def.color) : '#3a3a34';
  }
  function heightColor(h) {
    const v = h <= '9' ? h.charCodeAt(0) - 48 : h.charCodeAt(0) - 97 + 0.5;
    const l = 18 + v * 9;
    return `hsl(${210 - v * 18}, 45%, ${Math.min(l, 85)}%)`;
  }
  function heightOf(x, y) {
    const h = get(map.height, x, y);
    if (!h) return 0;
    return h <= '9' ? h.charCodeAt(0) - 48 : h.charCodeAt(0) - 97 + 0.5;
  }

  let pending = false;
  function draw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      drawNow();
    });
  }
  let preview = null;
  function drawNow() {
    const s = view.zoom;
    const h = map.rows.length;
    const w = h ? map.rows[0].length : 0;
    canvas.width = w * s;
    canvas.height = h * s;
    const legend = legendBySym(map);
    const font = `${Math.round(s * 0.8)}px ui-monospace, Consolas, monospace`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x * s;
        const py = y * s;
        if (view.layer === 'height') {
          ctx.fillStyle = heightColor(get(map.height, x, y) || '0');
          ctx.fillRect(px, py, s, s);
        } else {
          ctx.fillStyle = groundColor(get(map.ground, x, y));
          ctx.fillRect(px, py, s, s);
          const shade = heightOf(x, y) - 1;
          if (shade) {
            ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${Math.min(0.3, shade * 0.08)})` : `rgba(0,0,0,${Math.min(0.5, -shade * 0.16)})`;
            ctx.fillRect(px, py, s, s);
          }
        }
        const sym = map.rows[y][x];
        const e = legend[sym];
        if (view.layer !== 'height' && e) {
          const def = defOf(e.kind, e.id);
          const color = def ? cssColor(def.color) : '#f0f';
          ctx.fillStyle = color;
          const c = s / 2;
          if (e.kind === 'terrain') ctx.fillRect(px, py, s, s);
          else if (e.kind === 'decor') {
            ctx.beginPath();
            ctx.arc(px + c, py + c, s * 0.22, 0, Math.PI * 2);
            ctx.fill();
          } else if (e.kind === 'node') {
            ctx.beginPath();
            ctx.arc(px + c, py + c, s * 0.42, 0, Math.PI * 2);
            ctx.fill();
          } else if (e.kind === 'station') {
            ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
            ctx.strokeStyle = '#e0a040';
            ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
          } else if (e.kind === 'npc') {
            ctx.beginPath();
            ctx.moveTo(px + c, py + 1);
            ctx.lineTo(px + s - 1, py + c);
            ctx.lineTo(px + c, py + s - 1);
            ctx.lineTo(px + 1, py + c);
            ctx.fill();
          } else if (e.kind === 'spawn') {
            ctx.fillStyle = '#ff4fd8';
            ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
          }
        } else if (view.layer !== 'height' && !e) {
          ctx.fillStyle = '#f00';
          ctx.fillRect(px, py, s, s);
        }
        if (view.showGlyphs && s >= 11) {
          let glyph = null;
          if (view.layer === 'height') glyph = get(map.height, x, y);
          else if (view.layer === 'ground') glyph = get(map.ground, x, y) !== '.' ? get(map.ground, x, y) : null;
          else if (e && e.kind !== 'floor') glyph = sym;
          if (glyph) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillText(glyph, px + s / 2 + 1, py + s / 2 + 1);
            ctx.fillStyle = '#fff';
            ctx.fillText(glyph, px + s / 2, py + s / 2);
          }
        }
      }
    }
    if (s >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x++) (ctx.moveTo(x * s + 0.5, 0), ctx.lineTo(x * s + 0.5, h * s));
      for (let y = 0; y <= h; y++) (ctx.moveTo(0, y * s + 0.5), ctx.lineTo(w * s, y * s + 0.5));
      ctx.stroke();
    }
    if (view.showZones || view.layer === 'zones') {
      map.zones.forEach((z, i) => {
        const color = ZONE_COLORS[i % ZONE_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = view.layer === 'zones' && i === view.zone ? 3 : 1.5;
        ctx.setLineDash(view.layer === 'zones' && i === view.zone ? [] : [5, 3]);
        ctx.strokeRect(z.x1 * s + 1, z.y1 * s + 1, (z.x2 - z.x1 + 1) * s - 2, (z.y2 - z.y1 + 1) * s - 2);
        ctx.setLineDash([]);
        ctx.font = '11px system-ui';
        ctx.textAlign = 'left';
        ctx.fillStyle = color;
        ctx.fillText(z.id, z.x1 * s + 4, z.y1 * s + 9);
        ctx.font = font;
        ctx.textAlign = 'center';
      });
    }
    // Links in and out of this area (world.json).
    if (area) {
      ctx.lineWidth = 2;
      for (const link of (Store.data(LAYOUT) || {}).links || []) {
        for (const [end, color] of [[link.from, '#ffffff'], [link.to, '#7fe0ff']]) {
          if (!end || end[0] !== area.id) continue;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(end[1] * s + s / 2, end[2] * s + s / 2, s * 0.45, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    if (preview) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      const [a, b] = preview;
      ctx.strokeRect(Math.min(a[0], b[0]) * s, Math.min(a[1], b[1]) * s, (Math.abs(a[0] - b[0]) + 1) * s, (Math.abs(a[1] - b[1]) + 1) * s);
    }
  }

  function describe(x, y) {
    const sym = get(map.rows, x, y);
    if (sym === undefined) return '';
    const e = legendBySym(map)[sym];
    const def = e && defOf(e.kind, e.id);
    const parts = [`${x},${y}`];
    if (area) parts.push(`world ${area.at[0] + x},${area.at[1] + y}`);
    parts.push(e ? `'${sym}' ${e.kind}${e.id ? ` ${e.id}${def && def.display_name ? ` (${def.display_name})` : ''}` : ''}` : `'${sym}' not in the legend!`);
    if (map.height) parts.push(`height ${get(map.height, x, y)}`);
    const g = get(map.ground, x, y);
    if (g && g !== '.') parts.push(`ground ${(legendBySym(map)[g] || {}).id || g}`);
    const zones = map.zones.filter((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2).map((z) => z.id);
    if (zones.length) parts.push(`zones ${zones.join(', ')}`);
    for (const link of (area && (Store.data(LAYOUT) || {}).links) || []) {
      if (link.from && link.from[0] === area.id && link.from[1] === x && link.from[2] === y) parts.push(`link to ${link.to.join(' ')}`);
    }
    return parts.join(' · ');
  }

  // --- Mouse ----------------------------------------------------------------------
  function cellAt(event) {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((event.clientX - r.left) / view.zoom), Math.floor((event.clientY - r.top) / view.zoom)];
  }
  function pickAt([x, y]) {
    if (view.layer === 'zones') {
      const i = map.zones.findIndex((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
      if (i >= 0) view.zone = i;
    } else {
      const c = get(layerRows(), x, y);
      if (c !== undefined) view.brush = c;
    }
    redrawSide();
    draw();
  }
  let stroke = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    const at = cellAt(e);
    if (e.button === 2 || view.tool === 'pick') return pickAt(at);
    if (e.button !== 0) return;
    if (view.layer === 'zones') {
      if (!map.zones[view.zone]) return;
      stroke = { start: at, last: at, rect: true };
      preview = [at, at];
      return draw();
    }
    if (view.tool === 'fill') return edit(() => paint(flood(...at)));
    if (view.tool === 'rect') {
      stroke = { start: at, last: at, rect: true };
      preview = [at, at];
      return draw();
    }
    d.undo.push(snapshot());
    d.redo = [];
    stroke = { start: at, last: at };
    paint([at]);
    draw();
  });
  canvas.addEventListener('mousemove', (e) => {
    const at = cellAt(e);
    hover.textContent = describe(...at);
    if (!stroke) return;
    if (stroke.rect) {
      preview = [stroke.start, at];
      draw();
    } else if (at[0] !== stroke.last[0] || at[1] !== stroke.last[1]) {
      paint(line(stroke.last, at));
      stroke.last = at;
      draw();
    }
  });
  const finish = (e) => {
    if (!stroke) return;
    const at = e ? cellAt(e) : stroke.last;
    if (stroke.rect && view.layer === 'zones') {
      const z = map.zones[view.zone];
      edit(() => Object.assign(z, { x1: Math.min(stroke.start[0], at[0]), y1: Math.min(stroke.start[1], at[1]), x2: Math.max(stroke.start[0], at[0]), y2: Math.max(stroke.start[1], at[1]) }));
    } else if (stroke.rect) {
      const area = rect(stroke.start, at);
      edit(() => paint(area));
    } else {
      commit();
      redrawSide();
    }
    stroke = null;
    preview = null;
    draw();
  };
  canvas.addEventListener('mouseup', finish);
  canvas.addEventListener('mouseleave', () => {
    hover.textContent = '';
  });
  window.onmouseup = (e) => {
    if (stroke && e.target !== canvas) finish(null);
  };
  window.onkeydown = (e) => {
    if (!document.body.contains(canvas) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo());
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') (e.preventDefault(), redo());
  };
  function setZoom(z) {
    view.zoom = Math.max(4, Math.min(32, z));
    draw();
  }
  viewBox.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(view.zoom + (e.deltaY < 0 ? 2 : -2));
  }, { passive: false });

  redrawSide();
  draw();
}
