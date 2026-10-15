// A character's dialogue as a conversation: entries tried top to bottom (the
// first whose "when" holds is what they say), each a run of speech bubbles
// and then the player's choices. Each choice has when it's shown, what it
// does, what's said back, and either a sub-menu of its own choices or what
// comes after (close, this menu again, the menu above, the first menu).

import { Store } from './store.js';
import { COLLECTIONS, idsOf, fill } from './schema.js';
import { el, button, clone } from './ui.js';

const FILE = COLLECTIONS.dialogue.file;
const touch = () => Store.touch(FILE);

/** Effect kinds a choice can have, and what each holds. */
const EFFECTS = {
  start: { help: 'start a quest', ref: 'quests' },
  stage: { help: 'move a quest to a stage', pair: true },
  complete: { help: 'complete a quest', ref: 'quests' },
  take: { help: 'take an item (the choice fails without it)', ref: 'items' },
  give: { help: 'give an item', ref: 'items' },
  flag: { help: 'set or clear a flag', flag: true },
  event: { help: 'fire a game event (mech_powerup...)' },
};

/** Flag scopes, as sim/quests.js has them. */
const SCOPES = {
  world: 'world flag (shared by everyone)',
  quest: 'quest flag (this player, under a quest)',
  player: 'player flag (this player)',
  dialogue: 'dialogue flag (cleared when the talk ends)',
};

/** What comes after a choice with no sub-menu. */
const AFTER = { end: 'close the conversation', menu: 'show this menu again', parent: 'go back to the menu above', top: 'go back to the first menu' };

/** Every flag name used in the dialogue and quests, for suggestions. */
function flagDatalist() {
  let list = document.getElementById('dl-flags');
  if (!list) list = el('datalist', '', '', document.body), (list.id = 'dl-flags');
  const names = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const k of ['flag', 'not_flag', 'unless_flag']) if (typeof v[k] === 'string' && v[k]) names.add(v[k]);
      Object.values(v).forEach(walk);
    }
  };
  walk(Store.data(FILE));
  walk(Store.data(COLLECTIONS.quests.file));
  list.innerHTML = '';
  for (const n of [...names].sort()) el('option', '', '', list).value = n;
}

/** Scope, quest (for quest flags) and name of a flag held in [f]. */
function flagFields(parent, f, redraw) {
  const scope = el('select', '', '', parent);
  for (const [k, label] of Object.entries(SCOPES)) el('option', '', label, scope).value = k;
  scope.value = f.scope || 'world';
  scope.addEventListener('change', () => {
    if (scope.value === 'world') delete f.scope;
    else f.scope = scope.value;
    if (scope.value !== 'quest') delete f.quest;
    else f.quest = f.quest || '';
    touch();
    redraw();
  });
  if (f.scope === 'quest') refInput(parent, f.quest, 'quests', (v) => { f.quest = v; touch(); });
  const name = el('input', '', '', parent);
  name.value = f.flag || '';
  name.placeholder = 'flag name';
  name.style.width = '150px';
  name.setAttribute('list', 'dl-flags');
  name.addEventListener('input', () => { f.flag = name.value; touch(); });
}

function refInput(parent, value, coll, onInput) {
  const input = el('input', 'ref-input', '', parent);
  input.value = value || '';
  input.setAttribute('list', `dl-${coll}`);
  input.style.width = '170px';
  const check = () => input.classList.toggle('bad', input.value !== '' && !idsOf(coll).includes(input.value));
  check();
  input.addEventListener('input', () => {
    check();
    onInput(input.value);
  });
  return input;
}

function stageSelect(parent, questId, value, onChange) {
  const select = el('select', '', '', parent);
  const quest = (Store.data(COLLECTIONS.quests.file) || {})[questId];
  const options = ['none', ...(quest ? quest.stages.map((s) => s.id) : []), 'done'];
  if (value && !options.includes(value)) options.push(value);
  for (const o of options) el('option', '', o, select).value = o;
  select.value = value || 'none';
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

/** The "when" of an entry or choice: quest at a stage, carrying an item, flags set or not. */
function conditionEditor(parent, entry, redraw, label = 'When', none = 'always') {
  const box = el('div', 'cond', '', parent);
  el('b', '', label, box);
  const cond = entry.if || {};
  const parts = [];
  if ('quest' in cond) {
    const span = el('span', 'cond', '', box);
    el('span', 'muted', 'quest', span);
    refInput(span, cond.quest, 'quests', (v) => {
      cond.quest = v;
      touch();
    });
    el('span', 'muted', 'is at', span);
    stageSelect(span, cond.quest, cond.stage, (v) => {
      cond.stage = v;
      touch();
    });
    parts.push(span);
  }
  for (const [key, label, coll] of [['has', 'carrying', 'items'], ['flag', 'flag set', null], ['not_flag', 'flag not set', null]]) {
    if (!(key in cond)) continue;
    const span = el('span', 'cond', '', box);
    el('span', 'muted', label, span);
    if (coll) refInput(span, cond[key], coll, (v) => { cond[key] = v; touch(); });
    else {
      const input = el('input', '', '', span);
      input.value = cond[key];
      input.addEventListener('input', () => { cond[key] = input.value; touch(); });
    }
    parts.push(span);
  }
  for (const span of parts) {
    const key = ['quest', 'has', 'flag', 'not_flag'].filter((k) => k in cond)[parts.indexOf(span)];
    button('×', span, () => {
      delete cond[key];
      if (key === 'quest') delete cond.stage;
      if (!Object.keys(cond).length) delete entry.if;
      touch();
      redraw();
    });
  }
  (cond.flags || []).forEach((f, i) => {
    const span = el('span', 'cond', '', box);
    flagFields(span, f, redraw);
    const not = el('select', '', '', span);
    el('option', '', 'is set', not).value = '';
    el('option', '', 'is not set', not).value = 'not';
    not.value = f.not ? 'not' : '';
    not.addEventListener('change', () => {
      if (not.value) f.not = true;
      else delete f.not;
      touch();
    });
    button('×', span, () => {
      cond.flags.splice(i, 1);
      if (!cond.flags.length) delete cond.flags;
      if (!Object.keys(cond).length) delete entry.if;
      touch();
      redraw();
    });
    parts.push(span);
  });
  if (!parts.length) el('span', 'muted', none, box);
  const add = el('select', '', '', box);
  el('option', '', '+ condition', add).value = '';
  for (const [k, label] of [['quest', 'quest stage'], ['has', 'carrying an item'], ['flags', 'a flag (any scope)']]) {
    if (!(k in cond) || k === 'flags') el('option', '', label, add).value = k;
  }
  add.addEventListener('change', () => {
    entry.if = entry.if || {};
    if (add.value === 'quest') Object.assign(entry.if, { quest: '', stage: 'none' });
    else if (add.value === 'flags') (entry.if.flags = entry.if.flags || []).push({ flag: '', scope: 'dialogue' });
    else entry.if[add.value] = '';
    touch();
    redraw();
  });
}

function bubbles(parent, lines, redraw) {
  lines.forEach((line, i) => {
    const b = el('div', `bubble ${line.who === 'player' ? 'player' : 'npc'}`, '', parent);
    const who = el('div', 'who', '', b);
    const whoSelect = el('select', '', '', who);
    for (const w of ['npc', 'player']) el('option', '', w === 'npc' ? 'They say' : 'You say', whoSelect).value = w;
    whoSelect.value = line.who || 'npc';
    whoSelect.addEventListener('change', () => {
      line.who = whoSelect.value;
      touch();
      redraw();
    });
    el('span', 'grow', '', who);
    button('↑', who, () => { lines.splice(i - 1, 0, lines.splice(i, 1)[0]); touch(); redraw(); }).disabled = i === 0;
    button('↓', who, () => { lines.splice(i + 1, 0, lines.splice(i, 1)[0]); touch(); redraw(); }).disabled = i === lines.length - 1;
    button('×', who, () => { lines.splice(i, 1); touch(); redraw(); });
    const area = el('textarea', '', '', b);
    area.value = line.text || '';
    area.rows = Math.max(2, Math.ceil((line.text || '').length / 100));
    const preview = el('div', 'preview', '', b);
    const show = () => (preview.textContent = area.value.includes('{') ? `Reads: ${fill(area.value)}` : '');
    show();
    area.addEventListener('input', () => {
      line.text = area.value;
      show();
      touch();
    });
  });
}

function effectEditor(parent, list, i, redraw) {
  const effect = list[i];
  const row = el('div', 'effect', '', parent);
  const kind = Object.keys(effect).find((k) => k in EFFECTS) || Object.keys(effect)[0];
  const select = el('select', '', '', row);
  for (const [k, e] of Object.entries(EFFECTS)) el('option', '', e.help, select).value = k;
  select.value = kind;
  select.addEventListener('change', () => {
    list[i] = { [select.value]: select.value === 'stage' ? ['', ''] : '' };
    touch();
    redraw();
  });
  const spec = EFFECTS[kind] || {};
  if (spec.pair) {
    const pair = Array.isArray(effect.stage) ? effect.stage : (effect.stage = ['', '']);
    refInput(row, pair[0], 'quests', (v) => { pair[0] = v; touch(); });
    stageSelect(row, pair[0], pair[1], (v) => { pair[1] = v; touch(); });
  } else if (spec.flag) {
    const mode = el('select', '', '', row);
    el('option', '', 'set', mode).value = '';
    el('option', '', 'clear', mode).value = 'clear';
    mode.value = effect.clear ? 'clear' : '';
    mode.addEventListener('change', () => {
      if (mode.value) effect.clear = true;
      else delete effect.clear;
      touch();
    });
    flagFields(row, effect, redraw);
  } else if (spec.ref) {
    refInput(row, effect[kind], spec.ref, (v) => { effect[kind] = v; touch(); });
  } else {
    const input = el(spec.long ? 'textarea' : 'input', '', '', row);
    input.value = effect[kind] || '';
    if (spec.long) input.rows = 2;
    input.addEventListener('input', () => { effect[kind] = input.value; touch(); });
  }
  if (kind === 'take' || kind === 'give') {
    el('span', 'muted small', '×', row);
    const count = el('input', '', '', row);
    count.type = 'number';
    count.min = 1;
    count.value = effect.count || 1;
    count.style.width = '50px';
    count.addEventListener('input', () => {
      if (Number(count.value) > 1) effect.count = Number(count.value);
      else delete effect.count;
      touch();
    });
  }
  if (kind === 'take') {
    el('span', 'muted small', 'unless flag', row);
    const unless = el('input', '', '', row);
    unless.value = effect.unless_flag || '';
    unless.style.width = '120px';
    unless.addEventListener('input', () => {
      if (unless.value) effect.unless_flag = unless.value;
      else delete effect.unless_flag;
      touch();
    });
  }
  button('×', row, () => { list.splice(i, 1); touch(); redraw(); });
}

/** The menu of [node] (an entry or a choice): its choices, each with its own sub-menu. */
function choices(parent, node, redraw, depth = 0) {
  const list = node.choices || [];
  list.forEach((choice, i) => {
    const box = el('div', 'choice', '', parent);
    if (depth) box.style.marginLeft = '24px';
    const head = el('div', 'row', '', box);
    el('b', '', '▸', head);
    const text = el('input', 'grow', '', head);
    text.value = choice.text || '';
    text.placeholder = 'What you can answer';
    text.addEventListener('input', () => { choice.text = text.value; touch(); });
    button('↑', head, () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); touch(); redraw(); }).disabled = i === 0;
    button('↓', head, () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); touch(); redraw(); }).disabled = i === list.length - 1;
    button('Copy', head, () => { list.splice(i + 1, 0, clone(choice)); touch(); redraw(); });
    button('×', head, () => {
      list.splice(i, 1);
      if (!list.length) delete node.choices;
      touch();
      redraw();
    });
    conditionEditor(box, choice, redraw, 'Shown', 'always');
    (choice.do || []).forEach((_, j) => effectEditor(box, choice.do, j, redraw));
    button('+ effect', box, () => {
      (choice.do = choice.do || []).push({ give: '' });
      touch();
      redraw();
    }, 'small');
    if ((choice.lines || []).length) {
      const said = el('div', '', '', box);
      bubbles(said, choice.lines, redraw);
    }
    button('+ response line', box, () => {
      (choice.lines = choice.lines || []).push({ who: 'npc', text: '' });
      touch();
      redraw();
    }, 'small');
    if ((choice.choices || []).length) {
      el('div', 'muted small', 'Then this menu:', box);
      choices(box, choice, redraw, depth + 1);
    } else {
      const then = el('div', 'effect', '', box);
      el('span', 'muted small', 'Then', then);
      const after = el('select', '', '', then);
      for (const [k, label] of Object.entries(AFTER)) el('option', '', label, after).value = k;
      after.value = choice.after || 'end';
      after.addEventListener('change', () => {
        if (after.value === 'end') delete choice.after;
        else choice.after = after.value;
        touch();
      });
      button('+ sub-menu', then, () => {
        delete choice.after;
        choice.choices = [{ text: '' }];
        touch();
        redraw();
      }, 'small');
    }
  });
  if (depth === 0 || list.length) {
    const add = button(depth ? '+ Choice in this menu' : '+ Choice', parent, () => {
      (node.choices = node.choices || []).push({ text: '' });
      touch();
      redraw();
    });
    add.style.marginLeft = `${60 + depth * 24}px`;
  }
}

export function dialogueView(main, id, dialogue) {
  const speakers = Object.values(Store.data(COLLECTIONS.npcs.file) || {}).filter((n) => n.talk === id).map((n) => n.display_name);
  el('div', 'subtitle', `${speakers.length ? `Spoken by ${speakers.join(', ')}.` : 'No NPC uses this yet (set an NPC\'s "talk" to this id).'} Entries are tried top to bottom; the first whose "when" holds is what they say. A choice can say something back and open its own menu, as deep as you like. Flags: world (shared), quest and player (per player, saved), dialogue (cleared when the talk ends). Text can use tokens like {npcs:foreman} or {area:undercroft}.`, main);
  const box = el('div', '', '', main);
  if (!dialogue.entries) dialogue.entries = [];
  const draw = () => {
    flagDatalist();
    box.innerHTML = '';
    dialogue.entries.forEach((entry, i) => {
      const card = el('div', 'card', '', box);
      card.style.maxWidth = '900px';
      const head = el('div', 'card-head', '', card);
      el('span', 'title', `Entry ${i + 1}`, head);
      button('↑', head, () => { dialogue.entries.splice(i - 1, 0, dialogue.entries.splice(i, 1)[0]); touch(); draw(); }).disabled = i === 0;
      button('↓', head, () => { dialogue.entries.splice(i + 1, 0, dialogue.entries.splice(i, 1)[0]); touch(); draw(); }).disabled = i === dialogue.entries.length - 1;
      button('Copy', head, () => { dialogue.entries.splice(i + 1, 0, clone(entry)); touch(); draw(); });
      button('Remove', head, () => {
        if (!confirm(`Remove entry ${i + 1}?`)) return;
        dialogue.entries.splice(i, 1);
        touch();
        draw();
      }, 'small danger');
      conditionEditor(card, entry, draw);
      bubbles(card, entry.lines || [], draw);
      button('+ Line', card, () => { (entry.lines = entry.lines || []).push({ who: 'npc', text: '' }); touch(); draw(); });
      choices(card, entry, draw);
    });
    button('+ Entry', box, () => {
      dialogue.entries.push({ lines: [{ who: 'npc', text: '' }] });
      touch();
      draw();
    });
  };
  draw();
}

