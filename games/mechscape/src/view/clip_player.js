// A small stand-in for Godot's AnimationPlayer over three.js's
// AnimationMixer: one clip at a time with cross-fades, loop or play-once per
// clip, seek, speed, and a callback when a play-once clip ends. Time is
// advanced by hand (advance()), never by the mixer, so the caller can pin
// clips to the tick clock exactly.
//
// With [upperBones] (a Set of bone names), every clip is also split into an
// upper-body and a lower-body copy, and apply() can mix a second clip over
// the upper body only: a swing finishing on the arms while the legs walk.

import * as THREE from 'three';

export class ClipPlayer {
  constructor(root, animations, upperBones = null) {
    this.mixer = new THREE.AnimationMixer(root);
    this.layered = !!upperBones;
    /** name -> { length, loop, variants: { full | lower, upper } } */
    this.clips = new Map();
    for (const clip of animations) {
      const variants = {};
      if (this.layered) {
        const upper = [];
        const lower = [];
        for (const track of clip.tracks) {
          const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
          (upperBones.has(node) ? upper : lower).push(track);
        }
        variants.upper = this._action(new THREE.AnimationClip(clip.name + '/upper', clip.duration, upper));
        variants.lower = this._action(new THREE.AnimationClip(clip.name + '/lower', clip.duration, lower));
      } else {
        variants.full = this._action(clip);
      }
      this.clips.set(clip.name, { length: clip.duration, loop: false, variants });
    }
    /** The clip playing, or '' when stopped (a play-once clip ended). */
    this.current = '';
    /** The clip last played; its pose holds after it ends. */
    this.assigned = '';
    this.position = 0;
    this.speedScale = 1;
    /** Called with a play-once clip's name when it reaches its end. */
    this.onFinished = null;
    /** The clip being faded out: { name, position, playing }, or null. */
    this._from = null;
    this._blend = 0;
    this._blendAge = 0;
    this._used = [];
  }

  _action(clip) {
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    action.enabled = false;
    return action;
  }

  has(name) {
    return this.clips.has(name);
  }

  length(name) {
    const clip = this.clips.get(name);
    return clip ? clip.length : 0;
  }

  get currentLength() {
    return this.length(this.current);
  }

  setLoop(name, loop) {
    const clip = this.clips.get(name);
    if (clip) clip.loop = loop;
  }

  names() {
    return [...this.clips.keys()];
  }

  /** Plays [name] from its start, cross-fading over [blend] seconds. Already playing: carries on. */
  play(name, blend = 0) {
    if (!this.has(name) || name === this.current) return;
    if (blend > 0 && this.assigned && this.assigned !== name) {
      this._from = { name: this.assigned, position: this.position, playing: this.current !== '' };
      this._blend = blend;
      this._blendAge = 0;
    } else {
      this._from = null;
    }
    this.current = name;
    this.assigned = name;
    this.position = 0;
  }

  seek(seconds) {
    this.position = Math.min(Math.max(seconds, 0), this.length(this.assigned));
  }

  stop() {
    this.current = '';
    this.position = 0;
  }

  advance(delta) {
    const step = delta * this.speedScale;
    if (this._from) {
      this._blendAge += delta;
      if (this._blendAge >= this._blend) this._from = null;
      else if (this._from.playing) this._from.position = this._wrap(this._from.name, this._from.position + step);
    }
    if (!this.current) return;
    const clip = this.clips.get(this.current);
    const next = this.position + step;
    if (clip.loop) {
      this.position = this._wrap(this.current, next);
      return;
    }
    if (next >= clip.length) {
      this.position = clip.length;
      const ended = this.current;
      this.current = '';
      if (this.onFinished) this.onFinished(ended);
      return;
    }
    this.position = Math.max(next, 0);
  }

  _wrap(name, t) {
    const clip = this.clips.get(name);
    if (!clip.loop) return Math.min(t, clip.length);
    return clip.length > 0 ? ((t % clip.length) + clip.length) % clip.length : 0;
  }

  /**
   * Poses the model. [overlay]: { name, time, weight } mixed over the upper
   * body (layered players only), or null.
   */
  apply(overlay = null) {
    for (const action of this._used) action.enabled = false;
    this._used.length = 0;
    const base = [];
    if (this.assigned) {
      const f = this._from ? Math.min(this._blendAge / this._blend, 1) : 1;
      base.push([this.assigned, this.position, f]);
      if (this._from && f < 1) base.push([this._from.name, this._from.position, 1 - f]);
    }
    const over = this.layered && overlay && this.has(overlay.name) ? Math.min(Math.max(overlay.weight, 0), 1) : 0;
    for (const [name, time, weight] of base) {
      const variants = this.clips.get(name).variants;
      if (this.layered) {
        this._use(variants.lower, time, weight);
        this._use(variants.upper, time, weight * (1 - over));
      } else {
        this._use(variants.full, time, weight);
      }
    }
    if (over > 0) this._use(this.clips.get(overlay.name).variants.upper, overlay.time, over);
    this.mixer.update(0);
  }

  _use(action, time, weight) {
    if (weight <= 0) return;
    const length = action.getClip().duration;
    action.enabled = true;
    action.weight = weight;
    // Sampling exactly at the end would wrap to the first frame.
    action.time = Math.min(Math.max(time, 0), Math.max(length - 1e-4, 0));
    this._used.push(action);
  }
}
