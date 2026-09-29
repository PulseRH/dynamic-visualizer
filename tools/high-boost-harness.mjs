import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/bands.js', import.meta.url), 'utf8');
const { BandAnalyzer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const bins = 2048;
const bytes = Uint8Array.from({ length: bins }, (_, i) => i * 48000 / (2 * bins) > 3000 ? 40 : 180);
const flat = new BandAnalyzer(64);
const boosted = new BandAnalyzer(64);
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
for (let i = 0; i < 41; i++) {
  assert.equal(flat.bands[i], boosted.bands[i], `lower band ${i} should stay unchanged`);
}
assert.ok(boosted.bands[60] > flat.bands[60] * 1.5, 'high bands should gain substantial movement');
assert.ok(boosted.bands[60] <= 1, 'boosted bands remain in range');

boosted.highBoost = 0;
for (let frame = 0; frame < 30; frame++) {
  boosted.fromByte(bytes, 48000);
  flat.fromByte(bytes, 48000);
}
assert.ok(boosted.bands.every((value, i) => Math.abs(value - flat.bands[i]) < 1e-6),
  'returning to zero should restore the previous response after release smoothing');

console.log('High boost raises highs without lowering bass or mids.');
