import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/band-choices.js', import.meta.url), 'utf8');
const { BAND_CHOICES, bandChoiceIndex } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.deepEqual(BAND_CHOICES.slice(0, 12), Array.from({length:12},(_,i)=>5+i));
assert.equal(BAND_CHOICES.at(-1), 128);
assert.ok(BAND_CHOICES.every((value, i) => i === 0 || value > BAND_CHOICES[i - 1]));
for (let saved = 8; saved <= 128; saved += 4) {
  assert.equal(BAND_CHOICES[bandChoiceIndex(saved)], saved, `saved ${saved}-band setting should remain selectable`);
}
for (const value of [5, 6, 7, 9, 10, 11, 13, 14, 15, 32, 64, 128]) {
  assert.equal(BAND_CHOICES[bandChoiceIndex(value)], value);
}

console.log('Band slider adds fine low-count choices and preserves all earlier settings.');
