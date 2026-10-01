import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const load = async (file) => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(file, import.meta.url))).toString('base64')}`);
const { AudioActivity } = await load('../src/js/audio-activity.js');
const { BandAnalyzer } = await import('../src/js/bands.js');
const gate = new AudioActivity();
const analyzer = new BandAnalyzer();
const silence = new Uint8Array(1024);
for (let i = 0; i < 3000; i++) analyzer.fromByte(silence, 48000);
const faint = new Uint8Array(1024);
faint.fill(1, 12, 24);
let normalizedWake = false;
for (let i = 0; i < 120; i++) {
  analyzer.fromByte(faint, 48000);
  normalizedWake ||= analyzer.energy >= 0.01;
  assert.equal(gate.update(analyzer.loud, analyzer.energy, 33), false);
}
assert.ok(normalizedWake, 'reproduce faint audio waking the old normalized-energy detector');
assert.equal(gate.update(0.5, 0.8, 33), false, 'single click must not wake');
assert.equal(gate.update(0, 0, 33), false);
assert.equal(gate.update(0.05, 0.3, 33), false);
assert.equal(gate.update(0.05, 0.3, 33), false);
assert.equal(gate.update(0.05, 0.3, 33), true, 'sustained quiet music wakes promptly');
assert.equal(gate.update(0.007, 0.1, 33), true, 'hysteresis preserves quiet tails');
assert.equal(gate.update(0, 0, 33), false);
assert.equal(gate.update(NaN, 1, 33), false);
console.log('Reproduced old false wake; faint noise and clicks rejected, sustained music and tails preserved.');
