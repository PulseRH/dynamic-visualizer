import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entries = new Map();
globalThis.caches = { open: async () => ({
  match: async key => entries.get(key)?.clone(),
  put: async (key, response) => { entries.set(key, response.clone()); },
  keys: async () => [...entries.keys()],
  delete: async key => entries.delete(key),
}) };
let estimates = 0;
globalThis.Worker = class {
  postMessage() {
    estimates++;
    queueMicrotask(() => this.onmessage({ data: {
      ok: true, grid: new Float32Array([0, .25, .5, 1]), ow: 2, oh: 2,
    } }));
  }
  terminate() {}
};
const moduleUrl = new URL('../src/js/depth.js', import.meta.url);
const source = (await readFile(moduleUrl, 'utf8')).replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
const { identifyDepthImage, estimateDepth } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const image = () => ({ width: 256, height: 256 });
const first = image(), blob = new Blob(['unchanged image']);
await identifyDepthImage(first, blob);
const expected = await estimateDepth(first, 'onnx');
// Allow the optional background save to complete.
for (let i = 0; i < 10 && !entries.size; i++) await new Promise(r => setTimeout(r, 0));
assert.equal(entries.size, 1);
const reopened = image(); await identifyDepthImage(reopened, blob);
assert.deepEqual(await estimateDepth(reopened, 'onnx'), expected);
assert.equal(estimates, 1, 'unchanged content across image objects must not rerun AI');
await estimateDepth(reopened, 'onnx-base');
assert.equal(estimates, 2, 'a different model must rerun AI');
const changed = image(); await identifyDepthImage(changed, new Blob(['changed image']));
await estimateDepth(changed, 'onnx');
assert.equal(estimates, 3, 'changed image bytes must rerun AI');
globalThis.caches.open = async () => { throw new Error('Storage unavailable'); };
const unavailable = image(); await identifyDepthImage(unavailable, blob);
assert.ok((await estimateDepth(unavailable, 'onnx')).data.length);
assert.equal(estimates, 4, 'cache failure must fall back to estimation');
console.log('Saved depth reuses identical content, separates models, detects changed images and tolerates unavailable storage.');
