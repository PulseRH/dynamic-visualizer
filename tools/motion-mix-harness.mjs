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
  const keys = { wave: 'motionWave', ripple: 'motionRipple', bands: 'motionBands', drift: 'motionDrift' };
  for (const [mode, key] of Object.entries(keys)) {
    assert.equal(module.get(key), mode === style ? mix : 0, 'Migrate only the selected style');
  }
}

let persisted = { waveMode: 'wave', motionMix: 1, motionWave: 0, motionRipple: 0.4, motionSwirl: 0.7 };
let storageListener;
globalThis.window = { addEventListener: (event, fn) => { if (event === 'storage') storageListener = fn; } };
globalThis.localStorage = {
  getItem: () => JSON.stringify(persisted),
  setItem: (_, value) => { persisted = JSON.parse(value); },
};
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#layers`);
assert.equal(module.get('motionWave'), 0, 'Explicit off must not revive the old style');
assert.equal(module.get('motionRipple'), 0.4);
assert.equal(module.get('motionSwirl'), 0.7);
module.set({ motionBreathe: 0.3, vibrancyPulse: 0.65 });
assert.equal(persisted.motionRipple, 0.4, 'Layers remain independent');
assert.equal(persisted.motionSwirl, 0.7);
assert.equal(persisted.vibrancyPulse, 0.65);
persisted = { ...persisted, motionSweep: 0.8, vibrancyPulse: 0.2 };
storageListener({ key: 'dv.settings.v1' });
assert.equal(module.get('motionSweep'), 0.8, 'Wallpaper window receives layer changes');
assert.equal(module.get('vibrancyPulse'), 0.2);
module.set({ motionRipple: 0, motionSwirl: 0, motionBreathe: 0, motionSweep: 0 });
const reloaded = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#reload`);
assert.equal(reloaded.get('motionWave'), 0);
assert.equal(reloaded.get('motionRipple'), 0);
console.log('Old styles migrate into layers; independent layers and vibrancy persist, sync across windows, and stay off after reload.');
