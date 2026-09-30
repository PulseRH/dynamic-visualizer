import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/settings.js', import.meta.url), 'utf8');
globalThis.window = { addEventListener() {} };
globalThis.setInterval = () => 0;
for (const [saved, expected] of [
  [{}, 1],
  [{ boost: 0 }, 0],
  [{ boost: 0.5 }, 0.5],
  [{ boost: 3 }, 1],
  [{ boost: 1.5, sizePulse: 0 }, 0],
  [{ boost: 0, sizePulse: 0.8 }, 0.8],
]) {
  let persisted = saved;
  globalThis.localStorage = {
    getItem: () => JSON.stringify(persisted),
    setItem: (_, value) => { persisted = JSON.parse(value); },
  };
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
  assert.equal(module.get('sizePulse'), expected);
  module.set({ boost: 2 });
  assert.equal(module.get('sizePulse'), expected, 'Light pulse must not change Size pulse');
  module.set({ sizePulse: 0.3 });
  assert.equal(module.get('boost'), 2, 'Size pulse must not change Light pulse');
  assert.equal(persisted.sizePulse, 0.3);
}
console.log('Existing point growth migrates correctly; light and size pulses remain independent and persist.');
