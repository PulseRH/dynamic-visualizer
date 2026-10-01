import assert from 'node:assert/strict';
import { BandAnalyzer } from '../src/js/bands.js';

// Exercise the WebAudio path used by system capture, microphone and files,
// including live changes, source format changes and analyzer recreation.
for (const count of [16, 64, 128]) {
  const analyzer = new BandAnalyzer(count);
  analyzer.curve = 1;
  analyzer.stickyIn = 0;
  analyzer.stickyOut = 0;
  for (const [bins, sampleRate] of [[2048, 48000], [1024, 44100]]) {
    const bytes = new Uint8Array(bins).fill(128);
    const feed = (eq) => {
      analyzer.eq = eq;
      for (let frame = 0; frame < 80; frame++) analyzer.fromByte(bytes, sampleRate);
      return Array.from(analyzer.bands);
    };
    const flat = feed(0);
    const weighted = feed(1);
    const strong = feed(4);
    assert.ok(weighted[0] < flat[0] * 0.1, 'hearing curve should suppress sub-bass');
    assert.ok(strong[0] < weighted[0] * 0.1, 'higher settings should strengthen weighting');
    assert.ok(Math.max(...strong) > 0.9, 'peak hearing region should remain responsive');
    const restored = feed(0);
    assert.ok(restored.every((v, b) => Math.abs(v - flat[b]) < 1e-5), 'zero should restore flat response');

    const floatAnalyzer = new BandAnalyzer(count);
    floatAnalyzer.eq = 1;
    floatAnalyzer.fromFloat(new Float32Array(bins).fill(128 / 255 / 2.5), sampleRate);
    analyzer.eq = 1;
    analyzer.fromByte(bytes, sampleRate);
    assert.ok(analyzer._wraw.every((v, b) => Math.abs(v - floatAnalyzer._wraw[b]) < 1e-6),
      'byte and float inputs should apply the same hearing weights');
  }
}
console.log('Hearing curve checks passed.');
