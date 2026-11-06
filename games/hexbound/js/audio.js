// Tiny WebAudio synth for sound effects (no assets).
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  let ctx = null, master = null, muted = false;
  function ensure() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(freq, dur, type = 'sine', vol = 0.5, slide = 0, delay = 0) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.4, filt = 1200, delay = 0, q = 1) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; f.Q.value = q;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  const SFX = {
    step: () => noise(0.05, 0.08, 600),
    shove: () => noise(0.12, 0.25, 400),
    swing: () => noise(0.12, 0.18, 3000, 0, 4),
    shoot: () => { noise(0.08, 0.15, 5000); tone(900, 0.08, 'triangle', 0.08, -500); },
    cast: () => { tone(500, 0.25, 'sine', 0.15, 600); tone(750, 0.25, 'triangle', 0.08, 900); },
    hit: () => { noise(0.1, 0.35, 900); tone(140, 0.1, 'square', 0.12, -60); },
    crit: () => { noise(0.2, 0.5, 1400); tone(110, 0.25, 'sawtooth', 0.25, -60); tone(880, 0.15, 'square', 0.1, 0, 0.05); },
    miss: () => tone(320, 0.12, 'sine', 0.08, -120),
    heal: () => { tone(660, 0.18, 'sine', 0.12); tone(990, 0.25, 'sine', 0.1, 0, 0.08); },
    buff: () => tone(520, 0.2, 'triangle', 0.1, 300),
    boom: () => { noise(0.45, 0.6, 500); tone(70, 0.4, 'sine', 0.4, -40); },
    bigboom: () => { noise(0.9, 0.8, 380); tone(55, 0.8, 'sine', 0.6, -30); },
    fire: () => noise(0.5, 0.4, 1800, 0, 0.5),
    ice: () => { noise(0.3, 0.2, 7000); tone(1400, 0.3, 'triangle', 0.08, 800); },
    die: () => { tone(300, 0.3, 'sawtooth', 0.12, -220); noise(0.2, 0.15, 800); },
    bossdie: () => { for (let i = 0; i < 5; i++) { noise(0.5, 0.5, 600, i * 0.15); tone(200 - i * 30, 0.5, 'sawtooth', 0.2, -100, i * 0.15); } [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.15, 0, 0.9 + i * 0.12)); },
    down: () => { tone(220, 0.5, 'sine', 0.2, -150); },
    sting: () => { tone(880, 0.1, 'square', 0.08); tone(1320, 0.15, 'square', 0.08, 0, 0.07); },
    bark: () => { tone(160, 0.12, 'sawtooth', 0.12, 40); tone(120, 0.18, 'sawtooth', 0.1, -30, 0.1); },
    spawn: () => { noise(0.2, 0.15, 2000); tone(400, 0.2, 'triangle', 0.08, 200); },
    blink: () => tone(1200, 0.2, 'sine', 0.12, -900),
    warn: () => { tone(440, 0.18, 'square', 0.12); tone(440, 0.18, 'square', 0.12, 0, 0.25); tone(440, 0.18, 'square', 0.12, 0, 0.5); },
    turn: () => tone(600, 0.08, 'triangle', 0.08, 200),
    click: () => tone(800, 0.04, 'square', 0.05),
    momentum: () => { tone(523, 0.1, 'triangle', 0.1); tone(784, 0.15, 'triangle', 0.1, 0, 0.08); },
    win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.18, 0, i * 0.13)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 'sine', 0.18, 0, i * 0.25)),
    dice: () => { for (let i = 0; i < 4; i++) noise(0.03, 0.2, 3000, i * 0.04); },
  };
  G.Audio = {
    play(n) { try { SFX[n] && SFX[n](); } catch (e) { } },
    toggle() { muted = !muted; return muted; },
    get muted() { return muted; },
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
  };
})();
