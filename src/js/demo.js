// A tiny generative "demo track" (kick / snare / hats / bass / pad) rendered
// into PCM so the visualizer can animate without any audio device or input.
// Runs silently — it only feeds the FFT.

const NOTE = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // semi 0 = C4-ish ref A4=440 at 9

export class DemoSynth {
  constructor(sampleRate = 44100) {
    this.sr = sampleRate;
    this.t = 0;              // seconds of generated audio so far
    this.bpm = 124;
    this.rng = mulberry32(1337);
    // 8-bar bassline in semitones (A minor-ish)
    this.bassSeq = [-24, -24, -17, -24, -22, -22, -15, -19];
    this.chords = [
      [-12, 0, 3, 7],   // Am
      [-12, -1, 2, 7],  // Bb-ish color
      [-17, -5, 0, 3],  // F
      [-15, -3, 2, 5],  // G
    ];
  }

  /** render the next `n` samples; returns a Float32Array (mono) */
  render(n) {
    const { sr } = this;
    const out = new Float32Array(n);
    const beat = 60 / this.bpm;
    const step = beat / 4;
    const t0 = this.t;
    for (let i = 0; i < n; i++) {
      const t = t0 + i / sr;
      const stepIdx = Math.floor(t / step);
      const stepT = t - stepIdx * step;         // time into current step
      const stepProg = stepT / step;
      const inBar = stepIdx % 16;
      const bar = Math.floor(stepIdx / 16);
      const barPos = (t % (beat * 4)) / (beat * 4);

      let s = 0;

      // Kick on every beat
      const beatIdx = Math.floor(t / beat);
      const bt = t - beatIdx * beat;
      if (bt < 0.3) {
        const env = Math.exp(-bt * 11);
        const f = 42 + 95 * Math.exp(-bt * 26);
        s += Math.sin(2 * Math.PI * f * bt) * env * 0.95;
      }

      // Snare on beats 2 & 4
      const beatInBar = beatIdx % 4;
      if (beatInBar === 1 || beatInBar === 3) {
        if (bt < 0.16) s += (this.rng() * 2 - 1) * Math.exp(-bt * 30) * 0.32;
        s += Math.sin(2 * Math.PI * 185 * bt) * Math.exp(-bt * 24) * 0.16;
      }

      // Hats on offbeat 8ths
      const halfBeat = (t / beat) % 1;
      if (halfBeat > 0.5) {
        const ht = (halfBeat - 0.5) * beat;
        if (ht < 0.05) s += (this.rng() * 2 - 1) * Math.exp(-ht * 90) * 0.16;
      }

      // Bass (gated per 16th, sustains through the step)
      const root = this.bassSeq[bar % this.bassSeq.length];
      const fBass = NOTE(root);
      const gate = stepProg < 0.85 ? Math.min(1, stepT * 200) * Math.exp(-stepT * 5) : 0;
      const saw = 2 * (((t * fBass) % 1) - 0.5);
      s += (saw * 0.6 + Math.sin(2 * Math.PI * fBass * t) * 0.5) * gate * 0.34;

      // Pad chord, slow attack per bar
      const ch = this.chords[bar % this.chords.length];
      const padEnv = Math.min(1, barPos * 4) * 0.75 * Math.exp(-barPos * 1.1);
      let pad = 0;
      for (const semi of ch) {
        pad += Math.sin(2 * Math.PI * NOTE(semi + 12) * t + Math.sin(t * 0.7) * 0.4);
      }
      s += pad * 0.055 * padEnv;

      out[i] = Math.tanh(s * 1.1) * 0.9;
    }
    this.t = t0 + n / sr;
    return out;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
