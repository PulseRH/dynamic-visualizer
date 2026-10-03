import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../src/js/process-monitor.js',import.meta.url),'utf8');
const {ProcessMonitor} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let pending, scheduled, polls=0, cancels=0;
const rendered=[];
const monitor = new ProcessMonitor({
  sample:()=>{polls++;return new Promise((resolve,reject)=>{pending={resolve,reject};});},
  render:rows=>rendered.push(rows), schedule:callback=>{scheduled=callback;return 1;}, cancel:()=>{cancels++;scheduled=null;},
});
await monitor.poll(); assert.equal(polls,0);
monitor.setActive(true); assert.equal(polls,1);
scheduled(); assert.equal(polls,1,'slow IPC must not overlap');
monitor.setActive(false);pending.resolve(['stale']);await Promise.resolve();
assert.equal(rendered.length,0,'closing must discard an in-flight sample');
assert.equal(cancels,1); await monitor.poll(); assert.equal(polls,1);
monitor.setActive(true); pending.resolve(['visible']);await Promise.resolve();
assert.deepEqual(rendered,[['visible']]);
scheduled(); pending.reject(Error('temporarily unavailable'));await Promise.resolve();
assert.equal(rendered.at(-1),null);
scheduled(); pending.resolve(['recovered']);await Promise.resolve();
assert.deepEqual(rendered.at(-1),['recovered']);
monitor.setActive(false); assert.equal(scheduled,null);
console.log('PASS: no hidden sampling, no overlapping IPC, stale responses discarded and error recovery.');
