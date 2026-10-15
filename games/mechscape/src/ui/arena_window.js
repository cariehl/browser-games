// A boss's arena door (open_arena event): go in or out between fights, and
// from inside, wake the boss, easy or Overclocked. Its text is the boss's
// script's "text" in data/npcs.json. And the boss's
// HP bar across the top of the screen while you're fighting it.

import { ClientState } from '../client/client_state.js';
import { ArenaAction, Arena, bossText } from '../sim/boss.js';
import { Content } from '../sim/defs.js';
import { chebyshev } from '../sim/grid.js';
import { el } from './screen.js';
import { onEscape } from './common.js';

export class ArenaWindow {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'arena-window panel centered', '', parent);
    this.el.style.display = 'none';
    this._title = el('div', 'title', '', this.el);
    this._text = el('div', 'muted', '', this.el);
    this._buttons = el('div', 'arena-buttons', '', this.el);
    this._door = null;
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_arena') {
          const door = ClientState.world.stations.get(event.data.station);
          if (door) this.open(door);
        }
      }
      const me = ClientState.me();
      if (this._door && (!me || chebyshev(me.tile, this._door.tile) > 1)) this.close();
    });
    onEscape(30, () => this._door != null, () => this.close());
  }

  open(door) {
    this._door = door;
    const world = ClientState.world;
    const me = ClientState.me();
    const boss = Arena.bosses(world).find((b) => Arena.door(world, b) === door);
    if (!boss || !me) return;
    const inside = world.inZone(me.tile, boss.def.boss.zone);
    const fighting = (world.boss_fights || []).some((f) => f.id === boss.id);
    this._title.textContent = door.def.display_name;
    this._buttons.innerHTML = '';
    const button = (label, command, enabled = true) => {
      const b = el('button', '', label, this._buttons);
      b.disabled = !enabled;
      b.addEventListener('click', () => {
        this.link.send(ClientState.localPlayerId, new ArenaAction(door.id, command));
        this.close();
      });
    };
    if (fighting) {
      this._text.textContent = bossText(boss, inside ? 'door_fight_inside' : 'door_fight_outside');
    } else if (!inside) {
      this._text.textContent = bossText(boss, 'door_outside');
      button(bossText(boss, 'enter_button'), 'enter');
    } else {
      const unlocked = !!(me.unlocks && me.unlocks.overclocked);
      const unlockedBy = Object.values(Content.quests).find((q) => q.rewards && q.rewards.unlock === 'overclocked');
      this._text.textContent = boss.isDead()
        ? bossText(boss, 'rebuilding')
        : `${bossText(boss, 'door_inside')}${unlocked || !unlockedBy ? '' : ` Finish ${unlockedBy.display_name} to learn how to overclock it.`}`;
      if (!boss.isDead()) {
        button(`Wake the ${boss.def.display_name}`, 'easy');
        button('Wake it Overclocked', 'overclocked', unlocked);
      }
      button(bossText(boss, 'leave_button'), 'leave');
    }
    el('button', '', 'Close', this._buttons).addEventListener('click', () => this.close());
    this.el.style.display = '';
  }

  close() {
    this._door = null;
    this.el.style.display = 'none';
  }
}

/** The boss's name, HP and shield across the top while you're in its fight. */
export class BossBar {
  constructor(parent) {
    this.el = el('div', 'boss-bar', '', parent);
    this.el.style.display = 'none';
    this._name = el('div', 'boss-name', '', this.el);
    const track = el('div', 'boss-track', '', this.el);
    this._fill = el('div', 'boss-fill', '', track);
    this._tag = el('div', 'boss-tag', '', this.el);
  }

  update() {
    const world = ClientState.world;
    const me = ClientState.me();
    const fight = me && (world.boss_fights || []).find((f) => f.players.includes(me.id));
    const boss = fight && world.entities.get(fight.id);
    if (!boss) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    this._name.textContent = fight.name;
    this._fill.style.width = `${(100 * boss.hp) / Math.max(1, fight.max_hp)}%`;
    this._fill.classList.toggle('shielded', fight.shield);
    const phases = fight.mode === 'overclocked' ? `Phase ${fight.phase + 1} of 3` : '';
    this._tag.textContent = [phases, fight.shield ? 'Shielded: run the panels!' : ''].filter(Boolean).join('  ·  ');
  }
}
