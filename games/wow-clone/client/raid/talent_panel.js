// The talent picker, shown when a raider first spawns: three trees, ten
// points, and no fighting until they're spent. Left-click a talent to add a
// point, right-click to take one back; "Fill" spends a ready-made build down
// one tree. The last build per class is remembered and offered next time.

import { ABILITIES, CLASSES } from '../../shared/classes.js';
import {
  canAddPoint, canRemovePoint, pointsInTree, pointsSpent, presetBuild, TALENT_POINTS, talentProblem, TIER_POINTS, TIERS, TREES,
} from '../../shared/talents.js';
import { el } from '../dom.js';
import { loadSetting, saveSetting } from '../net.js';

const savedKey = (role) => `raid.talents.${role}`;

/** A tooltip for a talent: what it does, and the ability it grants if any. */
function tooltip(talent) {
  const lines = [`${talent.name} (${talent.ranks} rank${talent.ranks > 1 ? 's' : ''})`, talent.desc];
  const grant = talent.effects.find((e) => e.type === 'grant');
  if (grant) {
    const a = ABILITIES[grant.ability];
    lines.push(`${a.cast ? `${a.cast} sec cast` : 'Instant'}${a.cooldown ? `, ${a.cooldown} sec cooldown` : ''}${a.range ? `, ${a.range} yd` : ''}`);
    lines.push(a.desc);
  }
  if (talent.tier) lines.push(`Needs ${talent.tier * TIER_POINTS} points above it in this tree.`);
  return lines.join('\n');
}

export class TalentPanel {
  picks = {};

  /** [onConfirm]: called with the picks when the player locks them in. */
  constructor(onConfirm) {
    this.onConfirm = onConfirm;
    this.root = el('div', 'panel talents');
    this.root.hidden = true;
    this.title = el('h1');
    this.left = el('p', 'muted');
    this.trees = el('div', 'trees');
    this.problem = el('p', 'error small');
    const reset = el('button', 'quiet', 'Reset');
    reset.onclick = () => {
      this.picks = {};
      this.render();
    };
    this.confirm = el('button', 'primary', 'Lock in and fight');
    this.confirm.onclick = () => {
      if (talentProblem(this.role, this.picks)) return;
      saveSetting(savedKey(this.role), this.picks);
      this.onConfirm({ ...this.picks });
    };
    const actions = el('div', 'actions');
    actions.append(reset, this.confirm);
    this.root.append(this.title, this.left, this.trees, this.problem, actions);
  }

  get open() {
    return !this.root.hidden;
  }

  /** Opens the picker for [role], starting from last time's build if it's still valid. */
  show(role) {
    if (this.open && this.role === role) return;
    this.role = role;
    const saved = loadSetting(savedKey(role), {});
    this.picks = talentProblem(role, saved) ? {} : saved;
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this.root.hidden = true;
  }

  render() {
    const role = this.role;
    const spent = pointsSpent(this.picks);
    this.title.textContent = `Choose your ${CLASSES[role].name} talents`;
    this.left.textContent = `${TALENT_POINTS - spent} of ${TALENT_POINTS} points left. Left-click to add a point, right-click to remove one. Your build is locked for this raid.`;
    this.trees.replaceChildren(...TREES[role].map((spec, index) => {
      const column = el('div', 'tree');
      column.style.setProperty('--tree', spec.color);
      const fill = el('button', 'quiet small', 'Fill');
      fill.title = `Spend all ${TALENT_POINTS} points down ${spec.name}`;
      fill.onclick = () => {
        this.picks = presetBuild(role, index);
        this.render();
      };
      const head = el('div', 'tree-head');
      head.append(el('span', 'tree-name', `${spec.name} (${pointsInTree(role, this.picks, index)})`), fill);
      column.append(head, el('p', 'muted small', spec.blurb));
      for (let tier = 0; tier < TIERS; tier++) {
        const row = el('div', 'tier');
        for (const talent of spec.talents.filter((x) => x.tier === tier)) row.append(this.talentButton(talent));
        column.append(row);
      }
      return column;
    }));
    const problem = talentProblem(role, this.picks);
    this.problem.textContent = spent === TALENT_POINTS ? (problem ?? '') : '';
    this.confirm.disabled = !!problem;
  }

  talentButton(talent) {
    const role = this.role;
    const rank = this.picks[talent.id] ?? 0;
    const capstone = talent.tier === TIERS - 1;
    const button = el('button', `talent${rank ? ' taken' : ''}${rank === talent.ranks ? ' maxed' : ''}${capstone ? ' capstone' : ''}`);
    const open = rank > 0 || canAddPoint(role, this.picks, talent.id);
    button.classList.toggle('locked', !open);
    button.append(el('span', 'talent-name', talent.name), el('span', 'talent-rank', `${rank}/${talent.ranks}`));
    button.title = tooltip(talent);
    button.onclick = () => {
      if (!canAddPoint(role, this.picks, talent.id)) return;
      this.picks = { ...this.picks, [talent.id]: rank + 1 };
      this.render();
    };
    button.oncontextmenu = (e) => {
      e.preventDefault();
      if (!canRemovePoint(role, this.picks, talent.id)) return;
      const picks = { ...this.picks, [talent.id]: rank - 1 };
      if (!picks[talent.id]) delete picks[talent.id];
      this.picks = picks;
      this.render();
    };
    return button;
  }
}
