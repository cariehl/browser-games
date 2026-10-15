// The generic form: edits any JSON value in place, field by field. Knows a
// field's kind from its value or its def's default (text, number, yes/no,
// colour, a reference to other content, a list, a group), shows the doc
// comment from defs.js, and offers values already used elsewhere.

import { Store } from './store.js';
import { refFor, idsOf, nameOf, docOf, fill, COLLECTIONS, collectionOf } from './schema.js';
import { el, button, toHex, fromHex, clone, ticksHint } from './ui.js';

/** Text fields that get a multi-line box. */
const LONG = new Set(['description', 'lore', 'journal', 'text', 'done_text', 'say', 'note']);
/** Fields whose default is null, and what they hold when set. */
const NULL_KINDS = {
  boss: {}, light: { color: [1, 0.8, 0.5], intensity: 4, distance: 8 }, needs: { item: '', count: 1 }, look: {},
  cable: [0, 0], pad: ['', 0, 0], drop: ['', 0, 0], accent: [1, 0.6, 0.2, 1], brain: '', model: '', depleted_model: '',
};
/** What a new element of a list starts as, by the list's key. */
const TEMPLATES = {
  inputs: { item: '', count: 1 }, components: { item: '', count: 1 }, entries: { item: '', weight: 1 },
  drops: { item: '', chance: 1 }, quest_drops: { quest: '', stage: '', item: '', chance: 0.5 },
  items: { item: '', count: 1 }, links: { from: ['', 0, 0], to: ['', 0, 0], text: '' },
  areas: { id: 'new_area', name: '', map: '', at: [0, 0] }, lines: { who: 'npc', text: '' },
};

/** Datalists of every id in a collection, made once and refreshed on demand. */
export function refreshDatalists() {
  for (const coll of [...Object.keys(COLLECTIONS), 'areas', 'maps']) {
    let list = document.getElementById(`dl-${coll}`);
    if (!list) list = el('datalist', '', '', document.body), (list.id = `dl-${coll}`);
    list.innerHTML = '';
    for (const id of idsOf(coll)) {
      const option = el('option', '', '', list);
      option.value = id;
      const name = nameOf(coll, id);
      if (name !== id) option.label = name;
    }
  }
}

/** Distinct values of [key] used anywhere in [file], as a datalist id (for free-text fields like kind, look, shape). */
function suggestions(file, key) {
  const id = `sug-${file}-${key}`.replace(/[^a-z0-9-]/gi, '_');
  let list = document.getElementById(id);
  if (!list) {
    list = el('datalist', '', '', document.body);
    list.id = id;
    const seen = new Set();
    const visit = (v) => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === key && typeof x === 'string' && x && x.length < 40) seen.add(x);
          visit(x);
        }
      }
    };
    visit(Store.data(file));
    for (const v of [...seen].sort()) el('option', '', '', list).value = v;
  }
  return id;
}

function isColor(key, value) {
  return /colou?r|accent|tint/i.test(key) && Array.isArray(value) && (value.length === 3 || value.length === 4) && value.every((n) => typeof n === 'number');
}

/**
 * An input for one value. [ctx]: { file, path (keys and indices, entry id
 * first for collections), key, set(newValue), rerender() }.
 */
export function valueEditor(value, ctx) {
  const { key } = ctx;
  const touch = () => Store.touch(ctx.file);
  const inPath = collectionOf(ctx.file) ? ctx.path.slice(1) : ctx.path;
  const ref = refFor(ctx.file, inPath);

  if (value === null || value === undefined) {
    const wrap = el('div', 'row');
    el('span', 'muted', '(not set)', wrap);
    const start = key in NULL_KINDS ? NULL_KINDS[key] : ref ? '' : null;
    if (start !== null) {
      button('Set', wrap, () => {
        ctx.set(clone(start));
        touch();
        ctx.rerender();
      });
    } else {
      const input = el('input', '', '', wrap);
      input.placeholder = 'value as JSON, e.g. "text", 3 or {}';
      input.addEventListener('change', () => {
        try {
          ctx.set(JSON.parse(input.value));
          touch();
          ctx.rerender();
        } catch {
          input.classList.add('bad');
        }
      });
    }
    return wrap;
  }

  if (typeof value === 'boolean') {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => {
      ctx.set(input.checked);
      touch();
      ctx.changed && ctx.changed();
    });
    return input;
  }

  if (typeof value === 'number') {
    const wrap = el('span', 'row');
    const input = el('input', '', '', wrap);
    input.type = 'number';
    input.step = 'any';
    input.value = value;
    const hint = el('span', 'hint', '', wrap);
    const showHint = (n) => {
      hint.textContent = /_ticks$|^ticks$|_every$|_warn$/.test(key) ? ticksHint(n) : /chance$/.test(key) && n <= 1 ? `${Math.round(n * 1000) / 10}%` : /bonus$|factor$/.test(key) && n > 0 && n < 1 ? `${Math.round(n * 1000) / 10}%` : '';
    };
    showHint(value);
    input.addEventListener('input', () => {
      if (input.value === '' || Number.isNaN(Number(input.value))) return;
      ctx.set(Number(input.value));
      showHint(Number(input.value));
      touch();
      ctx.changed && ctx.changed();
    });
    return wrap;
  }

  if (typeof value === 'string') {
    const long = LONG.has(key) || value.length > 70 || value.includes('\n');
    const wrap = el('div');
    const input = el(long ? 'textarea' : 'input', ref ? 'ref-input' : '', '', wrap);
    if (!long) input.type = 'text';
    input.value = value;
    input.spellcheck = long;
    if (long) input.rows = Math.min(8, Math.max(2, Math.ceil(value.length / 90)));
    let refName = null;
    let preview = null;
    if (ref) {
      input.setAttribute('list', `dl-${ref}`);
      refName = el('span', 'hint', '', wrap);
    } else if (!long && key && !/^(id|display_name|abbreviation)$/.test(key)) {
      input.setAttribute('list', suggestions(ctx.file, key));
    }
    if (long || value.includes('{')) preview = el('div', 'preview', '', wrap);
    const check = () => {
      if (ref) {
        const ok = input.value === '' || idsOf(ref).includes(input.value);
        input.classList.toggle('bad', !ok);
        refName.textContent = !ok ? `no ${ref.replace(/_/g, ' ')} with this id` : input.value ? nameOf(ref, input.value) : '';
        refName.classList.toggle('bad-text', !ok);
      }
      if (preview) preview.textContent = input.value.includes('{') ? `Reads: ${fill(input.value)}` : '';
    };
    check();
    input.addEventListener('input', () => {
      ctx.set(input.value);
      check();
      touch();
      ctx.changed && ctx.changed();
    });
    return wrap;
  }

  if (isColor(key, value)) {
    const wrap = el('div', 'color-field');
    const picker = el('input', '', '', wrap);
    picker.type = 'color';
    picker.value = toHex(value);
    let alpha = null;
    if (value.length === 4) {
      el('span', 'muted small', 'alpha', wrap);
      alpha = el('input', '', '', wrap);
      alpha.type = 'number';
      alpha.min = 0;
      alpha.max = 1;
      alpha.step = 0.05;
      alpha.value = value[3];
      alpha.style.width = '64px';
    }
    const text = el('span', 'muted small', value.map((n) => Math.round(n * 100) / 100).join(', '), wrap);
    const update = () => {
      const next = fromHex(picker.value);
      if (alpha) next.push(Number(alpha.value));
      value.splice(0, value.length, ...next);
      text.textContent = next.join(', ');
      touch();
      ctx.changed && ctx.changed();
    };
    picker.addEventListener('input', update);
    if (alpha) alpha.addEventListener('input', update);
    return wrap;
  }

  if (Array.isArray(value)) {
    const objects = value.length ? value.every((v) => v && typeof v === 'object' && !Array.isArray(v)) : TEMPLATES[key] && typeof TEMPLATES[key] === 'object';
    return objects ? objectList(value, ctx) : primitiveList(value, ctx);
  }

  if (typeof value === 'object') {
    const box = el('div', 'nested');
    objectFields(box, value, { ...ctx });
    return box;
  }
  return el('span', 'muted', String(value));
}

function primitiveList(list, ctx) {
  const wrap = el('div', 'chips');
  const numbers = list.length > 0 && list.every((v) => typeof v === 'number');
  const draw = () => {
    wrap.innerHTML = '';
    list.forEach((v, i) => {
      const chip = el('span', 'chip', '', wrap);
      const editor = valueEditor(v, {
        ...ctx, key: ctx.key, path: [...ctx.path, i], set: (nv) => (list[i] = nv), rerender: draw,
      });
      chip.appendChild(editor);
      if (!numbers || list.length > 3) button('×', chip, () => {
        list.splice(i, 1);
        Store.touch(ctx.file);
        draw();
      });
    });
    if (!numbers || list.length === 0) {
      button('+', wrap, () => {
        list.push(numbers ? 0 : typeof list[0] === 'number' ? 0 : '');
        Store.touch(ctx.file);
        draw();
      });
    }
  };
  draw();
  return wrap;
}

/** A one-line summary of a list element, for its card's title. */
function summary(obj, index) {
  const pick = obj.id || obj.item || obj.table || obj.text || obj.who || obj.type || obj.name || '';
  const count = obj.count != null ? ` ×${obj.count}` : obj.weight != null ? ` (weight ${obj.weight})` : '';
  return `${index + 1}. ${String(pick).slice(0, 60)}${count}`;
}

function objectList(list, ctx) {
  const wrap = el('div');
  const draw = () => {
    wrap.innerHTML = '';
    list.forEach((obj, i) => {
      const card = el('div', 'card', '', wrap);
      const head = el('div', 'card-head', '', card);
      el('span', 'title', summary(obj, i), head);
      button('↑', head, () => move(i, -1)).disabled = i === 0;
      button('↓', head, () => move(i, 1)).disabled = i === list.length - 1;
      button('Copy', head, () => {
        list.splice(i + 1, 0, clone(obj));
        Store.touch(ctx.file);
        draw();
      });
      button('Remove', head, () => {
        list.splice(i, 1);
        Store.touch(ctx.file);
        draw();
      }, 'small danger');
      const body = el('div', 'nested', '', card);
      objectFields(body, obj, { ...ctx, path: [...ctx.path, i], rerender: draw, changed: () => (head.firstChild.textContent = summary(obj, i)) });
    });
    button(`+ Add`, wrap, () => {
      const template = TEMPLATES[ctx.key] || (list.length ? blank(list[list.length - 1]) : {});
      list.push(clone(template));
      Store.touch(ctx.file);
      draw();
    });
  };
  const move = (i, d) => {
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    Store.touch(ctx.file);
    draw();
  };
  draw();
  return wrap;
}

/** A copy of [obj] with its text emptied, as a template for a new list element. */
function blank(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? '' : clone(v);
  return out;
}

/**
 * Rows for each field of [obj]. With ctx.defaults (a top-level entry), every
 * field the def has is shown, unset ones greyed out with their default, and
 * a ↺ puts a set field back to its default.
 */
export function objectFields(container, obj, ctx) {
  const draw = () => {
    container.innerHTML = '';
    const defaults = ctx.defaults || null;
    const keys = defaults ? [...Object.keys(defaults).filter((k) => k !== 'id'), ...Object.keys(obj).filter((k) => !(k in defaults) && k !== 'id')] : Object.keys(obj);
    for (const key of keys) {
      if (ctx.hide && ctx.hide.includes(key)) continue;
      const set = key in obj;
      const row = el('div', set ? 'field' : 'field unset', '', container);
      const label = el('div', 'label', '', row);
      const name = el('div', 'name', key.replace(/_/g, ' '), label);
      const doc = ctx.coll ? docOf(ctx.coll, key) : '';
      if (doc) el('div', 'doc', doc, label);
      const value = el('div', 'value', '', row);
      const current = set ? obj[key] : clone(defaults[key]);
      const editor = valueEditor(current, {
        ...ctx,
        defaults: null,
        key,
        path: [...ctx.path, key],
        set: (nv) => {
          obj[key] = nv;
          row.classList.remove('unset');
        },
        rerender: draw,
      });
      // Editing an unset field's default in place (a colour, a list) sets it.
      if (!set && current && typeof current === 'object') {
        editor.addEventListener('input', () => {
          if (!(key in obj)) obj[key] = current;
          row.classList.remove('unset');
        }, true);
        editor.addEventListener('click', () => {
          if (!(key in obj)) obj[key] = current;
          row.classList.remove('unset');
        }, true);
      }
      value.appendChild(editor);
      if (defaults && set && key in defaults) {
        const reset = button('↺', name, () => {
          delete obj[key];
          Store.touch(ctx.file);
          draw();
        }, 'small reset');
        reset.title = 'Back to the default';
      } else if (!ctx.fixed && (!defaults || !(key in defaults))) {
        button('×', name, () => {
          delete obj[key];
          Store.touch(ctx.file);
          draw();
        }, 'small reset').title = 'Remove this field';
      }
    }
    if (!ctx.noAdd && !ctx.fixed) addFieldRow(container, obj, ctx, draw);
  };
  draw();
}

function addFieldRow(container, obj, ctx, draw) {
  const row = el('div', 'row', '', container);
  row.style.marginTop = '6px';
  const name = el('input', '', '', row);
  name.placeholder = 'new field name';
  name.style.width = '160px';
  const kind = el('select', '', '', row);
  for (const [label, v] of [['text', ''], ['number', 0], ['yes/no', false], ['list', []], ['group', {}]]) {
    const o = el('option', '', label, kind);
    o.value = JSON.stringify(v);
  }
  button('+ Field', row, () => {
    const k = name.value.trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(k) || k in obj) {
      name.classList.add('bad');
      return;
    }
    obj[k] = JSON.parse(kind.value);
    Store.touch(ctx.file);
    draw();
  });
}
