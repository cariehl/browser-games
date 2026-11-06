// Renders an EntityState (player or NPC). Reads state, never writes it.
//
// Shows the entity one tick "behind": at the moment of a tick it stands on
// the previous tile and glides to the new one over the next 0.6s, so
// movement never snaps or overshoots.
//
// When it dies, a model with a collapse animation stays on screen (but can't
// be clicked) for collapseSeconds while it falls, then hides; its husk takes
// over from that exact pose (see GatherNodeView).

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { tileToWorld, lerpAngle } from './tile_math.js';
import { Hitbox } from './hitbox.js';

const TURN_SPEED = 14;
/** Placeholder "working" animation: a small hop once per tick. */
const WORK_BOB = 0.07;
/** Placeholder attack animation: a quick lunge toward the target. */
const LUNGE_SECONDS = 0.25;
const LUNGE_DISTANCE = 0.3;
const PRINT_SECONDS = 0.9;

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Godot's TRANS_BACK + EASE_OUT. */
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class EntityView extends THREE.Group {
  /**
   * Views still playing their collapse, by the tile key ("x,y") their husk
   * lies on, so the husk that appears there can wait for them and take over
   * their facing.
   */
  static collapsing = new Map();

  constructor(state) {
    super();
    this.state = state;
    /** Height above the feet for HP bars and hitsplats. */
    this.headHeight = 2;
    /** Lunge at the target on each hit. Off for models with their own attack animation. */
    this.lunges = true;
    /** How long its death collapse plays. 0 (gray boxes) means it vanishes at once. */
    this.collapseSeconds = 0;
    /** The ModelAnimator, if the model has animations. */
    this.animator = null;
    this.appearance = null;
    this._lungeDir = new THREE.Vector3();
    this._lungeAge = LUNGE_SECONDS;
    this._deathAge = Infinity;
    this._huskKey = '';
    this._printAge = PRINT_SECONDS;
    tileToWorld(state.tile, 0, this.position);
    this._unsubscribe = ClientState.onTick((tick) => this._onTick(tick));
  }

  dispose() {
    this._unsubscribe();
    if (this.animator) this.animator.dispose();
    this.traverse((node) => {
      if (node instanceof Hitbox) node.dispose();
    });
  }

  _onTick(tick) {
    const world = ClientState.world;
    const id = this.state.id;
    for (const event of world.events) {
      const data = event.data;
      if (event.type === 'printed' && data.entity === id) {
        // Printed fresh: grow back up from the floor.
        this._printAge = 0;
      }
      if (event.type === 'death' && data.entity === id && this.collapseSeconds > 0) {
        this._deathAge = 0;
        // Keyed by where its husk lies, which is beside it when its own tile was taken (see World.kill).
        const husk = data.husk_tile || this.state.tile;
        this._huskKey = `${husk.x},${husk.y}`;
        EntityView.collapsing.set(this._huskKey, this);
      }
      // The lunge stands in for a swing, so it goes with the hitsplat.
      if (!this.lunges || event.type !== 'hit' || data.attacker !== id) continue;
      const target = world.entities.get(data.target);
      if (target) {
        tileToWorld(target.tile, 0, _to);
        tileToWorld(this.state.tile, 0, _from);
        this._lungeDir.subVectors(_to, _from).normalize();
        this._lungeAge = 0;
      }
    }
    if (this.animator) this.animator.onTick(tick);
  }

  update(delta) {
    const state = this.state;
    if (this._printAge < PRINT_SECONDS) {
      this._printAge += delta;
      const t = Math.min(this._printAge / PRINT_SECONDS, 1);
      this.scale.set(1, 0.05 + 0.95 * easeOutBack(t), 1);
    } else {
      this.scale.set(1, 1, 1);
    }
    if (state.isDead()) {
      this._showCollapse(delta);
    } else {
      this._deathAge = Infinity;
      this.visible = true;
      this._setClickable(true);
      this._place(delta);
    }
    if (this.animator) this.animator.update(delta);
    if (this.appearance) this.appearance.update();
  }

  _place(delta) {
    const state = this.state;
    const pts = state.steps_this_tick;
    _dir.set(0, 0, 0);
    if (pts.length < 2) {
      tileToWorld(state.tile, 0, this.position);
      if (state.hasFaceTarget()) _dir.subVectors(tileToWorld(state.face_target, 0, _to), this.position);
      // A bob while working, on top of the ground (raised tiles included),
      // for models without a loop of their own for the job.
      if (state.activity !== '' && !(this.animator && this.animator.playsActivity())) this.position.y += Math.sin(ClientState.tickAlpha * Math.PI) * WORK_BOB;
    } else {
      // Walk along the polyline of this tick's steps.
      const progress = ClientState.tickAlpha * (pts.length - 1);
      const i = Math.min(Math.floor(progress), pts.length - 2);
      tileToWorld(pts[i], 0, _from);
      tileToWorld(pts[i + 1], 0, _to);
      this.position.lerpVectors(_from, _to, progress - i);
      _dir.subVectors(_to, _from);
    }
    if (this._lungeAge < LUNGE_SECONDS) {
      this._lungeAge += delta;
      const t = Math.min(Math.max(this._lungeAge / LUNGE_SECONDS, 0), 1);
      this.position.addScaledVector(this._lungeDir, Math.sin(t * Math.PI) * LUNGE_DISTANCE);
    }
    if (_dir.lengthSq() > 0.0001) {
      const facing = Math.atan2(_dir.x, _dir.z);
      this.rotation.y = lerpAngle(this.rotation.y, facing, 1 - Math.exp(-TURN_SPEED * delta));
    }
  }

  /** Still falling after death. */
  isCollapsing() {
    return this.state.isDead() && this._deathAge < this.collapseSeconds;
  }

  /** Dead: play out the collapse where it fell (settling onto its tile), then hide. */
  _showCollapse(delta) {
    this._setClickable(false);
    if (!this.isCollapsing()) {
      this.visible = false;
      if (EntityView.collapsing.get(this._huskKey) === this) EntityView.collapsing.delete(this._huskKey);
      return;
    }
    this.visible = true;
    this._deathAge += delta;
    this.position.lerp(tileToWorld(this.state.tile, 0, _to), 1 - Math.exp(-10 * delta));
  }

  _setClickable(on) {
    for (const child of this.children) if (child instanceof Hitbox) child.enabled = on;
  }
}
