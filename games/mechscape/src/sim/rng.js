// All randomness in the sim goes through one of these, so tests can seed it
// and a save can store its exact state (a loaded world rolls the same dice
// the original would have).
//
// sfc32: small, fast, and its whole state is four 32-bit numbers, which
// survive JSON unchanged.

export class Rng {
  constructor(seed) {
    this.state = [0, 0, 0, 0];
    if (seed === undefined) this.randomize();
    else this.setSeed(seed);
  }

  randomize() {
    this.setSeed((Math.random() * 0x100000000) >>> 0 ^ (Date.now() >>> 0));
  }

  setSeed(seed) {
    seed = seed >>> 0;
    this.state = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed];
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32() {
    let [a, b, c, d] = this.state;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    this.state = [a >>> 0, b >>> 0, c >>> 0, d];
    return t;
  }

  /** 0 <= x < 1 */
  randf() {
    return this.nextU32() / 0x100000000;
  }

  /** An integer from lo to hi, both inclusive. */
  randiRange(lo, hi) {
    if (hi < lo) [lo, hi] = [hi, lo];
    return lo + Math.floor(this.randf() * (hi - lo + 1));
  }

  randfRange(lo, hi) {
    return lo + this.randf() * (hi - lo);
  }
}
