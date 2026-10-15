// The Quests tab: every quest, coloured by progress (red not started,
// yellow started, green done), and the journal for the one you pick.

import { Content } from '../sim/defs.js';
import { Quests } from '../sim/quests.js';
import { el } from './screen.js';

export class QuestJournal {
  constructor() {
    this.name = 'Quests';
    this._selected = null;
    this._key = '';
  }

  build(page) {
    page.classList.add('quests');
    this._list = el('div', 'quest-list', '', page);
    this._detail = el('div', 'quest-detail', '', page);
    this._log = el('div', 'quest-detail muted', '', page);
  }

  update(me) {
    const key = JSON.stringify([me.quests, me.survey_log, this._selected]);
    if (key === this._key) return;
    this._key = key;
    this._list.innerHTML = '';
    let done = 0;
    const quests = Object.values(Content.quests);
    for (const quest of quests) {
      const stage = Quests.stageOf(me, quest.id);
      if (stage === 'done') done++;
      const state = stage === 'none' ? 'not-started' : stage === 'done' ? 'done' : 'started';
      const row = el('button', `quest ${state}${this._selected === quest.id ? ' selected' : ''}`, quest.display_name + (quest.main ? '  (main)' : ''), this._list);
      row.addEventListener('click', () => {
        this._selected = this._selected === quest.id ? null : quest.id;
      });
    }
    el('div', 'muted small', `Quests done: ${done} / ${quests.length}`, this._list);
    const quest = this._selected && Content.quests[this._selected];
    this._detail.innerHTML = '';
    if (quest) {
      const stage = Quests.stageOf(me, quest.id);
      el('div', 'title', quest.display_name, this._detail);
      let text = quest.description;
      if (stage === 'done') text = `Quest complete! ${quest.rewards && quest.rewards.text ? `Reward: ${quest.rewards.text}.` : ''}`;
      else if (stage !== 'none') text = quest.stage(stage).journal;
      el('div', '', text, this._detail);
    } else {
      el('div', 'muted', 'Click a quest to read its journal. Talk to people around camp to start them.', this._detail);
    }
    this._log.textContent = me.survey_log && me.survey_log.length
      ? `Survey log: ${me.survey_log.map((id) => Content.stations[id] ? Content.stations[id].display_name : id).join(', ')}`
      : '';
  }
}
