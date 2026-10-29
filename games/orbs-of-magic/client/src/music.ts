// Synthesized orchestral score: two original pieces built from the same five-note "Orb motif"
// (A–D–E–F … E–C–D). No audio files: every instrument is a few Web Audio oscillators.
//
//   menu    "Whispers of the Orbs"  D dorian, 3/4, 66 bpm. Celesta, harp, hushed strings, glass bells.
//   battle  "The Orb War"           D minor, 4/4, 84 bpm. String ostinato, horns, timpani, flute.
//           Four 8-bar sections that swell and fall back, mixed low so the battle stays in front.

type Inst = 'celesta' | 'harp' | 'pad' | 'bass' | 'bell' | 'spicc' | 'horn' | 'violin' | 'flute' | 'timp' | 'brass';
interface Ev { beat: number; dur: number; midi: number; vel: number; inst: Inst }
export interface Song { name: string; bpm: number; beatsPerBar: number; bars: number; events: Ev[]; dyn: number[]; level: number }

// ───────────── notation helpers ─────────────
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(n: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error(`Bad note ${n}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** "A4:1 D5:1.5 | r:2 C4+E4:1" → events. Bars split on "|" are checked against the meter. */
function seq(out: Ev[], s: string, startBar: number, bpb: number, inst: Inst, vel = 0.7) {
  let beat = startBar * bpb;
  s.split('|').forEach((bar, bi) => {
    let len = 0;
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      const [notes, d] = tok.split(':');
      const dur = Number(d);
      if (notes !== 'r') for (const n of notes.split('+')) out.push({ beat: beat + len, dur, midi: midiOf(n), vel, inst });
      len += dur;
    }
    if (Math.abs(len - bpb) > 1e-6) throw new Error(`${inst} bar ${startBar + bi + 1} has ${len} beats`);
    beat += bpb;
  });
}

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], m7b5: [0, 3, 6, 10], 7: [0, 4, 7, 10],
};
function chord(sym: string) {
  const m = /^([A-G][b#]?)(.*)$/.exec(sym)!;
  const root = (PC[m[1][0]] + (m[1][1] === '#' ? 1 : m[1][1] === 'b' ? -1 : 0) + 12) % 12;
  return { root, iv: QUALITY[m[2]] };
}
/** The chord's root placed at or above `low`. */
const rootAbove = (root: number, low: number) => low + ((root - low) % 12 + 12) % 12;

// ───────────── the menu piece ─────────────
function buildMenu(): Song {
  const bpb = 3, ev: Ev[] = [];
  const chords = [
    'Dm9', 'Dm9', 'Bbmaj7', 'Bbmaj7', 'G', 'Gm', 'Asus4', 'A',
    'Dm9', 'Dm9', 'Bbmaj7', 'C', 'Fmaj7', 'G', 'Asus4', 'Dm',
    'Bbmaj7', 'C', 'Am7', 'Dm', 'Gm7', 'C', 'Fmaj7', 'A',
    'Dm9', 'Bbmaj7', 'G', 'Gm', 'Fmaj7', 'Em7b5', 'Asus4', 'A',
  ];
  // The Orb motif on celesta, answered, then lifted an octave in the B section.
  seq(ev, `r:2 A4:1 | D5:1.5 E5:.5 F5:1 | E5:2 C5:1 | D5:3 | r:1 B4:1 D5:1 | G5:1.5 F5:.5 D5:1 | E5:2 D5:1 | C#5:3 |
    r:2 A4:1 | D5:1.5 E5:.5 F5:1 | A5:2 G5:1 | E5:2 C5:1 | F5:1.5 E5:.5 C5:1 | D5:2 B4:1 | D5:1 E5:2 | D5:3 |
    F5:1 A5:1 D6:1 | C6:2 G5:1 | E5:1 A5:1 C6:1 | A5:3 | Bb5:1 A5:1 G5:1 | E5:2 G5:1 | A5:1.5 G5:.5 F5:1 | E5:3 |
    r:1 A4:1 D5:1 | E5:1 F5:1 A5:1 | B5:2 A5:1 | G5:2 F5:1 | E5:1.5 F5:.5 E5:1 | D5:2 Bb4:1 | D5:1 E5:2 | C#5:2 r:1`,
  0, bpb, 'celesta', 0.62);

  chords.forEach((sym, bar) => {
    const { root, iv } = chord(sym);
    const b0 = bar * bpb;
    // Harp: rolling up-and-back arpeggio in 8ths.
    const r = rootAbove(root, 50);
    const top = iv.length > 3 ? r + 12 + iv[3] : r + 12 + iv[2];
    const arp = [r - 12, r + iv[2], r + 12, r + 12 + iv[1], top, r + 12 + iv[1]];
    arp.forEach((m, i) => ev.push({ beat: b0 + i * 0.5, dur: 1.5, midi: m, vel: i === 0 ? 0.55 : 0.36, inst: 'harp' }));
    // Hushed strings: an open voicing held for the bar.
    const p = rootAbove(root, 55);
    for (const i of iv.slice(1, 4)) ev.push({ beat: b0, dur: bpb, midi: p + i, vel: 0.32, inst: 'pad' });
    // A low string drone in the outer sections, as if from far away.
    if (bar < 8 || bar >= 24) ev.push({ beat: b0, dur: bpb, midi: rootAbove(root, 38), vel: 0.34, inst: 'bass' });
    // Glass bells on the colour tone every four bars.
    if (bar % 4 === 0) ev.push({ beat: b0 + 1, dur: 3, midi: p + iv[iv.length - 1] + 12, vel: 0.22, inst: 'bell' });
  });
  const dyn = chords.map((_, i) => (i >= 16 && i < 24 ? 1 : 0.88));
  return { name: 'menu', bpm: 66, beatsPerBar: bpb, bars: chords.length, events: ev, dyn, level: 1 };
}

// ───────────── the battle piece ─────────────
function buildBattle(): Song {
  const bpb = 4, ev: Ev[] = [];
  const chords = [
    'Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A', //       I   gathering: ostinato, timpani, distant strings
    'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'C', 'A', //        II  the horns take up the Orb motif
    'Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A', //         III the swell: violins soar, horns underneath
    'Gm', 'Gm', 'Dm', 'Dm', 'Eb', 'Eb', 'A', 'A', //       IV  the ebb: half-time, a lone flute remembers the menu
  ];
  seq(ev, `r:4 | r:4 | r:4 | r:4 | D5:4 | D5:4 | E5:4 | C#5:4`, 0, bpb, 'violin', 0.42);
  seq(ev, `A3:1 D4:1.5 E4:.5 F4:1 | F4:2 D4:1 C4:1 | D4:4 | r:1 C#4:1 E4:1 A4:1 |
    A4:1.5 G4:.5 F4:1 E4:1 | F4:2 D4:2 | E4:1.5 F4:.5 G4:2 | E4:4`, 8, bpb, 'horn', 0.62);
  seq(ev, `D5:4 | E5:2 G5:2 | F5:3 E5:1 | D5:2 A5:2 | Bb5:3 A5:1 | G5:2 C6:2 | A5:2 G5:1 E5:1 | C#6:4`, 16, bpb, 'violin', 0.6);
  seq(ev, `D4:4 | E4:4 | F4:4 | A4:4 | F4:4 | G4:4 | E4:4 | E4:4`, 16, bpb, 'horn', 0.45);
  seq(ev, `r:4 | r:4 | r:3 A4:1 | D5:1.5 E5:.5 F5:2 | G5:3 F5:1 | Eb5:4 | E5:2 C#5:2 | A4:4`, 24, bpb, 'flute', 0.5);

  const accents = [1, 0.45, 0.5, 0.85, 0.45, 0.5, 0.8, 0.5];
  chords.forEach((sym, bar) => {
    const { root, iv } = chord(sym);
    const b0 = bar * bpb;
    const sec = Math.floor(bar / 8);
    const lo = rootAbove(root, 38);
    // Low string ostinato: a 3+3+2 drive, falling to half-time in the last section.
    if (sec < 3) {
      const pat = [lo, lo, lo + 7, lo, lo, lo + 12, lo, lo + 7];
      pat.forEach((m, i) => ev.push({ beat: b0 + i * 0.5, dur: 0.4, midi: m, vel: accents[i] * (sec === 0 ? 0.5 : 0.62), inst: 'spicc' }));
    } else {
      for (let i = 0; i < 4; i++) ev.push({ beat: b0 + i, dur: 0.8, midi: i % 2 ? lo + 7 : lo, vel: i === 0 ? 0.5 : 0.32, inst: 'spicc' });
    }
    // Sustained strings in the middle register.
    const p = rootAbove(root, 53);
    for (const i of iv) ev.push({ beat: b0, dur: bpb, midi: p + i, vel: sec === 2 ? 0.42 : 0.3, inst: 'pad' });
    // Cellos and basses hold the root.
    ev.push({ beat: b0, dur: bpb, midi: lo - 12 < 28 ? lo : lo - 12, vel: 0.4, inst: 'bass' });
    // Low brass joins for the swell.
    if (sec === 2) { ev.push({ beat: b0, dur: bpb, midi: lo, vel: 0.3, inst: 'brass' }); ev.push({ beat: b0, dur: bpb, midi: lo + 7, vel: 0.24, inst: 'brass' }); }
    // Timpani: downbeats, an off-beat push in the swell, a roll into its peak, near silence in the ebb.
    const timp = (beat: number, vel: number, m = lo) => ev.push({ beat, dur: 1.5, midi: m, vel, inst: 'timp' });
    if (sec < 3) timp(b0, sec === 0 ? 0.42 : 0.55);
    if (sec === 2) timp(b0 + 2.5, 0.38, lo + 7);
    if (bar === 23) for (let i = 0; i < 16; i++) timp(b0 + i * 0.25, 0.18 + i * 0.035);
    if (bar === 15) { timp(b0 + 3, 0.45, lo + 7); timp(b0 + 3.5, 0.5, lo + 7); }
    if (sec === 3 && bar % 4 === 0) timp(b0, 0.35);
  });
  const dyn = [
    0.62, 0.64, 0.67, 0.7, 0.72, 0.75, 0.8, 0.84,
    0.82, 0.84, 0.86, 0.9, 0.86, 0.88, 0.92, 0.95,
    0.9, 0.93, 0.97, 1, 0.97, 1, 1.05, 1.1,
    0.72, 0.7, 0.68, 0.66, 0.7, 0.72, 0.68, 0.64,
  ];
  return { name: 'battle', bpm: 84, beatsPerBar: bpb, bars: chords.length, events: ev, dyn, level: 1.15 };
}

export const SONGS = { menu: buildMenu(), battle: buildBattle() };
export type SongName = keyof typeof SONGS;

// ───────────── instruments ─────────────
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Bus { input: GainNode; send: GainNode; dyn: GainNode; fade: GainNode; ch: Map<Inst, GainNode> }

const MIX: Record<Inst, { gain: number; pan: number; send: number }> = {
  celesta: { gain: 0.32, pan: 0.15, send: 0.55 },
  harp: { gain: 0.3, pan: -0.25, send: 0.45 },
  pad: { gain: 0.16, pan: 0, send: 0.6 },
  bass: { gain: 0.3, pan: 0.05, send: 0.35 },
  bell: { gain: 0.12, pan: 0.35, send: 0.8 },
  spicc: { gain: 0.3, pan: -0.15, send: 0.3 },
  horn: { gain: 0.3, pan: -0.3, send: 0.5 },
  violin: { gain: 0.2, pan: 0.3, send: 0.55 },
  flute: { gain: 0.22, pan: 0.25, send: 0.6 },
  timp: { gain: 0.5, pan: 0, send: 0.4 },
  brass: { gain: 0.2, pan: -0.1, send: 0.45 },
};

const irCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function impulse(ctx: BaseAudioContext) {
  let b = irCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * 3.4);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += 0.32 * ((Math.random() * 2 - 1) - lp); // darken the tail a little
      d[i] = lp * (1 - t) ** 2.6 * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  irCache.set(ctx, b);
  return b;
}

function makeBus(ctx: BaseAudioContext, dest: AudioNode): Bus {
  const fade = ctx.createGain();
  const dyn = ctx.createGain();
  const input = ctx.createGain();
  const send = ctx.createGain();
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  // Gentle glue so the swells never jump out over the sound effects.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
  input.connect(dyn);
  send.connect(verb).connect(wet).connect(dyn);
  dyn.connect(comp).connect(fade).connect(dest);
  const ch = new Map<Inst, GainNode>();
  for (const [name, m] of Object.entries(MIX) as [Inst, (typeof MIX)[Inst]][]) {
    const g = ctx.createGain(); g.gain.value = m.gain;
    const pan = ctx.createStereoPanner(); pan.pan.value = m.pan;
    const s = ctx.createGain(); s.gain.value = m.send;
    g.connect(pan); pan.connect(input); pan.connect(s); s.connect(send);
    ch.set(name, g);
  }
  return { input, send, dyn, fade, ch };
}

/** Attack, hold, release envelope on a fresh gain node. */
function env(ctx: BaseAudioContext, t: number, a: number, peak: number, hold: number, r: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, hold));
  g.gain.setTargetAtTime(0, t + Math.max(a, hold), r / 4);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, t: number, end: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  o.start(t); o.stop(end);
  return o;
}

function vibrato(ctx: BaseAudioContext, t: number, end: number, rate: number, cents: number, delay: number, targets: OscillatorNode[]) {
  const lfo = osc(ctx, 'sine', rate, t, end);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(cents, t + delay);
  lfo.connect(depth);
  for (const o of targets) depth.connect(o.detune);
}

function play(ctx: BaseAudioContext, bus: Bus, e: Ev, t: number, dur: number) {
  const out = bus.ch.get(e.inst)!;
  const f = hz(e.midi);
  const v = e.vel;
  switch (e.inst) {
    case 'celesta': {
      // Bright strike that blooms into a pure tone: fundamental, a soft octave, a glassy 4th partial.
      const end = t + 2.6;
      const g = env(ctx, t, 0.004, v, 0.01, 2.2);
      [[1, 1], [2, 0.18], [4.02, 0.09]].forEach(([mul, amp]) => {
        const o = osc(ctx, 'sine', f * mul, t, end);
        const a = ctx.createGain(); a.gain.setValueAtTime(amp, t); a.gain.setTargetAtTime(amp * 0.15, t, mul > 1 ? 0.12 : 0.9);
        o.connect(a).connect(g);
      });
      g.connect(out);
      break;
    }
    case 'harp': {
      const end = t + 2;
      const g = env(ctx, t, 0.003, v, 0.01, 1.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(6000, f * 7), t); lp.frequency.setTargetAtTime(f * 2, t, 0.25);
      osc(ctx, 'triangle', f, t, end).connect(lp);
      const s = osc(ctx, 'sine', f * 2, t, end); const sg = ctx.createGain(); sg.gain.value = 0.25; s.connect(sg).connect(lp);
      lp.connect(g).connect(out);
      break;
    }
    case 'pad': case 'violin': case 'bass': case 'brass': {
      // String / brass section: detuned saws through a lowpass that opens as the note swells.
      const violin = e.inst === 'violin';
      const a = e.inst === 'bass' ? 0.5 : violin ? 0.35 : e.inst === 'brass' ? 0.6 : 0.9;
      const r = violin ? 0.9 : 1.2;
      const end = t + dur + r * 1.5;
      const g = env(ctx, t, a, v, dur * 0.92, r);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
      const top = e.inst === 'brass' ? 700 : e.inst === 'bass' ? 500 : violin ? 2600 : 1500;
      lp.frequency.setValueAtTime(top * 0.45, t);
      lp.frequency.linearRampToValueAtTime(top * (0.7 + v * 0.5), t + a + dur * 0.4);
      lp.frequency.setTargetAtTime(top * 0.45, t + dur, 0.5);
      const oscs = (e.inst === 'bass' ? [-5, 5] : [-9, 0, 8]).map((d) => osc(ctx, 'sawtooth', f, t, end, d));
      if (violin) vibrato(ctx, t, end, 5.4, 14, 0.5, oscs); else if (e.inst !== 'bass') vibrato(ctx, t, end, 4.6, 5, 0.8, oscs);
      const mix = ctx.createGain(); mix.gain.value = 1 / oscs.length;
      for (const o of oscs) o.connect(mix);
      mix.connect(lp).connect(g).connect(out);
      break;
    }
    case 'spicc': {
      // Short bowed note: a quick bite then gone.
      const end = t + 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.012); g.gain.setTargetAtTime(0, t + 0.04, Math.min(0.09, dur * 0.25));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.setTargetAtTime(350, t, 0.06);
      const mix = ctx.createGain(); mix.gain.value = 0.5;
      for (const d of [-6, 6]) osc(ctx, 'sawtooth', f, t, end, d).connect(mix);
      mix.connect(lp).connect(g).connect(out);
      break;
    }
    case 'horn': {
      // Warm, round brass: saw + square, heavily filtered, with a soft "bloom".
      const end = t + dur + 1.2;
      const g = env(ctx, t, 0.09, v, dur * 0.95, 0.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
      lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(700 + v * 700, t + 0.18);
      lp.frequency.setTargetAtTime(600 + v * 300, t + 0.3, 0.6);
      const o1 = osc(ctx, 'sawtooth', f, t, end, -4), o2 = osc(ctx, 'square', f, t, end, 4);
      vibrato(ctx, t, end, 4.8, 6, 0.6, [o1, o2]);
      const mix = ctx.createGain(); mix.gain.value = 0.45;
      o1.connect(mix); o2.connect(mix);
      mix.connect(lp).connect(g).connect(out);
      break;
    }
    case 'flute': {
      const end = t + dur + 1;
      const g = env(ctx, t, 0.12, v, dur * 0.9, 0.4);
      const o = osc(ctx, 'sine', f, t, end), o3 = osc(ctx, 'triangle', f * 2, t, end);
      vibrato(ctx, t, end, 5, 12, 0.4, [o, o3]);
      const h = ctx.createGain(); h.gain.value = 0.08; o3.connect(h).connect(g);
      // A whisper of breath.
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * (dur + 0.5)), ctx.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const n = ctx.createBufferSource(); n.buffer = nb;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 4;
      const ng = ctx.createGain(); ng.gain.value = 0.05;
      n.connect(bp).connect(ng).connect(g); n.start(t); n.stop(t + dur + 0.5);
      o.connect(g); g.connect(out);
      break;
    }
    case 'bell': {
      // Glassy FM bell.
      const end = t + 4.5;
      const g = env(ctx, t, 0.005, v, 0.01, 4);
      const car = osc(ctx, 'sine', f, t, end);
      const mod = osc(ctx, 'sine', f * 3.5, t, end);
      const idx = ctx.createGain(); idx.gain.setValueAtTime(f * 2.2, t); idx.gain.setTargetAtTime(f * 0.1, t, 0.5);
      mod.connect(idx).connect(car.frequency);
      car.connect(g).connect(out);
      break;
    }
    case 'timp': {
      const end = t + 2.2;
      const g = env(ctx, t, 0.004, v, 0.02, 1.6);
      const o = osc(ctx, 'sine', f * 1.04, t, end); o.frequency.setTargetAtTime(f, t, 0.05);
      const o2 = osc(ctx, 'sine', f * 1.5, t, end); const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, t); g2.gain.setTargetAtTime(0, t, 0.25);
      o.connect(g); o2.connect(g2).connect(g);
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length) ** 3;
      const n = ctx.createBufferSource(); n.buffer = nb;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const ng = ctx.createGain(); ng.gain.value = 0.5;
      n.connect(lp).connect(ng).connect(g); n.start(t);
      g.connect(out);
      break;
    }
  }
}

// ───────────── playback ─────────────
const spb = (s: Song) => 60 / s.bpm;
const loopLen = (s: Song) => s.bars * s.beatsPerBar * spb(s);

/** Schedules one song from `t0`, a little at a time, looping forever until stopped. */
class Player {
  bus: Bus;
  private next = 0; // index into the sorted events
  private loop = 0;
  private dynLoopBar = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: Ev[];

  constructor(private ctx: BaseAudioContext, dest: AudioNode, readonly song: Song, private t0: number) {
    this.bus = makeBus(ctx, dest);
    this.events = [...song.events].sort((a, b) => a.beat - b.beat);
  }

  /** Schedule everything that starts before `until`. */
  pump(until: number) {
    const s = this.song, len = loopLen(s), beat = spb(s);
    for (;;) {
      const base = this.t0 + this.loop * len;
      // Dynamics: ramp the bus to each bar's level across that bar.
      while (this.dynLoopBar < s.bars && base + this.dynLoopBar * s.beatsPerBar * beat < until) {
        const bt = base + this.dynLoopBar * s.beatsPerBar * beat;
        const lv = s.dyn[this.dynLoopBar] * s.level;
        if (this.loop === 0 && this.dynLoopBar === 0) this.bus.dyn.gain.setValueAtTime(lv, Math.max(bt, this.ctx.currentTime));
        else this.bus.dyn.gain.linearRampToValueAtTime(lv, bt + s.beatsPerBar * beat * 0.9);
        this.dynLoopBar++;
      }
      while (this.next < this.events.length) {
        const e = this.events[this.next];
        const t = base + e.beat * beat;
        if (t >= until) return;
        if (t >= this.ctx.currentTime - 0.02) play(this.ctx, this.bus, e, Math.max(t, this.ctx.currentTime), e.dur * beat);
        this.next++;
      }
      this.loop++; this.next = 0; this.dynLoopBar = 0;
      if (this.t0 + this.loop * len >= until) return;
    }
  }

  start(ctx: AudioContext) {
    const tick = () => this.pump(ctx.currentTime + 1.6);
    tick();
    this.timer = setInterval(tick, 250);
  }

  stop(after: number) {
    setTimeout(() => {
      if (this.timer) clearInterval(this.timer);
      try { this.bus.fade.disconnect(); } catch { /* already gone */ }
    }, after * 1000 + 200);
  }
}

let musicOn = (() => { try { return localStorage.getItem('oom-music') !== '0'; } catch { return true; } })();
let current: Player | null = null;
let wanted: SongName | null = null;
let out: { ctx: AudioContext; dest: GainNode } | null = null;
let getOut: (() => { ctx: AudioContext; dest: GainNode }) | null = null;

/** Called once by audio.ts with a way to reach the shared AudioContext and master volume. */
export function connectMusic(fn: () => { ctx: AudioContext; dest: GainNode }) { getOut = fn; }

function crossfadeTo(name: SongName | null, fadeOut = 3, fadeIn = 4) {
  if (!getOut) return;
  out ??= getOut();
  const { ctx } = out;
  if (ctx.state !== 'running') return; // started on the first click or key press (see unlock below)
  const now = ctx.currentTime;
  if (current) {
    const g = current.bus.fade.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fadeOut);
    current.stop(fadeOut);
    current = null;
  }
  if (!name || !musicOn) return;
  // Let the old piece breathe out before the new one arrives.
  const p = new Player(ctx, out.dest, SONGS[name], now + Math.min(1.2, fadeOut * 0.4));
  p.bus.fade.gain.setValueAtTime(0, now);
  p.bus.fade.gain.linearRampToValueAtTime(1, now + fadeIn);
  p.start(ctx);
  current = p;
}

export const music = {
  /** Switch to a piece (no-op if it is already playing). */
  play(name: SongName) {
    if (wanted === name && current) return;
    wanted = name;
    crossfadeTo(name);
  },
  /** Fade the current piece down (e.g. under the game-over banner), or back up. */
  duck(level: number, secs = 2) {
    if (!current || !out) return;
    const g = current.bus.fade.gain, now = out.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(level, now + secs);
  },
  isOn: () => musicOn,
  toggle() {
    musicOn = !musicOn;
    try { localStorage.setItem('oom-music', musicOn ? '1' : '0'); } catch { /* ignore */ }
    if (musicOn && wanted) crossfadeTo(wanted, 0.5, 2.5); else crossfadeTo(null, 1.2);
    return musicOn;
  },
  /** Browsers only allow audio after a gesture: start the wanted piece on the first one. */
  unlock() {
    if (!getOut) return;
    out ??= getOut();
    const go = () => { if (wanted && !current && musicOn) crossfadeTo(wanted, 0.1, 3); };
    if (out.ctx.state === 'running') go(); else out.ctx.resume().then(go).catch(() => {});
  },
};

/** Renders `secs` of a piece without real-time playback (used to check levels and make previews). */
export async function renderOffline(name: SongName, secs: number, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(2, Math.floor(secs * sampleRate), sampleRate);
  const p = new Player(ctx, ctx.destination, SONGS[name], 0.05);
  p.bus.fade.gain.value = 0.5; // the same as the live master volume
  p.pump(secs);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}
