// The player's own character: keys and mouse become movement input, which
// is sent to the server and also applied here at once (prediction), so moving
// feels immediate. The server's position wins: the prediction is pulled
// toward it whenever the two drift apart. Bound mouse buttons (from the
// CameraRig) work like keys.

import { isMoving, stepMovement } from '../../shared/combat.js';
import { MOVEMENT } from '../keybinds.js';

/** Turning speed with the turn keys, radians per second. */
const TURN_SPEED = Math.PI;
/** While only facing changes (mouse steering), send it at most this often. */
const FACING_EVERY = 0.1;

function wrap(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class Controls {
  /** Movement actions whose keys are down. */
  held = new Set();
  /** Running forward on its own until cancelled. */
  autorun = false;
  input = { forward: 0, strafe: 0 };
  /** The predicted position and the facing the player chose. */
  pos = null;
  facing = 0;
  /** True while something else (the keybinding panel) owns the keyboard. */
  paused = false;
  warp = -1;
  sent = null;
  sinceSent = 0;

  /** [onAction]: called with a non-movement action id when its key is pressed. */
  constructor(room, rig, keybinds, onAction) {
    this.room = room;
    this.rig = rig;
    this.keybinds = keybinds;
    this.onAction = onAction;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  onKeyDown = (e) => {
    if (this.paused || e.target instanceof HTMLInputElement) return;
    if (!this.keybinds.actionFor(e.code)) return;
    e.preventDefault();
    if (!e.repeat) this.press(e.code);
  };

  onKeyUp = (e) => this.release(e.code);

  onBlur = () => this.held.clear();

  /** A key or mouse button [code] went down. */
  press(code) {
    if (this.paused) return;
    const action = this.keybinds.actionFor(code);
    if (!action) return;
    if (MOVEMENT.has(action)) {
      this.held.add(action);
      // Moving forward or back yourself takes over from autorun.
      if (action === 'forward' || action === 'back') this.autorun = false;
    } else if (action === 'autorun') {
      this.autorun = !this.autorun;
    } else {
      this.onAction(action);
    }
  }

  release(code) {
    const action = this.keybinds.actionFor(code);
    if (action) this.held.delete(action);
  }

  /** Steps the player's character by [dt] seconds. [me]: their synced Raider. */
  update(dt, me) {
    if (!this.pos || me.warp !== this.warp) {
      // Placed by the server (joining, releasing): start from there.
      this.pos = { x: me.x, z: me.z };
      this.facing = me.facing;
      this.rig.yaw = me.facing;
      this.warp = me.warp;
      this.sent = null;
    }
    const alive = me.health > 0;
    const held = (action) => (this.held.has(action) ? 1 : 0);
    let forward = held('forward') - held('back');
    let strafe = held('strafeRight') - held('strafeLeft');
    let turn = held('turnLeft') - held('turnRight');
    if (this.rig.turning) {
      // Steering with the mouse: the turn keys strafe instead.
      strafe = Math.max(-1, Math.min(1, strafe - turn));
      turn = 0;
      this.facing = wrap(this.rig.yaw);
    }
    if (this.autorun && !forward) forward = 1;
    if (this.rig.running) {
      forward = 1;
      this.autorun = false;
    }
    if (!alive) this.autorun = false;
    if (!alive || this.paused) forward = strafe = turn = 0;
    this.facing = wrap(this.facing + turn * TURN_SPEED * dt);
    this.input = { forward, strafe };

    // The camera swings round behind the character as they move or turn,
    // unless the player is looking around.
    if (!this.rig.turning && !this.rig.looking && (forward || strafe || turn)) {
      const k = 1 - Math.exp(-dt * (turn ? 12 : 4));
      this.rig.yaw += wrap(this.facing - this.rig.yaw) * k;
    }

    if (alive && isMoving(this.input)) this.pos = stepMovement(this.pos, this.facing, this.input, dt);
    // Reconcile: while moving the server lags by the round trip, so only a
    // big gap counts; standing still, settle onto the server's spot.
    const gap = Math.hypot(me.x - this.pos.x, me.z - this.pos.z);
    const pull = !alive || !isMoving(this.input) ? 1 - Math.exp(-dt * 6) : gap > 2 ? 1 - Math.exp(-dt * 4) : 0;
    this.pos.x += (me.x - this.pos.x) * pull;
    this.pos.z += (me.z - this.pos.z) * pull;

    this.send(dt);
  }

  send(dt) {
    this.sinceSent += dt;
    const { forward, strafe } = this.input;
    const sent = this.sent;
    const changed = !sent || sent.forward !== forward || sent.strafe !== strafe;
    const turned = sent && Math.abs(wrap(sent.facing - this.facing)) > 0.005;
    if (changed || (turned && this.sinceSent >= FACING_EVERY)) {
      this.sent = { forward, strafe, facing: this.facing };
      this.sinceSent = 0;
      this.room.send('move', this.sent);
    }
  }
}
