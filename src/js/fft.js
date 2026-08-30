// Minimal iterative radix-2 FFT (real input, precomputed tables).
// Used for the Linux PulseAudio PCM path and the demo synthesizer.

export class FFT {
  constructor(size) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of 2');
    this.size = size;
    this.half = size >> 1;
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      // Hann window
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    // bit reversal table
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    // twiddles for each stage
    this.cos = new Float32Array(this.half);
    this.sin = new Float32Array(this.half);
    for (let i = 0; i < this.half; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.mag = new Float32Array(this.half);
  }

  /** windowed magnitudes for the first half of the spectrum; `out` optional */
  run(samples, offset, out = this.mag) {
    const { size, re, im, rev, window, cos, sin, half } = this;
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      re[i] = samples[offset + j] * window[j];
      im[i] = 0;
    }
    for (let len = 2; len <= size; len <<= 1) {
      const step = size / len;
      const halfLen = len >> 1;
      for (let i = 0; i < size; i += len) {
        let t = 0;
        for (let j = 0; j < halfLen; j++) {
          const c = cos[t], s = sin[t];
          t += step;
          const iEven = i + j, iOdd = iEven + halfLen;
          const xr = re[iOdd] * c - im[iOdd] * s;
          const xi = re[iOdd] * s + im[iOdd] * c;
          re[iOdd] = re[iEven] - xr;
          im[iOdd] = im[iEven] - xi;
          re[iEven] += xr;
          im[iEven] += xi;
        }
      }
    }
    for (let i = 0; i < half; i++) {
      out[i] = Math.hypot(re[i], im[i]) / half;
    }
    return out;
  }
}
