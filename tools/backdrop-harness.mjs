import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/backdrop-size.js', import.meta.url), 'utf8');
const { backdropTextureSize } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// A 16:9 image covering an ultrawide display needs its full display width;
// constraining both texture axes to the display would blur that width.
assert.deepEqual(backdropTextureSize(3840, 2160, 3440, 1440), { width: 3440, height: 1935 });
assert.deepEqual(backdropTextureSize(3840, 2160, 3440, 1440, 1.2), { width: 3840, height: 2160 });
assert.deepEqual(backdropTextureSize(1920, 1080, 3440, 1440), { width: 1920, height: 1080 });
assert.deepEqual(backdropTextureSize(10000, 5000, 3440, 1440, 1, 2048), { width: 2048, height: 1024 });

console.log('Backdrop textures retain cover-fit pixel density and respect the GPU texture limit.');
