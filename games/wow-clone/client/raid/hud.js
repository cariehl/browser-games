// The raid's HTML overlay: player, target and party frames, the action bar,
// the cast bar, error text, the death panel and the menu buttons. update()
// redraws it from the synced state every frame, touching the DOM only where
// something changed.

import { ABILITIES, CLASSES, isHarmful } from '../../shared/classes.js';
import { GCD } from '../../shared/combat.js';
import { ENEMY_KINDS } from '../../shared/enemies.js';
import { roleCss } from '../../shared/roles.js';
import { castTimeFor, cooldownFor, pointsInTree, talentStats, TREES } from '../../shared/talents.js';
import { el } from '../dom.js';
import { keyLabel } from '../keybinds.js';
import { loadSetting, saveSetting } from '../net.js';

/** Sets [node]'s text only when it differs (DOM writes are the cost here). */
function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function style(node, prop, value) {
  if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
}

function seconds(s) {
  return s >= 10 ? `${Math.ceil(s)}` : s.toFixed(1);
}

const barKey = (role) => `raid.bar.${role}`;

/** [abilities] in the saved bar order for [role]: saved ones first, new ones (from talents) after. */
function arrange(role, abilities) {
  const saved = loadSetting(barKey(role), []);
  const order = Array.isArray(saved) ? saved.filter((id) => abilities.includes(id)) : [];
  return [...new Set([...order, ...abilities])];
}

/** A raider's talent picks as a plain object. */
export function picksOf(raider) {
  return Object.fromEntries(raider.talents?.entries() ?? []);
}

/** The tree a raider put most points in ('' before they choose): their spec. */
function specOf(raider) {
  if (!raider.talentsChosen) return '';
  const picks = picksOf(raider);
  const trees = TREES[raider.role] ?? [];
  let best = null;
  for (const [i, tree] of trees.entries()) {
    const points = pointsInTree(raider.role, picks, i);
    if (!best || points > best.points) best = { name: tree.name, points };
  }
  return best?.name ?? '';
}

function percent(frac) {
  return `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
}

/** A unit frame: name, health bar, cast bar, auras and (for an enemy target) its threat list. */
class UnitFrame {
  auraKeys = '';

  constructor(className, onClick) {
    this.root = el('div', `unit-frame ${className}`);
    this.tag = el('span', 'tag');
    this.name = el('span', 'name');
    this.top = el('div', 'uf-top');
    this.top.append(this.tag, this.name);
    this.bar = el('div', 'uf-bar');
    this.fill = el('div', 'fill');
    this.hp = el('span', 'uf-text');
    this.bar.append(this.fill, this.hp);
    this.cast = el('div', 'uf-cast');
    this.castFill = el('div', 'fill');
    this.castText = el('span', 'uf-text');
    this.cast.append(this.castFill, this.castText);
    this.auras = el('div', 'uf-auras');
    this.threat = el('div', 'uf-threat');
    this.root.append(this.top, this.bar, this.cast, this.auras, this.threat);
    if (onClick) this.root.onclick = onClick;
  }

  /** Shows [unit] (hides the frame if null). [ctx]: { now, enemy, isMe, raiders }. */
  show(unit, { now, enemy, isMe = false, raiders }) {
    this.root.hidden = !unit;
    if (!unit) return;
    const dead = unit.health <= 0;
    this.root.classList.toggle('enemy', enemy);
    this.root.classList.toggle('dead', dead);
    this.root.classList.toggle('away', !enemy && !unit.connected);
    this.root.classList.toggle('me', isMe);
    text(this.name, unit.name);
    text(this.tag, enemy ? (ENEMY_KINDS[unit.kind]?.passive ? 'Dummy' : 'Enemy') : (specOf(unit) || (CLASSES[unit.role]?.name ?? unit.role)));
    style(this.tag, '--role', enemy ? '#7a2e26' : roleCss(unit.role));
    style(this.fill, 'width', percent(unit.health / unit.maxHealth));
    text(this.hp, dead ? 'Dead' : !enemy && !unit.connected ? 'Offline' : `${unit.health} / ${unit.maxHealth}`);

    this.cast.hidden = !unit.castAbility;
    if (unit.castAbility) {
      const total = unit.castEnd - unit.castStart;
      style(this.castFill, 'width', percent((now - unit.castStart) / total));
      text(this.castText, ABILITIES[unit.castAbility]?.name ?? '');
    }

    this.showAuras(unit, now);
    this.showThreat(enemy ? unit : null, raiders);
  }

  showAuras(unit, now) {
    const keys = [...unit.auras.keys()].join();
    if (keys !== this.auraKeys) {
      this.auraKeys = keys;
      this.auraNodes = [...unit.auras.values()].map((aura) => {
        const ability = ABILITIES[aura.ability];
        const node = el('span', `aura${isHarmful(aura.ability) ? ' harmful' : ''}`, ability?.icon ?? '?');
        node.style.setProperty('--c', ability?.color ?? '#666');
        node.title = ability ? `${ability.name}: ${ability.desc}` : aura.ability;
        const left = el('span', 'aura-time');
        node.append(left);
        return { node, left, aura };
      });
      this.auras.replaceChildren(...this.auraNodes.map((a) => a.node));
    }
    for (const a of this.auraNodes ?? []) text(a.left, seconds(Math.max(0, a.aura.ends - now)));
  }

  showThreat(enemy, raiders) {
    const rows = enemy ? [...enemy.threat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    const top = rows[0]?.[1] ?? 0;
    const summary = rows.map(([id, v]) => `${raiders.get(id)?.name ?? '?'}:${Math.round((v / top) * 100)}`).join(',');
    if (summary === this.threatSummary) return;
    this.threatSummary = summary;
    this.threat.replaceChildren(...rows.map(([id, v]) => {
      const raider = raiders.get(id);
      const row = el('div', 'threat-row');
      const name = el('span', '', raider?.name ?? '?');
      name.style.color = roleCss(raider?.role);
      row.append(name, el('span', 'muted', `${Math.round((v / top) * 100)}%`));
      return row;
    }));
    if (rows.length) this.threat.prepend(el('div', 'threat-title muted small', 'Threat'));
  }
}

export class Hud {
  /**
   * [handlers]: { cast(abilityId), target(id), release(), leave(), keybinds() }.
   * [keybinds]: the Keybinds, for the labels on the action bar.
   */
  constructor(keybinds, handlers) {
    this.keybinds = keybinds;
    this.handlers = handlers;
    this.root = el('div', 'hud');

    this.player = new UnitFrame('player-frame', () => handlers.target(this.myId));
    this.target = new UnitFrame('target-frame');
    this.party = el('div', 'party-frames');
    this.partyFrames = new Map();
    this.partyKey = '';
    const left = el('div', 'left-frames');
    left.append(this.player.root, this.party);

    this.bar = el('div', 'action-bar');
    this.slots = [];
    this.castBar = el('div', 'cast-bar');
    this.castFill = el('div', 'fill');
    this.castName = el('span', 'cast-name');
    this.castTime = el('span', 'cast-time');
    this.castBar.append(this.castFill, this.castName, this.castTime);

    this.error = el('div', 'error-text');
    this.banner = el('div', 'banner');

    this.deadPanel = el('div', 'dead-panel');
    const release = el('button', 'primary', 'Release');
    release.onclick = () => handlers.release();
    this.deadPanel.append(el('p', '', 'You died.'), release);

    const menu = el('div', 'menu');
    const keys = el('button', 'quiet', 'Keybindings');
    keys.onclick = () => handlers.keybinds();
    const leave = el('button', 'quiet', 'Leave raid');
    leave.onclick = () => handlers.leave();
    menu.append(keys, leave);

    this.help = el('div', 'help muted small');

    this.root.append(left, this.target.root, this.bar, this.castBar, this.error, this.banner, this.deadPanel, menu, this.help);
  }

  /**
   * Builds the action bar from [me]'s abilities, with talents in the
   * tooltips. Shift-click (or shift-drag) a button to pick it up, then click
   * another slot to swap them; the order is saved per class.
   */
  setAbilities(me) {
    const picks = picksOf(me);
    const key = `${[...me.abilities].join()}|${JSON.stringify(picks)}`;
    if (this.barKey === key) return;
    this.barKey = key;
    this.role = me.role;
    this.stats = talentStats(me.role, picks);
    this.drawBar(arrange(me.role, [...me.abilities]));
  }

  drawBar(order) {
    this.drop();
    this.slots = order.map((id, i) => {
      const ability = ABILITIES[id];
      const slot = el('button', 'slot');
      slot.style.setProperty('--c', ability.color);
      const cast = castTimeFor(this.stats, id);
      const cooldown = cooldownFor(this.stats, id);
      const timing = [cast ? `${cast} sec cast` : 'Instant', cooldown ? `${cooldown} sec cooldown` : ''].filter(Boolean).join(', ');
      slot.title = `${ability.name}\n${timing}${ability.range ? `, ${ability.range} yd range` : ''}\n${ability.desc}\nShift-click to move.`;
      const icon = el('span', 'icon', ability.icon);
      const key = el('span', 'key');
      const cd = el('span', 'cd');
      const cdText = el('span', 'cd-text');
      slot.append(icon, cd, cdText, key);
      slot.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (this.held != null) {
          this.place(i);
        } else if (e.shiftKey) {
          this.held = i;
          slot.classList.add('held');
          this.bar.classList.add('placing');
        } else {
          return;
        }
        this.skipClick = true;
      };
      // Shift-drag: let go over another slot to put it there.
      slot.onmouseup = (e) => {
        if (e.button === 0 && this.held != null && this.held !== i) this.place(i);
      };
      slot.onclick = () => {
        if (this.skipClick) this.skipClick = false;
        else this.handlers.cast(id);
      };
      return { id, action: `action${i + 1}`, slot, key, cd, cdText };
    });
    this.bar.replaceChildren(...this.slots.map((s) => s.slot));
  }

  /** Puts the held ability in slot [i], swapping with what's there, and saves the order. */
  place(i) {
    const from = this.held;
    this.drop();
    if (from === i) return;
    const order = this.slots.map((s) => s.id);
    [order[from], order[i]] = [order[i], order[from]];
    saveSetting(barKey(this.role), order);
    this.drawBar(order);
  }

  /** Puts down a picked-up ability without moving it. Returns true if one was held. */
  drop() {
    if (this.held == null) return false;
    this.slots[this.held]?.slot.classList.remove('held');
    this.bar.classList.remove('placing');
    this.held = null;
    return true;
  }

  /** The ability in action bar slot [i] (from 0), if any. */
  abilityAt(i) {
    return this.slots[i]?.id;
  }

  /** Lights up a slot as if pressed. */
  flash(abilityId) {
    const slot = this.slots.find((s) => s.id === abilityId)?.slot;
    if (!slot) return;
    slot.classList.remove('pressed');
    void slot.offsetWidth; // Restart the animation.
    slot.classList.add('pressed');
  }

  showError(message) {
    this.error.textContent = message;
    this.error.classList.remove('fade');
    void this.error.offsetWidth;
    this.error.classList.add('fade');
  }

  /**
   * Redraws from the state. [ctx]: { state, myId, targetId, now,
   * blocker(abilityId) -> why it can't be used now, or null }.
   */
  update({ state, myId, targetId, now, blocker }) {
    this.myId = myId;
    const me = state.raiders.get(myId);
    if (!me) return;
    this.setAbilities(me);
    const raiders = state.raiders;
    this.player.show(me, { now, enemy: false, isMe: true, raiders });

    const enemy = state.enemies.get(targetId);
    const target = enemy ?? raiders.get(targetId) ?? null;
    this.target.show(target, { now, enemy: !!enemy, isMe: targetId === myId, raiders });
    this.target.root.classList.toggle('attacking', !!enemy && me.attacking);

    this.updateParty(raiders, myId, targetId, now);
    this.updateBar(me, now, blocker);

    this.castBar.hidden = !me.castAbility;
    if (me.castAbility) {
      style(this.castFill, 'width', percent((now - me.castStart) / (me.castEnd - me.castStart)));
      text(this.castName, ABILITIES[me.castAbility]?.name ?? '');
      text(this.castTime, seconds(Math.max(0, me.castEnd - now)));
    }
    this.deadPanel.hidden = me.health > 0;

    const k = (action) => keyLabel(this.keybinds.keyFor(action));
    text(this.help, `${k('forward')}${k('turnLeft')}${k('back')}${k('turnRight')} move · ${k('strafeLeft')}/${k('strafeRight')} strafe · right-drag to steer · ${k('autorun')} autorun · ${k('targetNext')} or click to target, right-click to attack · ${k('action1')}–${k(`action${Math.max(1, this.slots.length)}`)} abilities`);
  }

  updateParty(raiders, myId, targetId, now) {
    const ids = [...raiders.keys()].filter((id) => id !== myId);
    const key = ids.join();
    if (key !== this.partyKey) {
      this.partyKey = key;
      this.partyFrames = new Map(ids.map((id) => [id, this.partyFrames.get(id) ?? new UnitFrame('party-frame', () => this.handlers.target(id))]));
      this.party.replaceChildren(...[...this.partyFrames.values()].map((f) => f.root));
    }
    for (const [id, frame] of this.partyFrames) {
      frame.show(raiders.get(id), { now, enemy: false, raiders });
      frame.root.classList.toggle('selected', id === targetId);
    }
    this.player.root.classList.toggle('selected', myId === targetId);
  }

  updateBar(me, now, blocker) {
    for (const s of this.slots) {
      const ability = ABILITIES[s.id];
      text(s.key, keyLabel(this.keybinds.keyFor(s.action)));
      // Whichever of the cooldown and the GCD ends later is what the sweep shows.
      let left = 0;
      let total = 1;
      const cd = (me.cooldowns.get(s.id) ?? 0) - now;
      if (cd > 0) [left, total] = [cd, cooldownFor(this.stats, s.id) || cd];
      const gcd = me.gcdEnd - now;
      if (ability.gcd !== false && gcd > left) [left, total] = [gcd, GCD];
      style(s.cd, '--sweep', left > 0 ? `${(left / total) * 360}deg` : '0deg');
      text(s.cdText, cd > GCD && cd >= left - 1e-6 ? seconds(cd) : '');
      s.slot.classList.toggle('unusable', !!blocker(s.id));
      // On its own cooldown (not just the GCD): grey and faded until ready.
      s.slot.classList.toggle('cooling', cd > 0);
      s.slot.classList.toggle('active', me.castAbility === s.id);
      s.slot.classList.toggle('queued', me.queued === s.id);
    }
  }
}
