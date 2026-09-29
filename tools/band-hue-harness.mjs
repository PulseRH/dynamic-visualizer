import assert from 'node:assert/strict';
import { buildHueLookup } from '../src/js/hue.js';

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

console.log('Band hue lookup: per-band levels and both directions passed');
