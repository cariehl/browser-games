// Build mode: placing a hab piece from your inventory, or moving one you
// placed. A ghost of the piece follows the mouse, green where it can go and
// red where it can't (the same Hab.whyNot the server checks, run on the
// mirror), with the reason in the hint bar. Q turns it, C cycles its
// colour, a left click puts it down, and Esc or a right click cancels.

import { ClientState } from '../client/client_state.js';
import { Hab, PlacePieceAction, EditPieceAction } from '../sim/hab.js';
import { key } from '../sim/grid.js';
import { worldToTile } from '../view/tile_math.js';
import { isTyping } from '../view/camera_rig.js';
import { Screen, el } from './screen.js';
import { onEscape } from './common.js';

export class BuildMode {
  constructor(parent, link, ghost) {
    this.link = link;
    this.ghost = ghost;
    this.el = el('div', 'build-hint panel', '', parent);
    this.el.style.display = 'none';
    this._title = el('div', 'title', '', this.el);
    this._why = el('div', 'muted small', '', this.el);
    el('div', 'muted small', 'Click to place · Q turn · C colour · Esc cancel', this.el);
    /** { item, slot, piece, rotation, color } or null. */
    this._job = null;
    this._tile = null;
    this._cache = new Map();
    this._cacheTick = -1;
    window.addEventListener('keydown', (e) => {
      if (!this._job || e.repeat || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'q' || e.key === 'Q') this._job.rotation = (this._job.rotation + 1) % 4;
      else if (e.key === 'c' || e.key === 'C') {
        const colors = this._job.item.piece.colors || [this._job.color];
        this._job.color = colors[(colors.indexOf(this._job.color) + 1) % colors.length];
      } else return;
      e.preventDefault();
    });
    onEscape(40, () => this.active, () => this.cancel());
  }

  get active() {
    return this._job != null;
  }

  /** Place the piece in inventory slot [slot]. */
  place(slot) {
    const me = ClientState.me();
    const stack = me && me.inventory.slots[slot];
    if (!stack || stack.item.kind !== 'piece') return;
    const colors = stack.item.piece.colors || ['#c7ccd1'];
    this._start({ item: stack.item, slot, piece: null, rotation: 0, color: colors[0] });
  }

  /** Move [piece] somewhere else on the floor. */
  move(piece) {
    this._start({ item: piece.item, slot: -1, piece, rotation: piece.rotation, color: piece.color });
  }

  _start(job) {
    this._job = job;
    this._cache.clear();
    this._title.textContent = `${job.piece ? 'Moving' : 'Placing'}: ${job.item.display_name}`;
    this.el.style.display = '';
  }

  cancel() {
    this._job = null;
    this.ghost.hide();
    this.el.style.display = 'none';
  }

  /** Each frame, with the mouse position (or null over the UI). */
  update(x, y) {
    const job = this._job;
    if (!job) return;
    const me = ClientState.me();
    // The piece left your inventory (or the one you're moving went away): stop.
    if (!me || (job.piece ? !ClientState.world.pieces.has(job.piece.id) : !me.inventory.slots[job.slot] || me.inventory.slots[job.slot].item !== job.item)) {
      this.cancel();
      return;
    }
    const tile = x == null ? null : this._tileAt(x, y);
    this._tile = tile;
    if (!tile) {
      this.ghost.hide();
      return;
    }
    const why = this._whyNot(tile);
    this._why.textContent = why || 'It fits here.';
    this.ghost.show(job.item, job.color, tile, job.rotation, !why);
  }

  /** A click on the world while building. True if build mode took it. */
  click(button) {
    const job = this._job;
    if (!job) return false;
    if (button === 2) {
      this.cancel();
      return true;
    }
    if (button !== 0 || !this._tile) return true;
    // Sent even where it won't fit, so the server says why in the chat box.
    const ok = !this._whyNot(this._tile);
    const action = job.piece
      ? new EditPieceAction(job.piece.id, 'move', { tile: this._tile, rotation: job.rotation, color: job.color })
      : new PlacePieceAction(job.slot, this._tile, job.rotation, job.color);
    this.link.send(ClientState.localPlayerId, action);
    if (ok) this.cancel();
    return true;
  }

  /** Hab.whyNot on the mirror, cached for the tick (it flood-fills the hab). */
  _whyNot(tile) {
    const world = ClientState.world;
    if (world.tick !== this._cacheTick) {
      this._cache.clear();
      this._cacheTick = world.tick;
    }
    const k = key(tile);
    if (!this._cache.has(k)) this._cache.set(k, Hab.whyNot(world, this._job.item, tile, this._job.piece));
    return this._cache.get(k);
  }

  _tileAt(x, y) {
    const hit = Screen.groundPoint(Screen.ray(x, y));
    if (!hit) return null;
    const tile = worldToTile(hit);
    return ClientState.world.inBounds(tile) ? tile : null;
  }
}
