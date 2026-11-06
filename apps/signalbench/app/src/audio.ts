// The siren amp and keypad beeper, voiced by the firmware's PWM frequency.
export class BenchAudio {
  private ctx: AudioContext | null = null;
  private siren?: { osc: OscillatorNode; gain: GainNode };
  private beep?: { osc: OscillatorNode; gain: GainNode };
  muted = false;

  /** Browsers need a user gesture before audio can start. */
  unlock() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    const make = (type: OscillatorType, lp: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lp;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(master);
      osc.start();
      return { osc, gain };
    };
    this.siren = make("sawtooth", 3500);
    this.beep = make("square", 5000);
    this.ctx = ctx;
  }

  set(sirenHz: number, sirenOn: boolean, beeperHz: number) {
    if (!this.ctx || !this.siren || !this.beep) return;
    const t = this.ctx.currentTime;
    const s = sirenOn && !this.muted && sirenHz > 0;
    if (sirenHz > 0) this.siren.osc.frequency.setTargetAtTime(sirenHz, t, 0.01);
    this.siren.gain.gain.setTargetAtTime(s ? 0.8 : 0, t, 0.02);
    const b = beeperHz > 0 && !this.muted;
    if (beeperHz > 0) this.beep.osc.frequency.setValueAtTime(beeperHz, t);
    this.beep.gain.gain.setTargetAtTime(b ? 0.25 : 0, t, 0.005);
  }
}
