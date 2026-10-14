// Plays an imported model's animations from the sim state of the entity it
// belongs to. Reads state, never writes it.
//
// Clips it looks for (a model can leave any out):
// - Idle variants (IDLES): one plays, and when it ends another is picked at
//   random, so a standing mech doesn't loop one motion forever.
// - Walk: loops while the entity is moving, sped up or slowed down to match
//   its ground speed so the feet don't slide.
// - Attack: one swing. The sim commits an attack the tick before it
//   strikes; the clip is started so that its strike frame
//   (attackWindupFrames in) lands exactly as the strike tick begins, when
//   the hitsplat appears.
// - Death: plays once when it dies; it ends in its husk's pose.
// - Players also have: Run (while running), one attack clip per weapon type
//   (Attack_<type id>, falling back to Attack; Attack_fists unarmed), a
//   looping clip per activity (ACTIVITY_CLIPS), Inject when they use an
//   item, and Print when they're printed at the manufactory.
//
// Moving during a swing: by default Walk takes over the whole body (the hit
// still lands; only the animation is cut). With enableUpperBody() the swing
// instead finishes on the upper body while the legs walk.
//
// Clips are authored at FPS (18 frames a tick) with lengths on a 3-frame
// grid; see docs/tick-aligned-animations.md.

import { ClientState, TICK_SECONDS } from '../client/client_state.js';
import { ClipPlayer } from './clip_player.js';
import { TILE_SIZE } from './tile_math.js';

const WALK = 'Walk';
const RUN = 'Run';
const ATTACK = 'Attack';
const ATTACK_FISTS = 'Attack_fists';
/** Strike frame of the unarmed punch (fists have no weapon type to hold it). */
const ATTACK_FISTS_WINDUP = 9;
const DEATH = 'Death';
const INJECT = 'Inject';
const PRINT = 'Print';
/** Loops played while working, by the skill being trained (EntityState.activity). */
const ACTIVITY_CLIPS = {
  salvaging: 'Salvage', siphoning: 'Siphon', xenobiology: 'Harvest', engineering: 'Craft', splicing: 'Craft',
};
const ACTIVITY_LOOPS = new Set(Object.values(ACTIVITY_CLIPS));
/** Idle clips and how often each is picked. */
const IDLES = { IdleBob: 3, Idle: 1 };
/** Seconds to cross-fade between clips. */
const BLEND = 0.2;
/** Frame rate clips are authored at, and frames in one tick. */
const FPS = 30;
const TICK_FRAMES = 18;

export class ModelAnimator {
  /** A ModelAnimator for [model], or null when it has no animations. */
  static attach(model, animations, state, scale) {
    if (!animations || animations.length === 0) return null;
    return new ModelAnimator(model, animations, state, scale);
  }

  constructor(model, animations, state, scale) {
    this.model = model;
    this.animations = animations;
    this.state = state;
    this.modelScale = scale;
    /** Ground one Walk cycle covers at the model's authored size, in metres. */
    this.walkCycleDistance = 2;
    /** The same for Run, when the model has it. */
    this.runCycleDistance = 3;
    /** Frames from the start of Attack to its strike (a multiple of 3, at most TICK_FRAMES). 0 starts the clip on the strike tick. */
    this.attackWindupFrames = 0;

    this._attacking = false;
    /** The attack clip for the swing waiting or playing (players pick it by weapon type). */
    this._attack = ATTACK;
    /** A one-off clip (Inject, Print) is playing; idles and loops wait for it. */
    this._oneshot = false;
    /** Tick a waiting attack was committed on, or -1. Its clip starts windupDelay() into that tick. */
    this._commitTick = -1;
    /** Commit tick of the swing playing now (full-body or upper body), or -1. */
    this._swingCommit = -1;
    /** Seconds into the attack the upper-body overlay is, or -1 while it's off. */
    this._overlayTime = -1;
    this._overlayFade = 0;
    this._buildPlayer(null);
  }

  _buildPlayer(upperBones) {
    this.player = new ClipPlayer(this.model, this.animations, upperBones);
    const p = this.player;
    for (const name of p.names()) {
      p.setLoop(name, name === WALK || name === RUN || ACTIVITY_LOOPS.has(name));
    }
    p.onFinished = (clip) => this._onFinished(clip);
    this._playIdle(0);
    // Start mechs at different points of their idle so a group doesn't bob in step.
    if (p.current) p.seek(Math.random() * p.currentLength);
    p.apply();
  }

  dispose() {
    this.player.mixer.stopAllAction();
  }

  /** Seconds the death collapse takes, or 0 without one. */
  collapseSeconds() {
    return this.player.length(DEATH);
  }

  /** Seconds from a commit tick's start until its swing's first frame. */
  windupDelay() {
    return this.attackWindupFrames > 0 ? (TICK_FRAMES - this.attackWindupFrames) / FPS : TICK_SECONDS;
  }

  // --- Upper-body layer ---------------------------------------------------

  /**
   * Lets swings finish on the upper body while walking: [bone] and
   * everything below it in the skeleton keep playing the attack when the
   * entity starts moving. Returns false if the rig has no such bone.
   */
  enableUpperBody(boneName) {
    if (this.player.layered) return true;
    if (!this.player.has(ATTACK)) return false;
    const bone = this.model.getObjectByName(boneName);
    if (!bone || !bone.isBone) return false;
    const upper = new Set();
    bone.traverse((node) => upper.add(node.name));
    this.player.mixer.stopAllAction();
    this.player.mixer.uncacheRoot(this.model);
    this._buildPlayer(upper);
    return true;
  }

  overlayActive() {
    return this._overlayTime >= 0;
  }

  _startOverlay(at) {
    this._overlayTime = at;
    this._overlayFade = 1;
  }

  _stopOverlay() {
    this._overlayTime = -1;
  }

  _updateOverlay(delta) {
    if (!this.overlayActive()) return null;
    const length = this.player.length(this._attack);
    if (this._swingCommit >= 0) this._overlayTime = Math.max(this._swingTime(), 0);
    else this._overlayTime += delta;
    if (this._overlayTime >= length) {
      // Swing done: fade the upper body back into whatever the legs do.
      this._overlayFade -= delta / BLEND;
      if (this._overlayFade <= 0) {
        this._stopOverlay();
        return null;
      }
    }
    return { name: this._attack, time: Math.min(this._overlayTime, length), weight: Math.min(Math.max(this._overlayFade, 0), 1) };
  }

  // --- Driving clips from the sim -----------------------------------------

  /** Called after every tick with the world's events. */
  onTick(tick) {
    const state = this.state;
    const p = this.player;
    const events = ClientState.world.events;
    // A player dies and is printed in the same tick; the print wins, or
    // they'd lie in the death pose at the manufactory.
    const printed = events.some((e) => e.type === 'printed' && e.data.entity === state.id);
    for (const event of events) {
      const type = event.type;
      const data = event.data;
      if (type === 'death' && data.entity === state.id && p.has(DEATH) && !(printed && p.has(PRINT))) {
        this._attacking = false;
        this._commitTick = -1;
        this._swingCommit = -1;
        this._stopOverlay();
        p.speedScale = 1;
        p.play(DEATH, 0.1);
        return;
      }
      if (type === 'respawn' && data.entity === state.id) {
        this._playIdle(0);
        return;
      }
      if (type === 'printed' && data.entity === state.id && p.has(PRINT)) {
        this._attacking = false;
        this._commitTick = -1;
        this._swingCommit = -1;
        this._stopOverlay();
        this._playOneshot(PRINT);
        return;
      }
      if (state.isDead()) continue;
      if (type === 'use_item' && data.entity === state.id && p.has(INJECT) && !this._attacking && this._groundSpeed() === 0) {
        this._playOneshot(INJECT);
        continue;
      }
      if (type === 'attack' && data.attacker === state.id && this._pickAttack()) {
        // Committed this tick; the swing starts so its strike lands as the strike tick begins.
        const strike = data.strike_tick ?? tick + 1;
        this._commitTick = strike - 1;
        return;
      }
    }
  }

  /** Picks the attack clip (and its wind-up) for this swing. False if there's no clip. */
  _pickAttack() {
    const p = this.player;
    this._attack = ATTACK;
    if (!this.state.isNpc()) {
      const type = this.state.weapon ? this.state.weapon.weapon_type : null;
      if (!type) {
        if (p.has(ATTACK_FISTS)) {
          this._attack = ATTACK_FISTS;
          this.attackWindupFrames = ATTACK_FISTS_WINDUP;
        }
      } else {
        const own = 'Attack_' + type.id;
        if (p.has(own)) this._attack = own;
        this.attackWindupFrames = type.attack_windup_frames;
      }
    }
    return p.has(this._attack);
  }

  _playOneshot(clip) {
    this._oneshot = true;
    this.player.speedScale = 1;
    this.player.play(clip, 0.1);
    this.player.seek(0);
  }

  /** Where the current swing should be, in seconds into its clip, going by the tick clock. */
  _swingTime() {
    return (ClientState.world.tick - this._swingCommit + ClientState.tickAlpha) * TICK_SECONDS - this.windupDelay();
  }

  /** Seconds since the waiting attack's clip should have started (negative while it's still to come). */
  _attackOverdue() {
    return (ClientState.world.tick - this._commitTick + ClientState.tickAlpha) * TICK_SECONDS - this.windupDelay();
  }

  /** Starts the swing [late] seconds in, so it stays on the tick clock. */
  _startAttack(late) {
    const p = this.player;
    this._swingCommit = this._commitTick;
    this._commitTick = -1;
    late = Math.min(Math.max(late, 0), TICK_SECONDS);
    if (this.state.isDead()) return;
    const moving = this._groundSpeed() > 0;
    if (moving && !p.layered) return; // Walk wins; the hit still lands.
    if (moving) {
      this._startOverlay(late);
      return;
    }
    this._stopOverlay();
    this._attacking = true;
    this._oneshot = false;
    p.speedScale = 1;
    if (p.current !== this._attack) p.play(this._attack, 0.1);
    p.seek(late); // also restarts a swing that's still finishing
  }

  /** Called every frame with (debug-speed scaled) frame time. */
  update(delta) {
    const p = this.player;
    const state = this.state;
    p.advance(delta);
    if (state.isDead()) {
      p.apply();
      return;
    }
    if (this._commitTick >= 0) {
      const overdue = this._attackOverdue();
      if (overdue >= 0) this._startAttack(overdue);
    } else if (this._attacking && this._swingCommit >= 0 && p.current === this._attack) {
      // Hold the swing to the tick clock; slow or hitching frames would
      // otherwise drift its strike off the hitsplat.
      const t = this._swingTime();
      if (t < p.currentLength && Math.abs(p.position - t) > 1 / FPS) p.seek(t);
    }
    const speed = this._groundSpeed();
    if (speed > 0 && p.has(WALK)) {
      if (this._attacking && p.layered && p.current === this._attack) {
        // Hand the rest of the swing to the upper body.
        this._startOverlay(p.position);
      }
      // Moving always wins below the waist (and above it, unless layered).
      this._attacking = false;
      this._oneshot = false;
      const running = state.running && p.has(RUN);
      const clip = running ? RUN : WALK;
      if (p.current !== clip) p.play(clip, BLEND);
      const cycleSeconds = p.length(clip);
      const cycleDistance = running ? this.runCycleDistance : this.walkCycleDistance;
      p.speedScale = speed / (cycleDistance * this.modelScale / cycleSeconds);
    } else if (!this._attacking && !this._oneshot) {
      this._settle();
    }
    p.apply(p.layered ? this._updateOverlay(delta) : null);
  }

  /** Metres per second the entity covers this tick, 0 when standing still. */
  _groundSpeed() {
    const pts = this.state.steps_this_tick;
    if (pts.length < 2) return 0;
    let distance = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      distance += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) * TILE_SIZE;
    }
    return distance / TICK_SECONDS;
  }

  /** Standing still and not swinging: the activity's loop while working, otherwise an idle. */
  _settle() {
    const p = this.player;
    const current = p.current;
    const working = ACTIVITY_CLIPS[this.state.activity] || '';
    if (working && p.has(working)) {
      if (current !== working) {
        p.speedScale = 1;
        p.play(working, BLEND);
      }
      return;
    }
    if (current === WALK || current === RUN || current === '' || ACTIVITY_LOOPS.has(current)) this._playIdle(BLEND);
  }

  _onFinished(clip) {
    if (clip === DEATH) return;
    if (clip === this._attack) {
      this._attacking = false;
      this._playIdle(BLEND);
    } else if (clip === INJECT || clip === PRINT) {
      this._oneshot = false;
      this._playIdle(BLEND);
    } else if (clip in IDLES) {
      this._playIdle(0);
    }
  }

  _playIdle(blend) {
    const p = this.player;
    let total = 0;
    for (const [idle, weight] of Object.entries(IDLES)) if (p.has(idle)) total += weight;
    if (total <= 0) return;
    let roll = Math.random() * total;
    for (const [idle, weight] of Object.entries(IDLES)) {
      if (!p.has(idle)) continue;
      roll -= weight;
      if (roll <= 0) {
        p.speedScale = 1;
        // Picked the clip that just ended: rewind it, or play() leaves it at the end.
        if (p.assigned === idle) p.stop();
        p.play(idle, blend);
        return;
      }
    }
  }
}
