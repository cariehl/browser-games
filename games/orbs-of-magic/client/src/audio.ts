// Tiny synthesized sound effects: no audio assets needed.
import { connectMusic } from './music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem('oom-muted') === '1'; } catch { return false; } })();

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Music plays through the same context and master volume (so the mute button covers it too).
connectMusic(() => { const c = ac(); return { ctx: c, dest: master! }; });

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('oom-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number, delay = 0) {
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.3, filterFreq = 1200, delay = 0) {
  const c = ac();
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

export const sfx = {
  click: () => tone(660, 0.06, 'triangle', 0.15),
  hover: () => tone(1200, 0.03, 'sine', 0.04),
  select: () => { tone(520, 0.08, 'triangle', 0.18); tone(780, 0.1, 'triangle', 0.12, undefined, 0.05); },
  play: () => { noise(0.25, 0.15, 3000); tone(300, 0.25, 'sine', 0.2, 600); },
  summon: () => { tone(220, 0.3, 'triangle', 0.25, 440); tone(330, 0.35, 'sine', 0.15, 660, 0.05); },
  spell: () => { for (let i = 0; i < 4; i++) tone(600 + i * 200, 0.15, 'sine', 0.12, 1200 + i * 200, i * 0.04); },
  move: () => noise(0.12, 0.12, 600),
  hit: () => { noise(0.15, 0.35, 1800); tone(140, 0.15, 'square', 0.12, 70); },
  bigHit: () => { noise(0.4, 0.5, 900); tone(90, 0.5, 'sawtooth', 0.25, 40); },
  death: () => { tone(300, 0.5, 'sawtooth', 0.15, 60); noise(0.3, 0.2, 500); },
  heal: () => { tone(660, 0.2, 'sine', 0.15, 990); tone(880, 0.25, 'sine', 0.1, 1320, 0.08); },
  barrier: () => tone(1500, 0.3, 'triangle', 0.15, 700),
  freeze: () => { for (let i = 0; i < 3; i++) tone(2000 - i * 300, 0.12, 'sine', 0.08, undefined, i * 0.05); },
  buff: () => tone(440, 0.2, 'triangle', 0.15, 880),
  pass: () => tone(330, 0.12, 'triangle', 0.15, 250),
  yourTurn: () => { tone(523, 0.15, 'sine', 0.2); tone(784, 0.25, 'sine', 0.2, undefined, 0.1); },
  round: () => { tone(392, 0.3, 'triangle', 0.2); tone(523, 0.3, 'triangle', 0.2, undefined, 0.12); tone(659, 0.4, 'triangle', 0.2, undefined, 0.24); },
  orb: () => { tone(880, 0.6, 'sine', 0.15, 440); tone(1320, 0.5, 'sine', 0.08, 660); },
  victory: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.25, undefined, i * 0.15)),
  defeat: () => [392, 349, 311, 262].forEach((f, i) => tone(f, 0.6, 'sawtooth', 0.12, undefined, i * 0.2)),
  levelUp: () => { [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, undefined, i * 0.07)); noise(0.6, 0.15, 4000, 0.3); },
  error: () => tone(160, 0.15, 'square', 0.1),
  emote: () => tone(990, 0.1, 'sine', 0.12, 1320),
};
