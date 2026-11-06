// Reads a .map file into something the map editor can change, and writes it
// back. Comments, blank lines and the order of things are kept, so saving a
// map you didn't change gives the same file. See src/sim/map_data.js for the
// format the game reads.

const SETTINGS = ['name', 'spawn', 'ground'];

/**
 * { head: [lines], settings: { name, spawn, ground }, zones: [{ id, x1, y1, x2, y2 }],
 *   legend: [{ sym, kind, id } | { raw }], rows, height, ground, sections: [{ name, after }] }
 * height and ground are null when the file has no such section.
 */
export function parseMap(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const endsWithNewline = lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  const map = { head: [], settings: {}, zones: [], legend: [], rows: [], height: null, ground: null, sections: [], endsWithNewline };
  let section = null;
  for (const line of lines) {
    const header = line.match(/^\[(\w+)\]\s*$/);
    if (header) {
      section = { name: header[1].toLowerCase(), after: [] };
      map.sections.push(section);
      if (section.name === 'height') map.height = [];
      if (section.name === 'ground') map.ground = [];
      continue;
    }
    if (!section) {
      map.head.push(line);
      const m = line.match(/^([a-z ]+[a-z0-9_]*)\s*:\s*(.*)$/i);
      if (!m || line.trim().startsWith('//')) continue;
      const key = m[1].trim().toLowerCase();
      if (SETTINGS.includes(key)) map.settings[key] = m[2].trim();
      else if (key.startsWith('zone ')) {
        const r = m[2].match(/^(\d+)\s*,\s*(\d+)\s+(\d+)\s*,\s*(\d+)$/);
        if (r) map.zones.push({ id: key.slice(5).trim(), x1: +r[1], y1: +r[2], x2: +r[3], y2: +r[4] });
      }
      continue;
    }
    const blank = line.trim() === '' || line.trim().startsWith('//');
    if (section.name === 'legend') {
      const words = line.slice(1).trim().split(/\s+/);
      if (blank || line[0] === ' ') map.legend.push({ raw: line });
      else map.legend.push({ sym: line[0], kind: words[0].toLowerCase(), id: words[1] || '' });
      continue;
    }
    const grid = section.name === 'grid' ? map.rows : section.name === 'height' ? map.height : section.name === 'ground' ? map.ground : null;
    if (blank || !grid) section.after.push(line);
    else if (section.after.length) section.after.push(line);
    else grid.push(line.trim());
  }
  return map;
}

function settingLine(key, value) {
  return `${key}: ${value}`;
}

function zoneLine(z) {
  return `zone ${z.id}: ${z.x1},${z.y1} ${z.x2},${z.y2}`;
}

export function writeMap(map) {
  const out = [];
  // The head: comments kept, settings and zones rewritten where they were.
  const written = new Set();
  let zonesWritten = false;
  let lastSetting = -1;
  for (const line of map.head) {
    const m = line.trim().startsWith('//') ? null : line.match(/^([a-z ]+[a-z0-9_]*)\s*:/i);
    const key = m ? m[1].trim().toLowerCase() : null;
    if (key && SETTINGS.includes(key)) {
      if (map.settings[key]) out.push(settingLine(key, map.settings[key]));
      written.add(key);
      lastSetting = out.length - 1;
    } else if (key && key.startsWith('zone ')) {
      if (!zonesWritten) for (const z of map.zones) out.push(zoneLine(z));
      zonesWritten = true;
      lastSetting = out.length - 1;
    } else out.push(line);
  }
  const extra = [];
  for (const key of SETTINGS) if (map.settings[key] && !written.has(key)) extra.push(settingLine(key, map.settings[key]));
  if (!zonesWritten) for (const z of map.zones) extra.push(zoneLine(z));
  if (extra.length) {
    if (lastSetting < 0) {
      lastSetting = out.length;
      while (lastSetting > 0 && out[lastSetting - 1].trim() === '') lastSetting--;
    } else lastSetting++;
    out.splice(lastSetting, 0, ...extra);
  }
  const sections = [...map.sections];
  if (map.height && !sections.some((s) => s.name === 'height')) sections.push({ name: 'height', after: [''], fresh: true });
  if (map.ground && !sections.some((s) => s.name === 'ground')) sections.push({ name: 'ground', after: [''], fresh: true });
  for (const section of sections) {
    if (section.name === 'height' && !map.height) continue;
    if (section.name === 'ground' && !map.ground) continue;
    if (section.fresh && out[out.length - 1] !== '') out.push('');
    out.push(`[${section.name}]`);
    if (section.name === 'legend') {
      for (const e of map.legend) out.push(e.raw != null ? e.raw : `${e.sym}  ${e.kind}${e.id ? ` ${e.id}` : ''}`);
    } else {
      out.push(...({ grid: map.rows, height: map.height, ground: map.ground }[section.name] || []));
    }
    out.push(...section.after.filter((l, i, all) => !(section.fresh && i === all.length - 1)));
  }
  return out.join('\n') + (map.endsWithNewline ? '\n' : '');
}

/** The legend entries that are real entries, not comments. */
export function legendEntries(map) {
  return map.legend.filter((e) => e.raw == null);
}
