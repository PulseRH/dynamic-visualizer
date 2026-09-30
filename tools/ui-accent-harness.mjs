import assert from 'node:assert/strict';
import { imageAccent, PURPLE_ACCENT } from '../src/js/ui-accent.js';

assert.deepEqual(imageAccent(new Uint8Array([0, 0, 0, 255, 220, 220, 220, 255])), PURPLE_ACCENT);
assert.deepEqual(imageAccent(new Uint8Array([255, 0, 0, 0])), PURPLE_ACCENT);
const pixels = new Uint8Array([
  ...Array.from({ length: 8 }, () => [255, 255, 255, 255]).flat(),
  40, 40, 160, 255, 40, 40, 160, 255, 255, 20, 20, 255,
]);
const blue = imageAccent(pixels);
assert.ok(blue[2] > blue[0] && blue[2] > blue[1]);
assert.ok(Math.min(...blue) >= 80 && Math.max(...blue) <= 205);
const red = imageAccent(new Uint8Array([170, 30, 30, 255]));
assert.ok(red[0] > red[1] && red[0] > red[2]);
console.log('Image accents ignore neutrals and transparency, follow the dominant hue, and use darker shades.');
