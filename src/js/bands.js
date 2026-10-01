// Turns raw spectra into smoothed, normalized, log-spaced bands + energy.
// Feed it either a byte array (WebAudio AnalyserNode) or a float magnitude
// array (our own FFT). Output drives the GPU uniforms.

export const BAND_COUNT = 64;   // default; the count is now user-configurable

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Input is a band level divided by the shared, decaying peak reference.
// Used by both audio analysis and the static settings diagram.
export function bandResponse(level, gain, floor, curve) {
  const amplified = clamp01(level * gain);
  return Math.pow(amplified <= floor ? 0 : (amplified - floor) / (1 - floor), curve);
}
export function easingRates(easeIn, easeOut) {
  return { up: .9 - .6 * clamp01(easeIn), down: .5 - .46 * clamp01(easeOut) };
}

// Warp progress, rather than just changing the smoothing rate. Positive bends
// start more slowly; negative bends start faster. Invert the warp from the
// current value before advancing, so changing targets cannot jump the output.
export function easeBand(previous, target, rate, bend = 0, span = 1) {
  if (!bend) return previous + (target - previous) * rate;
  const gap = Math.abs(target - previous);
  if (!gap) return previous;
  span = Math.max(gap, span);
  const exponent = Math.pow(3, Math.max(-1, Math.min(1, bend)));
  const progress = Math.pow(clamp01(1 - gap / span), 1 / exponent);
  const next = progress + (1 - progress) * rate;
  const step = Math.max(0, Math.min(gap, gap - span * (1 - Math.pow(next, exponent))));
  return previous + Math.sign(target - previous) * step;
}

export class BandAnalyzer {
  constructor(count = BAND_COUNT) {
    this.count = count;
    this.sensitivity = 1;   // input gain
    this.floor = 0;         // noise floor: below this, no movement
    this.curve = 1.5;       // gamma: higher = only peaks move
    this.bands = new Float32Array(count);       // smoothed 0..1
    this.raw = new Float32Array(count);         // pre-smoothing 0..1
    this._easeSpan = new Float64Array(count);
    this._easeDirection = new Int8Array(count);
    this.easeInShape = 0;
    this.easeOutShape = 0;
    this.energy = 0;                                  // overall loudness 0..1
    this.bassEnergy = 0;
    this.level = 0;                                   // for the UI meter
    this.peak = 0.001;                                // running normalization peak
    this.loud = 0;                                    // raw loudness vs slow peak
    this.loudReference = 0.25;
    this.rms = 0;
    this._edges = null;
    this._edgeSr = 0;
    this.eq = 0;                // equal-loudness blend: 0 = flat, 1 = full A-weight
    this._eqW = null;           // per-band A-weight, max-normalized to 1
    this._eqSr = 0;
    this._eqBins = 0;
    this._wraw = new Float32Array(count);       // tilt+EQ weighted spectrum
    this._tiltFactors = new Float64Array(count);
    this._hearingFactors = new Float64Array(count);
    this._highBoostFactors = new Float64Array(count);
    this._responseCache = null;
    this.tiltEQ = 0;            // spectral tilt: -1 bass-reactive, +1 highs-reactive
    this.highBoost = 0;         // raises highs after peak normalization, without lowering lows
    this.tiltPivot = 0.5;       // where the tilt crosses zero (0 = bass end, 1 = highs)
    this.stickyIn = 0.5;        // attack: how fast bands jump up (0 fast, 1 reluctant)
    this.stickyOut = 0.5;       // release: how long bands hold after a drop
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
    this._updateEqWeights(bins, sampleRate, lo, hi);
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
    this._updateEqWeights(bins, sampleRate, lo, hi);
    for (let b = 0; b < this.count; b++) {
      let sum = 0;
      // NaN guard: a device switch / capture hiccup can hand over garbage
      // samples; one NaN here would permanently poison bands + energy
      for (let i = lo[b]; i < hi[b]; i++) {
        const m = mags[i];
        if (Number.isFinite(m)) sum += m;
      }
      this.raw[b] = (sum / (hi[b] - lo[b])) * 2.5;
    }
    this._finish();
  }

  /** per-band A-weight (equal-loudness) at the band centers, max-normalized
   *  to 1 so enabling it doesn't shift overall scale */
  _updateEqWeights(bins, sampleRate, lo, hi) {
    if (this._eqW && this._eqSr === sampleRate && this._eqBins === bins) return;
    this._eqSr = sampleRate;
    this._eqBins = bins;
    const w = new Float32Array(this.count);
    let mx = 0;
    for (let b = 0; b < this.count; b++) {
      const f = Math.max(10, ((lo[b] + hi[b]) / 2) * (sampleRate / 2) / bins);
      const f2 = f * f;
      const ra = (12194 ** 2 * f2 * f2) /
        ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
      w[b] = Math.pow(10, (20 * Math.log10(ra) + 2.0) / 20);
      if (w[b] > mx) mx = w[b];
    }
    if (mx > 0) for (let b = 0; b < this.count; b++) w[b] /= mx;
    this._eqW = w;
  }

  _updateResponseFactors(tilt, pivot) {
    const cached = this._responseCache;
    const highBoost = Math.max(0, Math.min(3, this.highBoost ?? 0));
    if (cached && cached.tilt === tilt && cached.pivot === pivot &&
        cached.eq === this.eq && cached.highBoost === highBoost && cached.weights === this._eqW) return;
    const eqOn = this.eq > 0 && this._eqW;
    for (let b = 0; b < this.count; b++) {
      const t = this.count > 1 ? b / (this.count - 1) : 0;
      this._tiltFactors[b] = Math.pow(10, (tilt * 6 * (t - pivot) * 2) / 20);
      const w = eqOn ? this._eqW[b] : 1;
      this._hearingFactors[b] = eqOn
        ? (this.eq <= 1 ? 1 + this.eq * (w - 1) : Math.pow(Math.max(w, 0.005), this.eq))
        : 1;
      const highT = Math.max(0, Math.min(1, (t - 0.65) / 0.25));
      const highRamp = highT * highT * (3 - 2 * highT);
      // Keep the familiar upper-mid lift, then add a second rise across the
      // last octave. The old ramp was already flat by ~9 kHz, where music
      // usually has much less energy than in the high mids.
      const topT = Math.max(0, Math.min(1, (t - 0.88) / 0.11));
      const topRamp = topT * topT * (3 - 2 * topT);
      this._highBoostFactors[b] = 1 + highBoost * (highRamp + 2 * topRamp);
    }
    this._responseCache = { tilt, pivot, eq: this.eq, highBoost, weights: this._eqW };
  }

  _finish() {
    const { bands, raw } = this;
    // tilt EQ + perceptual weighting -> the working spectrum. The tilt runs
    // BEFORE the peak normalizer (bass<->highs, +/-6 dB per unit at the
    // extremes, pivoting at tiltPivot): the running peak cancels the overall
    // scale, so only the balance shifts instead of every band getting more
    // energetic.
    const tilt = Math.max(-1, Math.min(1, this.tiltEQ ?? 0));
    const pivot = Math.max(0, Math.min(1, this.tiltPivot ?? 0.5));
    this._updateResponseFactors(tilt, pivot);
    let mx = 0.001, bass = 0;
    for (let b = 0; b < this.count; b++) {
      // Keep the original multiplication order and double precision so
      // caching the settings-dependent factors does not change the signal.
      let v = raw[b] * this._tiltFactors[b];
      v *= this._hearingFactors[b];
      this._wraw[b] = v;
      if (v > mx) mx = v;
      if (b < 10) bass += raw[b];   // physical bass for the level meter
    }
    this.peak = Math.max(mx, this.peak * 0.996);
    const norm = 1 / this.peak;

    // Overall loudness uses the saved calibration, independently of band
    // normalization. Quiet tracks never raise their own loudness reference.
    let sq = 0;
    for (let b = 0; b < this.count; b++) sq += this._wraw[b] * this._wraw[b];
    let rms = Math.sqrt(sq / this.count);
    if (!Number.isFinite(rms)) rms = 0;
    this.rms = rms;
    this.loud = clamp01(rms / Math.max(this.loudReference, 0.001));

    // user response curve: gain -> noise floor -> gamma. Quiet input ends up
    // small; only peaks reach full movement.
    const gain = this.sensitivity, floor = this.floor, curve = this.curve;
    const shape = (v) => {
      return bandResponse(v * norm, gain, floor, curve);
    };

    // stickiness split into attack ("in") and release ("out"): how fast
    // bands jump up when sound rises, and how long they hold after a drop.
    // 0 = instant, 1 = reluctant/long hold
    const sIn = Math.max(0, Math.min(1, this.stickyIn ?? 0.5));
    const sOut = Math.max(0, Math.min(1, this.stickyOut ?? 0.5));
    const { up, down } = easingRates(sIn, sOut);

    bass = shape(clamp01(bass / 10));
    this.bassEnergy = bass;

    let energy = 0;
    for (let b = 0; b < this.count; b++) {
      // Boost only the upper bands after the shared peak has been calculated.
      // That keeps bass/mids at their original level instead of renormalizing
      // them downward as a positive spectral tilt can do.
      let v = shape(this._wraw[b] * this._highBoostFactors[b]);
      if (!Number.isFinite(v)) v = 0;
      const prev = bands[b];
      const direction = v > prev ? 1 : v < prev ? -1 : 0;
      const bend = direction > 0 ? this.easeInShape : this.easeOutShape;
      if (bend) {
        const gap = Math.abs(v - prev);
        this._easeSpan[b] = direction !== this._easeDirection[b] ? gap : Math.max(gap, this._easeSpan[b]);
        bands[b] = easeBand(prev, v, direction > 0 ? up : down, bend, this._easeSpan[b]);
        this._easeDirection[b] = direction;
      } else {
        bands[b] = prev + (v - prev) * (v > prev ? up : down);
        this._easeDirection[b] = 0;
      }
      energy += bands[b];
    }
    this.energy = clamp01((energy / this.count) * 2.2);
    this.level = clamp01(this.energy * 1.4 + this.bassEnergy * 0.6);
  }
}
