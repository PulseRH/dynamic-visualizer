import assert from 'node:assert/strict';
import { BandAnalyzer } from '../src/js/bands.js';

const bins = 2048;
// Upper treble is deliberately weaker than high mids, as in typical music.
const bytes = Uint8Array.from({ length: bins }, (_, i) => {
  const hz = i * 48000 / (2 * bins);
  return hz > 10000 ? 12 : hz > 3000 ? 45 : 180;
});

for (const count of [32, 64, 128]) {
  const flat = new BandAnalyzer(count);
  const boosted = new BandAnalyzer(count);
  boosted.highBoost = 2;
  for (const analyzer of [flat, boosted]) {
    analyzer.sensitivity = 0.8;
    analyzer.floor = 0.02;
    analyzer.curve = 1;
    analyzer.stickyIn = 0;
    analyzer.stickyOut = 0;
    for (let frame = 0; frame < 30; frame++) analyzer.fromByte(bytes, 48000);
  }

  assert.equal(flat.peak, boosted.peak, 'high boost must not raise the shared normalization peak');
  for (let i = 0; i < Math.floor(count * 0.65); i++) {
    assert.equal(flat.bands[i], boosted.bands[i], `lower band ${i} should stay unchanged`);
  }
  const upperMid = Math.round((count - 1) * 0.82);
  const top = count - 1;
  const upperMidGain = boosted.bands[upperMid] / flat.bands[upperMid];
  const topGain = boosted.bands[top] / flat.bands[top];
  assert.ok(topGain > upperMidGain * 2, `top octave should gain much more than high mids at ${count} bands`);
  assert.ok(boosted.bands[top] <= 1, 'boosted bands remain in range');

  boosted.highBoost = 0;
  for (let frame = 0; frame < 30; frame++) {
    boosted.fromByte(bytes, 48000);
    flat.fromByte(bytes, 48000);
  }
  assert.ok(boosted.bands.every((value, i) => Math.abs(value - flat.bands[i]) < 1e-6),
    'returning to zero should restore the previous response after release smoothing');
}

console.log('High boost emphasizes the top octave without lowering bass or mids at 32–128 bands.');
