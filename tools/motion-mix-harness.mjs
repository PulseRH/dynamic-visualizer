import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/settings.js', import.meta.url), 'utf8');
globalThis.window = { addEventListener() {} };
globalThis.setInterval = () => 0;

for (const [saved, style, mix] of [
  [{ waveMode: 'audio' }, 'ripple', 0],
  [{ waveMode: 'wave' }, 'wave', 1],
  [{ waveMode: 'ripple' }, 'ripple', 1],
  [{ waveMode: 'bands' }, 'bands', 1],
  [{ waveMode: 'drift' }, 'drift', 1],
  [{ waveMode: 'ripple', motionMix: 0.45 }, 'ripple', 0.45],
  [{}, 'ripple', 0],
]) {
  globalThis.localStorage = { getItem: () => JSON.stringify(saved), setItem() {} };
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
  assert.equal(module.get('waveMode'), style);
  assert.equal(module.get('motionMix'), mix);
}
console.log('Existing Audio and style settings retain their original endpoints; new mixes persist.');
