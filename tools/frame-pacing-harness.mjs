import assert from 'node:assert/strict';
import { advanceFrameClock } from '../src/js/frame-pacing.js';
for (const refresh of [60, 120, 144]) {
  for (const cap of [24, 30, 40, 60]) {
    let previous = 0, rendered = 0;
    for (let tick = 1; tick <= refresh * 10; tick++) {
      const next = advanceFrameClock(tick * 1000 / refresh, previous, 1000 / cap);
      if (next !== null) { previous = next; rendered++; }
    }
    assert.ok(Math.abs(rendered - cap * 10) <= 1, `${cap} fps at ${refresh} Hz produced ${rendered / 10}`);
  }
}
assert.equal(advanceFrameClock(100, 0, 0), 100);
const resumed = advanceFrameClock(100000, 0, 25);
assert.ok(resumed <= 100000.75 && resumed > 99975);
assert.equal(advanceFrameClock(100001, resumed, 25), null, 'Resume does not trigger catch-up renders');
console.log('24/30/40/60 fps caps retain their target rates at 60/120/144 Hz, and resume without bursts.');
