import assert from 'node:assert/strict';
import { buildHueLookup, HueAccentTracker } from '../src/js/hue.js';

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

console.log('Band hue lookup and focused transient accents passed');
