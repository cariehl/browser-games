// A quest's page: its name and blurb, its stages in order (journal text, the
// goal that moves it on, and which dialogue moves it on), and its rewards.

import { Store } from './store.js';
import { COLLECTIONS, defaultsOf, nameOf, fill } from './schema.js';
import { objectFields } from './forms.js';
import { el, button, clone } from './ui.js';

const GOALS = {
  talk: { help: 'Moved on by a dialogue choice ({ "stage": [quest, stage] } or "complete").', start: {} },
  visit: { help: 'Be in an area.', start: { area: '' } },
  have: { help: 'Carry one of each item.', start: { items: [''] } },
  flag: { help: 'A world flag is set (mech_complete, blueprint_loaded...).', start: { flag: '' } },
  kill: { help: 'Help kill this many (any damage counts).', start: { npc: '', count: 1 } },
  scan: { help: 'Landmarks in the survey log.', start: { count: 1 } },
  all: { help: 'Every one of these.', start: { goals: [{ type: 'visit', area: '' }] } },
};

/** Dialogue that starts the quest or moves it to [stageId]: ["Foreman Ada: “I'll find your blueprint.”"]. */
function movedOnBy(questId, stageId, first) {
  const out = [];
  for (const [talkId, d] of Object.entries(Store.data(COLLECTIONS.dialogue.file) || {})) {
    for (const entry of d.entries || []) {
      for (const choice of entry.choices || []) {
        for (const effect of choice.do || []) {
          const hit = (first && effect.start === questId) || (Array.isArray(effect.stage) && effect.stage[0] === questId && effect.stage[1] === stageId);
          if (hit) out.push(`${nameOf('dialogue', talkId)}: “${choice.text}”`);
        }
      }
    }
  }
  return out;
}

function goalEditor(parent, goal, ctx) {
  const box = el('div', '', '', parent);
  const draw = () => {
    box.innerHTML = '';
    const row = el('div', 'row', '', box);
    const type = el('select', '', '', row);
    for (const t of Object.keys(GOALS)) el('option', '', t, type).value = t;
    type.value = goal.type;
    el('span', 'muted small', (GOALS[goal.type] || {}).help || '', row);
    type.addEventListener('change', () => {
      for (const k of Object.keys(goal)) delete goal[k];
      Object.assign(goal, { type: type.value }, clone(GOALS[type.value].start));
      Store.touch(ctx.file);
      draw();
    });
    if (goal.type === 'all') {
      (goal.goals || []).forEach((sub, i) => {
        const card = el('div', 'card', '', box);
        const head = el('div', 'card-head', '', card);
        el('span', 'title', `Goal ${i + 1}`, head);
        button('Remove', head, () => {
          goal.goals.splice(i, 1);
          Store.touch(ctx.file);
          draw();
        }, 'small danger');
        goalEditor(card, sub, { ...ctx, path: [...ctx.path, 'goals', i] });
      });
      button('+ Goal', box, () => {
        goal.goals.push({ type: 'visit', area: '' });
        Store.touch(ctx.file);
        draw();
      });
    } else {
      const fields = el('div', 'nested', '', box);
      objectFields(fields, goal, { ...ctx, hide: ['type'], noAdd: true, rerender: draw });
    }
  };
  draw();
}

export function questView(main, coll, id, quest) {
  const file = COLLECTIONS.quests.file;
  const head = el('div', 'form', '', main);
  objectFields(head, quest, { file, coll, path: [id], defaults: defaultsOf(coll), hide: ['stages', 'rewards'], noAdd: true, rerender: () => {} });

  el('h3', '', 'Stages', main);
  el('div', 'subtitle small', 'In order. A stage moves on to its "next" when its goal is met; talk stages are moved on by dialogue.', main);
  const stagesBox = el('div', 'form', '', main);
  quest.stages = quest.stages || [];
  const draw = () => {
    stagesBox.innerHTML = '';
    quest.stages.forEach((stage, i) => {
      const card = el('div', 'card', '', stagesBox);
      const top = el('div', 'card-head', '', card);
      el('span', 'title', `${i + 1}. ${stage.id}`, top);
      button('↑', top, () => move(i, -1)).disabled = i === 0;
      button('↓', top, () => move(i, 1)).disabled = i === quest.stages.length - 1;
      button('Remove', top, () => {
        if (!confirm(`Remove stage "${stage.id}"?`)) return;
        quest.stages.splice(i, 1);
        Store.touch(file);
        draw();
      }, 'small danger');
      const by = movedOnBy(id, stage.id, i === 0);
      if (by.length) el('div', 'muted small', `${i === 0 ? 'Started' : 'Reached'} by: ${by.join(' · ')}`, card);

      const grid = el('div', 'nested', '', card);
      const field = (label, build) => {
        const row = el('div', 'field', '', grid);
        el('div', 'label', '', row).appendChild(el('div', 'name', label));
        build(el('div', 'value', '', row));
      };
      field('id', (v) => {
        const input = el('input', '', '', v);
        input.value = stage.id;
        input.addEventListener('change', () => {
          const old = stage.id;
          stage.id = input.value.trim();
          for (const s of quest.stages) if (s.next === old) s.next = stage.id;
          Store.touch(file);
          draw();
        });
      });
      field('journal', (v) => {
        const area = el('textarea', '', '', v);
        area.value = stage.journal || '';
        const preview = el('div', 'preview', '', v);
        const show = () => (preview.textContent = area.value.includes('{') ? `Reads: ${fill(area.value)}` : '');
        show();
        area.addEventListener('input', () => {
          stage.journal = area.value;
          show();
          Store.touch(file);
        });
      });
      field('goal', (v) => {
        stage.goal = stage.goal || { type: 'talk' };
        goalEditor(v, stage.goal, { file, path: [id, 'stages', i, 'goal'] });
      });
      field('next', (v) => {
        const select = el('select', '', '', v);
        el('option', '', '(none: waits for dialogue)', select).value = '';
        for (const s of quest.stages) if (s !== stage) el('option', '', s.id, select).value = s.id;
        select.value = stage.next || '';
        select.addEventListener('change', () => {
          if (select.value) stage.next = select.value;
          else delete stage.next;
          Store.touch(file);
        });
      });
    });
    button('+ Stage', stagesBox, () => {
      quest.stages.push({ id: `stage_${quest.stages.length + 1}`, journal: '', goal: { type: 'talk' } });
      Store.touch(file);
      draw();
    });
  };
  const move = (i, d) => {
    const [s] = quest.stages.splice(i, 1);
    quest.stages.splice(i + d, 0, s);
    Store.touch(file);
    draw();
  };
  draw();

  el('h3', '', 'Rewards', main);
  el('div', 'subtitle small', 'xp: skill → amount. unlock: an unlock id the code checks ("overclocked"). text: what the completion message says you get.', main);
  quest.rewards = quest.rewards || {};
  const rewards = el('div', 'form', '', main);
  objectFields(rewards, quest.rewards, { file, path: [id, 'rewards'], rerender: () => {} });
}
