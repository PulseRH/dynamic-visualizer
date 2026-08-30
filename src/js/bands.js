// Turns raw spectra into smoothed, normalized, log-spaced bands + energy/beat.
// Feed it either a byte array (WebAudio AnalyserNode) or a float magnitude
// array (our own FFT). Output drives the GPU uniforms.

export const BAND_COUNT = 64;   // default; the count is now user-configurable

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class BandAnalyzer {
  constructor(count = BAND_COUNT) {
    this.count = count;
    this.bands = new Float32Array(count);       // smoothed 0..1
    this.raw = new Float32Array(count);         // pre-smoothing 0..1
    this.energy = 0;                                  // overall loudness 0..1
    this.bassEnergy = 0;
    this.beat = 0;                                    // 1 on kick, decays
    this.level = 0;                                   // for the UI meter
    this.peak = 0.001;                                // running normalization peak
    this.bassAvg = 0.001;                             // long-term bass average
    this.lastBeatAt = 0;
    this._edges = null;
    this._edgeSr = 0;
    this.smoothUp = 0.5;
    this.smoothDown = 0.12;
  }

  /** log-spaced band edges in FFT-bin units */
  edges(bins, sampleRate) {
    if (this._edges && this._edgeSr === sampleRate && this._edges.bins === bins) return this._edges;
    const fMin = 30, fMax = Math.min(16000, sampleRate / 2);
    const lo = new Uint32Array(this.count);
    const hi = new Uint32Array(this.count);
    for (let b = 0; b < this.count; b++) {
      const f0 = fMin * Math.pow(fMax / fMin, b / this.count);
      const f1 = fMin * Math.pow(fMax / fMin, (b + 1) / this.count);
      lo[b] = Math.max(1, Math.min(bins - 1, Math.floor((f0 / (sampleRate / 2)) * bins)));
      hi[b] = Math.max(lo[b] + 1, Math.min(bins, Math.ceil((f1 / (sampleRate / 2)) * bins)));
    }
    this._edges = { bins, sampleRate, lo, hi };
    this._edgeSr = sampleRate;
    return this._edges;
  }

  /** byte-frequency data from an AnalyserNode */
  fromByte(bytes, sampleRate) {
    // bytes are 0..255 with dB scaling already applied; map to 0..1 magnitude-ish
    const bins = bytes.length;
    const { lo, hi } = this.edges(bins, sampleRate);
    for (let b = 0; b < this.count; b++) {
      let sum = 0;
      for (let i = lo[b]; i < hi[b]; i++) sum += bytes[i] / 255;
      this.raw[b] = sum / (hi[b] - lo[b]);
    }
    this._finish();
  }

  /** float magnitude spectrum from our FFT.run() */
  fromFloat(mags, sampleRate) {
    const bins = mags.length;
    const { lo, hi } = this.edges(bins, sampleRate);
    for (let b = 0; b < this.count; b++) {
      let sum = 0;
      for (let i = lo[b]; i < hi[b]; i++) sum += mags[i];
      this.raw[b] = (sum / (hi[b] - lo[b])) * 2.5;
    }
    this._finish();
  }

  _finish() {
    const { bands, raw } = this;
    // running peak normalization with slow decay keeps the look consistent
    let mx = 0.001, bass = 0;
    for (let b = 0; b < this.count; b++) {
      if (raw[b] > mx) mx = raw[b];
      if (b < 10) bass += raw[b];
    }
    this.peak = Math.max(mx, this.peak * 0.996);
    const norm = 1 / this.peak;

    bass /= 10;
    this.bassEnergy = clamp01(bass * norm);
    this.bassAvg = this.bassAvg * 0.995 + this.bassEnergy * 0.005;

    let energy = 0;
    for (let b = 0; b < this.count; b++) {
      const v = clamp01(raw[b] * norm);
      const prev = bands[b];
      bands[b] = prev + (v - prev) * (v > prev ? this.smoothUp : this.smoothDown);
      energy += bands[b];
    }
    this.energy = clamp01((energy / this.count) * 2.2);
    this.level = clamp01(this.energy * 1.4 + this.bassEnergy * 0.6);
  }

  /** call once per rendered frame: drives beat decay */
  tickBeat(nowMs) {
    // beat trigger is evaluated by the sources via `maybeBeat()`
    this.beat *= 0.92;
    if (this.beat < 0.001) this.beat = 0;
  }

  /** crude energy-flux kick detector; returns true on a fresh beat */
  maybeBeat(nowMs) {
    if (this.bassEnergy > 0.28 && this.bassEnergy > this.bassAvg * 1.45 && nowMs - this.lastBeatAt > 180) {
      this.lastBeatAt = nowMs;
      this.beat = 1;
      return true;
    }
    return false;
  }
}
