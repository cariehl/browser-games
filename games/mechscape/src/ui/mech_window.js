// The mech's two screens:
//
// - The gantry console / repair rig window (open_mech event): the
//   blueprint's components, what's installed and who installed it, an
//   Install button for each part you carry, and the mech's state with
//   Deploy, Recall and Service. The repair rig shows only the service part.
// - The cockpit readout, shown while you're aboard: your seat, the mech's
//   HP, fuel and ammo, and Climb out.

import { ClientState } from '../client/client_state.js';
import { Content, StationKind } from '../sim/defs.js';
import { Mechs, InstallComponentAction, MechCommandAction, LeaveMechAction, BoardAction } from '../sim/mech.js';
import { el } from './screen.js';
import { onEscape } from './common.js';

export class MechWindow {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'mech-window panel centered', '', parent);
    this.el.style.display = 'none';
    const header = el('div', 'row', '', this.el);
    this._title = el('div', 'title grow', '', header);
    el('button', '', 'Close', header).addEventListener('click', () => this.close());
    this._body = el('div', 'mech-body', '', this.el);
    this._station = null;
    this._key = '';
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.entity === ClientState.localPlayerId && event.type === 'open_mech') {
          const station = ClientState.world.stations.get(event.data.station);
          if (station) this.open(station);
        }
      }
      if (!this._station) return;
      const me = ClientState.me();
      if (!me || !this._station.isAdjacent(me.tile)) {
        this.close();
        return;
      }
      this._refresh();
    });
    onEscape(30, () => this._station != null, () => this.close());
  }

  open(station) {
    this._station = station;
    this._key = '';
    this.el.style.display = '';
    this._refresh();
  }

  close() {
    this._station = null;
    this.el.style.display = 'none';
  }

  _send(action) {
    this.link.send(ClientState.localPlayerId, action);
  }

  _refresh() {
    const world = ClientState.world;
    const me = ClientState.me();
    const station = this._station;
    const def = Mechs.defFor(station);
    const build = world.mech_builds && world.mech_builds[def.id];
    if (!build || !me) return;
    const mech = build.mech_id >= 0 ? world.entities.get(build.mech_id) : null;
    const inv = me.inventory.slots.map((s) => (s ? `${s.item.id}:${s.count}` : '')).join(',');
    const key = JSON.stringify([build, mech && [mech.hp, mech.tile], inv, world.flags]);
    if (key === this._key) return;
    this._key = key;
    const atGantry = station.def.kind === StationKind.GANTRY;
    this._title.textContent = atGantry ? `${def.display_name}: gantry console` : station.def.display_name;
    const body = this._body;
    body.innerHTML = '';

    if (atGantry) {
      if (!world.flags.blueprint_loaded) {
        el('div', 'muted', 'No blueprint loaded. Foreman Ada says the last one is in the warden\'s vault, deep in the Undercroft.', body);
      } else {
        el('div', 'muted small', 'Every part has to be made and installed. Anyone can install anything.', body);
        const list = el('div', 'mech-parts', '', body);
        for (const { item, count } of def.components) {
          const have = build.installed[item.id] || 0;
          const row = el('div', `row mech-part ${have >= count ? 'done' : ''}`, '', list);
          el('span', 'grow', `${item.display_name}${count > 1 ? ` ×${count}` : ''}`, row);
          el('span', have >= count ? 'good' : 'muted', `${have}/${count}`, row);
          const carried = me.inventory.countOf(item);
          if (have < count && carried > 0) {
            el('button', '', 'Install', row).addEventListener('click', () => this._send(new InstallComponentAction(station.id, item.id)));
          } else {
            const recipe = Object.values(Content.recipes).find((r) => r.output === item);
            if (recipe && have < count) el('span', 'muted small', `${recipe.skill} ${recipe.level_required}`, row);
          }
        }
        if (build.contributors.length) {
          const crew = {};
          for (const c of build.contributors) crew[c.name] = (crew[c.name] || 0) + 1;
          el('div', 'muted small', `Built by ${Object.entries(crew).map(([n, k]) => `${n} (${k})`).join(', ')}`, body);
        }
      }
    }

    if (mech) {
      el('hr', '', '', body);
      const parked = Mechs.parked(world, def, mech);
      el('div', '', `${def.display_name}: ${parked ? 'on the pad' : 'in the Deadfields'}`, body);
      const stats = el('div', 'mech-stats', '', body);
      el('div', '', `HP ${mech.hp}/${mech.maxHp()}`, stats);
      el('div', '', `Fuel ${mech.fuel}/${def.tank}`, stats);
      el('div', '', `Ammo ${mech.ammo}/${def.magazine}`, stats);
      const buttons = el('div', 'row', '', body);
      const command = (label, cmd) => el('button', '', label, buttons).addEventListener('click', () => this._send(new MechCommandAction(station.id, cmd)));
      if (atGantry && parked) command(world.flags.mech_powered ? 'Deploy' : 'Deploy (needs powering up)', 'deploy');
      if (atGantry && !parked) command('Recall to the pad', 'recall');
      command('Service', 'service');
      el('div', 'muted small', `Service loads your ${[def.repair_item, def.fuel_item, def.ammo_item].map((i) => i.display_name.toLowerCase()).join(', ')}: repairs, fuel and ammo.`, body);
    } else if (!atGantry) {
      el('div', 'muted', 'There is no mech in the field to service.', body);
    }
  }
}

/** The cockpit readout while you're aboard. */
export class MechHud {
  constructor(parent, link) {
    this.link = link;
    this.el = el('div', 'mech-hud panel', '', parent);
    this.el.style.display = 'none';
    this._text = el('div', '', '', this.el);
    const buttons = el('div', 'row', '', this.el);
    this._swap = el('button', '', '', buttons);
    this._swap.addEventListener('click', () => {
      const me = ClientState.me();
      if (me && me.riding) this.link.send(ClientState.localPlayerId, new BoardAction(me.riding.mech, me.riding.seat === 'pilot' ? 'gunner' : 'pilot'));
    });
    el('button', '', 'Climb out', buttons).addEventListener('click', () => this.link.send(ClientState.localPlayerId, new LeaveMechAction()));
    this._key = '';
  }

  update() {
    const me = ClientState.me();
    const mech = me && me.riding ? ClientState.world.entities.get(me.riding.mech) : null;
    if (!mech) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    const def = mech.mech;
    const crew = ['pilot', 'gunner'].map((seat) => {
      const p = ClientState.world.entities.get(mech.crew[seat]);
      return `${seat === 'pilot' ? 'Pilot' : 'Gunner'}: ${p ? p.display_name : 'empty'}`;
    }).join('  ·  ');
    const key = `${me.riding.seat}|${mech.hp}|${mech.fuel}|${mech.ammo}|${crew}`;
    if (key === this._key) return;
    this._key = key;
    const low = (v, max) => (v <= max * 0.2 ? ' warn' : '');
    this._text.innerHTML = '';
    el('div', 'title', def ? def.display_name : 'Mech', this._text);
    el('div', 'muted small', crew, this._text);
    const stats = el('div', 'mech-stats', '', this._text);
    el('div', low(mech.hp, mech.maxHp()).trim(), `HP ${mech.hp}/${mech.maxHp()}`, stats);
    if (def) {
      el('div', low(mech.fuel, def.tank).trim(), `Fuel ${mech.fuel}/${def.tank}`, stats);
      el('div', low(mech.ammo, def.magazine).trim(), `Ammo ${mech.ammo}/${def.magazine}`, stats);
    }
    this._swap.textContent = me.riding.seat === 'pilot' ? "Gunner's seat" : "Pilot's seat";
  }
}
