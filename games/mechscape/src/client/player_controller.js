// Turns mouse and keyboard input into Actions for the local player.
//
// The mouse picks what's under it by hitbox (NPCs, gather nodes, stations,
// items on the ground), falling back to the ground tile. Each target has a
// list of options, OSRS style: the first is what a left click does and what
// the hover text shows; a right click opens the whole list. Plain ground
// and walls have no hover text, only "Walk here".
//
// It never changes the World directly: it only sends actions through the
// link, and the GameLoop applies them on the tick after they arrive.
// Swapping the simulated link for a real socket is the whole multiplayer
// port on this side.

import { ClientState } from './client_state.js';
import { MoveAction, AttackAction, InteractAction, TakeAction, SetRunAction, TradeRequestAction } from '../sim/actions.js';
import { GatherNode, Station, Wreck } from '../sim/objects.js';
import { capitalize } from '../sim/skills.js';
import { Hitbox, HitboxKind } from '../view/hitbox.js';
import { worldToTile } from '../view/tile_math.js';
import { isTyping } from '../view/camera_rig.js';
import { Screen } from '../ui/screen.js';
import { TalkAction } from '../sim/quests.js';
import { BoardAction, LeaveMechAction } from '../sim/mech.js';
import { NPC_COLOR, OBJECT_COLOR, ITEM_COLOR, PLAYER_COLOR } from '../ui/common.js';
import { InspectInfo } from '../ui/inspect_info.js';


export class PlayerController {
  constructor(canvas, { link, marker, hover, menu, inspector }) {
    this.canvas = canvas;
    this.link = link;
    this.marker = marker;
    this.hover = hover;
    this.menu = menu;
    this.inspector = inspector;
    this._mouse = null;
    this._overUi = false;

    window.addEventListener('pointermove', (e) => {
      this._mouse = [e.clientX, e.clientY];
      this._overUi = e.target !== canvas;
    });
    canvas.addEventListener('pointerleave', () => {
      this._overUi = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      // Clicking the world takes focus away from any text box, so keys (arrows, R) go back to the game.
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (e.button === 0) {
        const first = this.allOptions(e.clientX, e.clientY).find((o) => !o.rightOnly);
        if (first.action) first.action();
      } else if (e.button === 2) {
        this.menu.open(this.allOptions(e.clientX, e.clientY), e.clientX, e.clientY);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') {
        const me = ClientState.me();
        if (me) this.link.send(ClientState.localPlayerId, new SetRunAction(!me.running));
      }
    });
  }

  update() {
    if (!this._mouse) return;
    const [x, y] = this._mouse;
    if (this.menu.isOpen()) {
      this.hover.hide();
      return;
    }
    if (this._overUi) {
      // Over the UI: show what the UI asked for (an inventory item), if anything.
      const ui = this.hover.uiOption();
      if (ui) this.hover.show(ui.option, ui.more, x, y, ui.detail);
      else this.hover.hide();
      return;
    }
    const options = this.targetOptions(x, y);
    // Walk here and Cancel are always there; they don't count as "more".
    if (options.length && options[0].rightOnly) this.hover.show({ verb: 'Walk here' }, options.length, x, y);
    else if (options.length) this.hover.show(options[0], options.length - 1, x, y);
    else this.hover.hide();
  }

  /** Every option at a screen position: the target's own, then "Walk here" (over the map) and "Cancel". */
  allOptions(x, y) {
    const options = this.targetOptions(x, y);
    const tile = this._groundTile(x, y);
    if (tile) options.push({ verb: 'Walk here', action: () => this._walk(tile) });
    options.push({ verb: 'Cancel', action: null });
    return options;
  }

  /** Options for whatever hitbox is under the mouse, or [] for none. */
  targetOptions(x, y) {
    const hitbox = Hitbox.pick(Screen.ray(x, y));
    if (!hitbox) return [];
    const world = ClientState.world;
    if (hitbox.kind === HitboxKind.NPC) {
      const npc = world.entities.get(hitbox.targetId);
      if (!npc || npc.isDead()) return [];
      const name = npc.def.display_name;
      if (npc.def.brain === 'mech') return this._mechOptions(npc);
      if (!npc.def.attackable) {
        if (!npc.def.talk) return [];
        return [{ verb: 'Talk-to', target: name, color: NPC_COLOR, action: () => this._talk(npc.id) }];
      }
      return [
        { verb: 'Attack', target: name, color: NPC_COLOR, action: () => this._attack(npc.id) },
        { verb: 'Inspect', target: name, color: NPC_COLOR, action: () => this._inspect(() => InspectInfo.npc(ClientState.world, npc, ClientState.me()), x, y) },
      ];
    }
    if (hitbox.kind === HitboxKind.PLAYER) {
      const other = world.entities.get(hitbox.targetId);
      if (!other || other.id === ClientState.localPlayerId) return [];
      const name = other.display_name;
      // Right-click only: a left click on a player walks, like OSRS.
      return [
        { verb: 'Trade with', target: name, color: PLAYER_COLOR, action: () => this._trade(other.id), rightOnly: true },
      ];
    }
    if (hitbox.kind === HitboxKind.OBJECT) {
      const object = world.getObject(hitbox.targetId);
      if (!object) return [];
      const name = object.displayName();
      let verb = 'Use';
      let inspect = null;
      if (object instanceof GatherNode) {
        verb = capitalize(object.def.verb);
        inspect = () => InspectInfo.gatherNode(ClientState.world, object, ClientState.me());
      } else if (object instanceof Wreck) {
        verb = 'Salvage';
        inspect = () => InspectInfo.wreck(ClientState.world, object);
      } else if (object instanceof Station) {
        inspect = () => InspectInfo.station(ClientState.world, object);
      }
      return [
        { verb, target: name, color: OBJECT_COLOR, action: () => this._interact(object.id) },
        { verb: 'Inspect', target: name, color: OBJECT_COLOR, action: () => this._inspect(inspect, x, y) },
      ];
    }
    if (hitbox.kind === HitboxKind.ITEM) {
      const picked = world.ground_items.get(hitbox.targetId);
      if (!picked) return [];
      // The one under the mouse first, then everything else on the tile, like OSRS listing a whole pile.
      const pile = [picked, ...world.groundItemsAt(picked.tile).filter((g) => g !== picked)];
      const options = pile.map((ground) => ({ verb: 'Take', target: groundName(ground), color: ITEM_COLOR, action: () => this._take(ground.id) }));
      options.push({ verb: 'Inspect', target: picked.item.display_name, color: ITEM_COLOR, action: () => this.inspector.open(() => InspectInfo.item(picked.item, ClientState.me()), x, y, false) });
      return options;
    }
    return [];
  }

  /** Climb in (either seat), swap seats, or climb out. */
  _mechOptions(mech) {
    const me = ClientState.me();
    const name = mech.def.display_name;
    const send = (action) => () => this.link.send(ClientState.localPlayerId, action);
    const seatName = { pilot: "Pilot's seat", gunner: "Gunner's seat" };
    if (me && me.riding && me.riding.mech === mech.id) {
      const other = me.riding.seat === 'pilot' ? 'gunner' : 'pilot';
      return [
        { verb: 'Climb out of', target: name, color: NPC_COLOR, action: send(new LeaveMechAction()) },
        { verb: `Move to the ${other}'s seat of`, target: name, color: NPC_COLOR, action: send(new BoardAction(mech.id, other)) },
      ];
    }
    return ['pilot', 'gunner'].map((seat) => ({
      verb: 'Board', target: `${name} (${seatName[seat]})`, color: NPC_COLOR,
      action: () => {
        this.marker.showAt(mech.tile, false);
        this.link.send(ClientState.localPlayerId, new BoardAction(mech.id, seat));
      },
    }));
  }

  _talk(npcId) {
    const npc = ClientState.world.entities.get(npcId);
    if (!npc) return;
    this.marker.showAt(npc.tile, false);
    this.link.send(ClientState.localPlayerId, new TalkAction(npcId));
  }

  _trade(playerId) {
    this.link.send(ClientState.localPlayerId, new TradeRequestAction(playerId));
  }

  _inspect(source, x, y) {
    if (source) this.inspector.open(source, x, y);
  }

  _take(groundId) {
    const ground = ClientState.world.ground_items.get(groundId);
    if (!ground) return;
    this.marker.showAt(ground.tile, false);
    this.link.send(ClientState.localPlayerId, new TakeAction(groundId));
  }

  _attack(npcId) {
    const npc = ClientState.world.entities.get(npcId);
    if (!npc) return;
    this.marker.showAt(npc.tile, false);
    this.link.send(ClientState.localPlayerId, new AttackAction(npcId));
  }

  _interact(objectId) {
    const object = ClientState.world.getObject(objectId);
    if (!object) return;
    // Instant, purely cosmetic feedback, shown before the action is even
    // sent: latency feels fine as long as something responds the frame you
    // click. Red for interacting, like OSRS.
    this.marker.showAt(object.tile, false);
    this.link.send(ClientState.localPlayerId, new InteractAction(objectId));
  }

  _walk(tile) {
    // Yellow for walking, red for a tile you can't walk onto.
    this.marker.showAt(tile, ClientState.world.isWalkable(tile));
    this.link.send(ClientState.localPlayerId, new MoveAction(tile));
  }

  /** The map tile under the mouse, or null off the map. */
  _groundTile(x, y) {
    const hit = Screen.groundPoint(Screen.ray(x, y));
    if (!hit) return null;
    const tile = worldToTile(hit);
    return ClientState.world.inBounds(tile) ? tile : null;
  }
}

function groundName(ground) {
  if (ground.item.container) return `${ground.item.display_name} (${ground.count}/${ground.item.capacity})`;
  return ground.item.display_name + (ground.count > 1 ? ` ×${ground.count}` : '');
}
