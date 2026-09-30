import assert from 'node:assert/strict';
import { buildHueLookup, buildHueAngleLookup, HueAccentTracker, HueCycleTracker } from '../src/js/hue.js';

const positive = buildHueLookup(90);
const negative = buildHueLookup(-90);
const sample = (lookup, level) => [lookup[level * 2], lookup[level * 2 + 1]];

// A silent band stays at its source colour, regardless of slider direction.
assert.deepEqual(sample(positive, 0), sample(negative, 0));
assert.deepEqual(sample(positive, 0), [255, 128]);

// Bands with different levels get different rotations. Reversing the slider
// reverses the sine component while keeping the rotation magnitude.
assert.notDeepEqual(sample(positive, 64), sample(positive, 255));
assert.equal(sample(positive, 255)[0], sample(negative, 255)[0]);
assert.ok(sample(positive, 255)[1] > 128);
assert.ok(sample(negative, 255)[1] < 128);
assert.deepEqual(buildHueLookup(270), buildHueLookup(180));
assert.deepEqual(buildHueLookup(-270), buildHueLookup(-180));

const tracker = new HueAccentTracker(4);
tracker.update([0, 0, 0, 0], 4, 1 / 30, 1);
assert.deepEqual([...tracker.update([0.4, 0.4, 0.4, 0.4], 4, 1 / 30, 1)], [0, 0, 0, 0]);
const focused = [...tracker.update([0.4, 0.4, 0.9, 0.4], 4, 1 / 30, 1)];
assert.equal(focused[0], 0);
assert.ok(focused[2] > 200);
for (let i = 0; i < 120; i++) tracker.update([0.4, 0.4, 0.9, 0.4], 4, 1 / 30, 1);
assert.ok(tracker.levels[2] < focused[2] / 4);

const broad = new HueAccentTracker(4);
broad.update([0, 0, 0, 0], 4, 1 / 30, 0);
assert.ok([...broad.update([0.4, 0.4, 0.4, 0.4], 4, 1 / 30, 0)].every((v) => v > 0));

const cycle = new HueCycleTracker(3);
const minima = [Infinity, Infinity, Infinity], maxima = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < 900; i++) {
  const angles = cycle.update([1, 0.25, 0], 3, 1 / 30, 60);
  for (let band = 0; band < 3; band++) {
    minima[band] = Math.min(minima[band], angles[band]);
    maxima[band] = Math.max(maxima[band], angles[band]);
  }
}
assert.ok(minima[0] < -59 && maxima[0] > 59, 'Loud bands reach both hue directions');
assert.ok(minima[1] < -14 && maxima[1] > 14 && maxima[1] <= 15.01, 'Quiet bands cycle with a smaller range');
assert.ok(minima[2] === 0 && maxima[2] === 0, 'Silent bands never cycle');
const phasesBeforeSilence = [...cycle.phases];
for (let i = 0; i < 180; i++) cycle.update([0, 0, 0], 3, 1 / 30, 60);
assert.deepEqual([...cycle.phases], phasesBeforeSilence, 'No cycle clock drift without sound');
assert.ok([...cycle.angles].every((v) => Math.abs(v) < 0.001), 'Silence restores source hue');
assert.ok([...cycle.update([1, 1, 1], 3, 1 / 30, 0)].every((v) => v === 0), 'Zero amount disables rotation');
const angleLookup = buildHueAngleLookup();
const encoded = (degree) => [...angleLookup.slice((degree + 360) * 2, (degree + 360) * 2 + 2)];
assert.deepEqual(encoded(90), sample(positive, 255));
assert.deepEqual(encoded(-90), sample(negative, 255));
assert.deepEqual(encoded(-360), encoded(0));
assert.deepEqual(encoded(360), encoded(0));
console.log('Hue pulse and bidirectional per-band cycles pass: both directions, quiet range, silence fade and combined lookup.');
