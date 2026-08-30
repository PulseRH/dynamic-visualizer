// AudioEngine — unified per-frame spectrum output from any source:
//   system : OS loopback (Windows WASAPI via Electron desktopCapturer; macOS too)
//   mic    : microphone
//   file   : audio file playback through an <audio> element (audible)
//   pulse  : Linux system audio, raw PCM from parec (PulseAudio/PipeWire)
//   demo   : built-in generative track (silent)
// Frame() returns the shared BandAnalyzer (bands[], energy, beat, level).

import { FFT } from './fft.js';
import { BandAnalyzer } from './bands.js';
import { DemoSynth } from './demo.js';
import { bridge } from './bridge.js';

const FFT_SIZE = 2048;
const RING_SIZE = FFT_SIZE * 2;

/** Circular mono sample buffer; readLatest() copies the newest N in order. */
class Ring {
  constructor(size) {
    this.size = size;
    this.buf = new Float32Array(size);
    this.pos = 0;    // next write index
    this.filled = 0; // consecutive samples available (capped at size)
    this.linear = new Float32Array(size);
  }
  write(sample) {
    this.buf[this.pos] = sample;
    this.pos = (this.pos + 1) % this.size;
    if (this.filled < this.size) this.filled++;
  }
  /** newest `n` samples, oldest→newest, into a staging array (returned) */
  readLatest(n) {
    const start = (this.pos - n + this.size * 2) % this.size;
    const { buf, linear } = this;
    const tail = Math.min(n, this.size - start);
    linear.set(buf.subarray(start, start + tail), 0);
    if (tail < n) linear.set(buf.subarray(0, n - tail), tail);
    return linear;
  }
}

export class AudioEngine {
  constructor() {
    this.analyzer = new BandAnalyzer();
    this.bandCount = 64;
    this.mode = 'none';
    this.status = '';
    this.error = null;
    this._teardown = [];
    this._ctx = null;
    this._analyser = null;
    this._byteBuf = null;
    this._fft = new FFT(FFT_SIZE);
    this._mag = new Float32Array(FFT_SIZE / 2);
    this._staging = new Float32Array(FFT_SIZE);
    this._ring = new Ring(RING_SIZE);
    this._synth = null;
    this._synthClock = 0;
    this.audioEl = null;
  }

  /** resize the analysis when the user changes the band count */
  setBandCount(n) {
    n = Math.max(4, Math.min(256, Math.round(n)));
    if (n === this.bandCount) return;
    this.bandCount = n;
    this.analyzer = new BandAnalyzer(n);
  }

  async setMode(mode, opts = {}) {
    await this.stop();
    this.mode = mode;
    this.error = null;
    try {
      if (mode === 'system') await this._startSystem();
      else if (mode === 'mic') await this._startMic();
      else if (mode === 'file') await this._startFile(opts.fileUrl);
      else if (mode === 'pulse') await this._startPulse();
      else if (mode === 'demo') this._startDemo();
      else this.status = 'audio off';
    } catch (err) {
      this.error = err;
      this.status = err.message || String(err);
      throw err;
    }
  }

  async stop() {
    for (const fn of this._teardown) { try { await fn(); } catch {} }
    this._teardown = [];
    if (this._ctx && this._ctx.state !== 'closed') { try { await this._ctx.close(); } catch {} }
    this._ctx = null;
    this._analyser = null;
    this.audioEl = null;
    this._ring.filled = 0;
    this._synth = null;
    this.mode = 'none';
    this.status = '';
  }

  // ------------------------------------------------------------------ sources

  async _ensureCtx() {
    if (!this._ctx) this._ctx = new AudioContext();
    if (this._ctx.state === 'suspended') await this._ctx.resume();
    return this._ctx;
  }

  _attachAnalyser(stream) {
    const ctx = this._ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.35;
    src.connect(analyser);
    this._analyser = analyser;
    this._byteBuf = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Windows / macOS system loopback via Electron desktop capture */
  async _startSystem() {
    if (!navigator.mediaDevices) throw new Error('mediaDevices unavailable — run inside the Electron app');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
        video: { mandatory: { chromeMediaSource: 'desktop' } },
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
      });
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    await this._ensureCtx();
    this._attachAnalyser(stream);
    this._teardown.push(() => stream.getTracks().forEach((t) => t.stop()));
    this.status = 'system loopback';
  }

  async _startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await this._ensureCtx();
    this._attachAnalyser(stream);
    this._teardown.push(() => stream.getTracks().forEach((t) => t.stop()));
    this.status = 'microphone';
  }

  async _startFile(fileUrl) {
    if (!fileUrl) throw new Error('no file chosen');
    const el = new Audio();
    el.src = fileUrl;
    el.loop = true;
    el.crossOrigin = 'anonymous';
    await this._ensureCtx();
    const src = this._ctx.createMediaElementSource(el);
    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.35;
    src.connect(analyser);
    src.connect(this._ctx.destination); // audible
    await el.play();
    this.audioEl = el;
    this._analyser = analyser;
    this._byteBuf = new Uint8Array(analyser.frequencyBinCount);
    this._teardown.push(() => { el.pause(); el.src = ''; });
    this.status = 'file playback';
  }

  /** Linux: PulseAudio/PipeWire monitor via parec, raw s16le stereo 44.1k */
  async _startPulse() {
    const stop = await bridge.startPulseCapture(
      (u8) => this._ingestPcm(u8),
      (msg) => { this.error = new Error(msg); this.status = msg; },
    );
    this._teardown.push(stop);
    this.status = 'system (PulseAudio/PipeWire)';
  }

  _ingestPcm(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const frames = Math.floor(u8.byteLength / 4); // s16le stereo
    const ring = this._ring;
    for (let f = 0; f < frames; f++) {
      const l = view.getInt16(f * 4, true) / 32768;
      const r = view.getInt16(f * 4 + 2, true) / 32768;
      ring.write((l + r) * 0.5);
    }
  }

  _startDemo() {
    this._synth = new DemoSynth(44100);
    this._synthClock = performance.now();
    this.status = 'demo signal';
  }

  // -------------------------------------------------------------------- frame

  /** call once per rendered frame; advances analysis. returns analyzer */
  frame(dtMs, nowMs) {
    const a = this.analyzer;
    if (this.mode === 'none') { a.energy *= 0.95; a.tickBeat(nowMs); return a; }

    if (this._analyser) {
      this._analyser.getByteFrequencyData(this._byteBuf);
      a.fromByte(this._byteBuf, this._ctx.sampleRate);
    } else if (this.mode === 'pulse') {
      if (this._ring.filled >= FFT_SIZE) {
        const staging = this._ring.readLatest(FFT_SIZE);
        this._fft.run(staging, 0, this._mag);
        a.fromFloat(this._mag, 44100);
      }
    } else if (this.mode === 'demo') {
      const sr = 44100;
      const now = performance.now();
      let want = Math.floor(((now - this._synthClock) / 1000) * sr);
      if (want > 0) {
        want = Math.min(want, sr >> 1); // don't bank up after a stall
        this._synthClock += (want / sr) * 1000;
        const block = this._synth.render(want);
        const ring = this._ring;
        for (let i = 0; i < block.length; i++) ring.write(block[i]);
        if (ring.filled >= FFT_SIZE) {
          const staging = ring.readLatest(FFT_SIZE);
          this._fft.run(staging, 0, this._mag);
          a.fromFloat(this._mag, sr);
        }
      }
    }
    a.maybeBeat(nowMs);
    a.tickBeat(nowMs);
    return a;
  }
}
