// Writes a data file back so that an edit changes only the entries it
// touched: every top-level entry that's unchanged keeps its exact original
// text (number spellings like 1.0 included), and changed or new entries are
// written in the file's style, either one entry per line (decor.json) or
// indented (most files).

/** A value on one line: { "a": 1, "b": [1, 2] }. */
export function inline(value) {
  if (Array.isArray(value)) return value.length ? `[${value.map(inline).join(', ')}]` : '[]';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

/**
 * The top-level entries of a JSON object's text, in order: { key, raw } where
 * raw runs from the key's opening quote to the end of its value. Null if
 * [text] isn't an object.
 */
export function splitEntries(text) {
  let i = text.indexOf('{');
  if (i < 0) return null;
  const out = [];
  let depth = 0;
  let start = -1;
  let key = null;
  let afterColon = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const begin = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      if (depth === 1 && !afterColon) {
        start = begin;
        key = JSON.parse(text.slice(begin, i + 1));
      }
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        const end = lastNonSpace(text, i) + 1;
        if (key != null) out.push({ key, raw: text.slice(start, end) });
        out.tail = text.slice(end);
        return out;
      }
    } else if (depth === 1 && c === ':') afterColon = true;
    else if (depth === 1 && c === ',') {
      out.push({ key, raw: text.slice(start, lastNonSpace(text, i) + 1) });
      key = null;
      afterColon = false;
    }
  }
  return null;
}

function lastNonSpace(text, before) {
  let j = before - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j;
}

/** How [text] lays out its entries: { rows, indent }. */
export function styleOf(text) {
  const entries = splitEntries(text) || [];
  const multi = entries.filter((e) => e.raw.includes('\n')).length;
  const m = text.match(/\n([ \t]+)"/);
  return { rows: entries.length > 0 && multi * 2 < entries.length, indent: m ? m[1] : ' ' };
}

/** [value] as text at [indent], reusing [oldRaw] (its text in the file) for any part that hasn't changed. */
function writeValue(value, oldValue, oldRaw, indent, step) {
  if (oldRaw != null && same(value, oldValue)) return oldRaw;
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObject(value) && isObject(oldValue) && oldRaw && oldRaw.startsWith('{') && oldRaw.includes('\n')) {
    const parts = new Map((splitEntries(oldRaw) || []).map((e) => [e.key, e.raw.slice(e.raw.indexOf(':') + 1).trim()]));
    const inner = indent + step;
    const lines = Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${writeValue(v, oldValue[k], parts.get(k), inner, step)}`);
    return lines.length ? `{\n${lines.join(',\n')}\n${indent}}` : '{}';
  }
  return JSON.stringify(value, null, step).replace(/\n/g, `\n${indent}`);
}

function writeEntry(key, value, style, oldValue, oldRaw) {
  if (style.rows) return `${JSON.stringify(key)}: ${inline(value)}`;
  const raw = oldRaw != null ? oldRaw.slice(oldRaw.indexOf(':') + 1).trim() : null;
  return `${JSON.stringify(key)}: ${writeValue(value, oldValue, raw, style.indent, style.indent)}`;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** [data] as text, keeping [original]'s text for every entry that hasn't changed. */
export function format(data, original = '') {
  const style = styleOf(original);
  const old = new Map();
  let parsed = {};
  let tail = '\n}\n';
  try {
    parsed = JSON.parse(original);
    const entries = splitEntries(original) || [];
    for (const e of entries) old.set(e.key, e.raw);
    if (entries.length && entries.tail) tail = entries.tail;
  } catch {
    parsed = {};
  }
  const lines = Object.entries(data).map(([key, value]) => {
    const raw = old.get(key);
    return style.indent + (raw != null && same(parsed[key], value) ? raw : writeEntry(key, value, style, parsed[key], raw));
  });
  return lines.length ? `{\n${lines.join(',\n')}${tail}` : '{}\n';
}
