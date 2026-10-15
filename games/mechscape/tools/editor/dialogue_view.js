// A character's dialogue as a conversation: entries tried top to bottom (the
// first whose "when" holds is what they say), each a run of speech bubbles
// and then the player's choices, each choice with what it does.

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
  flag: { help: 'set a world flag' },
  event: { help: 'fire a game event (mech_powerup...)' },
  say: { help: 'they reply with a line', long: true },
};

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

/** The "when" of an entry: quest at a stage, carrying an item, a flag set or not. */
function conditionEditor(parent, entry, redraw) {
  const box = el('div', 'cond', '', parent);
  el('b', '', 'When', box);
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
  if (!parts.length) el('span', 'muted', 'always', box);
  const add = el('select', '', '', box);
  el('option', '', '+ condition', add).value = '';
  for (const [k, label] of [['quest', 'quest stage'], ['has', 'carrying an item'], ['flag', 'flag set'], ['not_flag', 'flag not set']]) {
    if (!(k in cond)) el('option', '', label, add).value = k;
  }
  add.addEventListener('change', () => {
    entry.if = entry.if || {};
    if (add.value === 'quest') Object.assign(entry.if, { quest: '', stage: 'none' });
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
  } else if (spec.ref) {
    refInput(row, effect[kind], spec.ref, (v) => { effect[kind] = v; touch(); });
  } else {
    const input = el(spec.long ? 'textarea' : 'input', '', '', row);
    input.value = effect[kind] || '';
    if (spec.long) input.rows = 2;
    input.addEventListener('input', () => { effect[kind] = input.value; touch(); });
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

function choices(parent, entry, redraw) {
  (entry.choices || []).forEach((choice, i) => {
    const box = el('div', 'choice', '', parent);
    const head = el('div', 'row', '', box);
    el('b', '', '▸', head);
    const text = el('input', 'grow', '', head);
    text.value = choice.text || '';
    text.placeholder = 'What you can answer';
    text.addEventListener('input', () => { choice.text = text.value; touch(); });
    button('×', head, () => {
      entry.choices.splice(i, 1);
      if (!entry.choices.length) delete entry.choices;
      touch();
      redraw();
    });
    (choice.do || []).forEach((_, j) => effectEditor(box, choice.do, j, redraw));
    if (!(choice.do || []).length) el('div', 'muted small effect', 'Closes the conversation.', box);
    button('+ effect', box, () => {
      (choice.do = choice.do || []).push({ say: '' });
      touch();
      redraw();
    });
  });
  const add = button('+ Choice', parent, () => {
    (entry.choices = entry.choices || []).push({ text: '', do: [] });
    touch();
    redraw();
  });
  add.style.marginLeft = '60px';
}

export function dialogueView(main, id, dialogue) {
  const speakers = Object.values(Store.data(COLLECTIONS.npcs.file) || {}).filter((n) => n.talk === id).map((n) => n.display_name);
  el('div', 'subtitle', `${speakers.length ? `Spoken by ${speakers.join(', ')}.` : 'No NPC uses this yet (set an NPC\'s "talk" to this id).'} Entries are tried top to bottom; the first whose "when" holds is what they say. Text can use tokens like {npcs:foreman} or {area:undercroft}.`, main);
  const box = el('div', '', '', main);
  if (!dialogue.entries) dialogue.entries = [];
  const draw = () => {
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

