import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const load = async (file) => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(file, import.meta.url))).toString('base64')}`);
const { movementResponse } = await load('../src/js/response.js');
const { BandAnalyzer } = await load('../src/js/bands.js');
for (const floor of [0, 0.6, 1]) {
  for (const slope of [0.25, 1, 4]) {
    assert.equal(movementResponse(0, floor, slope), floor);
    assert.equal(movementResponse(1, floor, slope), 1);
    let previous = floor;
    for (let i = 0; i <= 100; i++) {
      const value = movementResponse(i / 100, floor, slope);
      assert.ok(value >= previous && value <= 1);
      previous = value;
    }
  }
}
assert.ok(movementResponse(0.5, 0.6, 0.5) > movementResponse(0.5, 0.6, 2));
const a = new BandAnalyzer();
a.loudReference = 0.5;
a.fromByte(new Uint8Array(1024).fill(200), 48000);
const quiet = new Uint8Array(1024).fill(25);
a.fromByte(quiet, 48000);
const initial = a.loud;
for (let i = 0; i < 18000; i++) a.fromByte(quiet, 48000);
assert.equal(a.loud, initial, 'ten minutes of quiet audio must not inflate loudness');
const bands = Array.from(a.bands);
a.loudReference = 0.25;
a.fromByte(quiet, 48000);
assert.equal(a.loud, initial * 2, 'calibration scales overall loudness');
assert.deepEqual(Array.from(a.bands), bands, 'calibration must not alter band normalization');
a.fromByte(new Uint8Array(1024), 48000);
assert.equal(a.loud, 0);
console.log('Response endpoints, slope, long-term stability, calibration, and silence checks passed.');
