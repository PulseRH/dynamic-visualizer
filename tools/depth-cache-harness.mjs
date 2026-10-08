import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {prepareAIDepth} from '../src/js/depth-refine.js';

const entries = new Map();
globalThis.caches = { open: async () => ({
  match: async key => entries.get(key)?.clone(),
  put: async (key, response) => { entries.set(key, response.clone()); },
  keys: async () => [...entries.keys()],
  delete: async key => entries.delete(key),
}) };
let estimates = 0;
let refinements=0;
globalThis.Worker = class {
  postMessage({bitmap,prediction,tuning}) {
    if(!prediction){estimates++;prediction={data:new Float32Array([.2,.4,.6,.8]),w:2,h:2};}
    else refinements++;
    const result=prepareAIDepth(prediction.data,prediction.w,prediction.h,bitmap.width,bitmap.height,512,tuning);
    queueMicrotask(() => this.onmessage({ data: {
      ok:true,...result,prediction,
    } }));
  }
  terminate() {}
};
const moduleUrl = new URL('../src/js/depth.js', import.meta.url);
const source = (await readFile(moduleUrl, 'utf8')).replaceAll('import.meta.url', JSON.stringify(moduleUrl.href)).replace("'./depth-refine.js'",JSON.stringify(new URL('../src/js/depth-refine.js',import.meta.url).href));
const { identifyDepthImage, estimateDepth } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const image = () => ({ width: 256, height: 256 });
const first = image(), blob = new Blob(['unchanged image']);
await identifyDepthImage(first, blob);
const expected = await estimateDepth(first, 'onnx');
// Allow the optional background save to complete.
for (let i = 0; i < 10 && entries.size<2; i++) await new Promise(r => setTimeout(r, 0));
assert.equal(entries.size, 2);
const reopened = image(); await identifyDepthImage(reopened, blob);
assert.deepEqual(await estimateDepth(reopened, 'onnx'), expected);
assert.equal(estimates, 1, 'unchanged content across image objects must not rerun AI');
const statuses=[];
await estimateDepth(reopened,'onnx',undefined,s=>statuses.push(s),undefined,{depthSmoothing:0,depthSpikeCleanup:0});
assert.equal(estimates,1,'tuning a reopened wallpaper must reuse its raw AI prediction');
assert.equal(refinements,1);assert.ok(statuses.includes('tuning saved AI depth…'));assert.ok(!statuses.includes('running AI model…'));
const again=await estimateDepth(reopened,'onnx',undefined,()=>{},undefined,{depthSmoothing:0,depthSpikeCleanup:0});
assert.ok(again.data.length);assert.equal(refinements,1,'unchanged tuning reuses the prepared grid');
for(const depthSmoothing of [.1,.2,.3,.4,.5,.6,.7,.8])await estimateDepth(reopened,'onnx',undefined,()=>{},undefined,{depthSmoothing});
assert.equal(estimates,1,'many slider positions must never rerun depth AI');
await estimateDepth(reopened, 'onnx-base');
assert.equal(estimates, 2, 'a different model must rerun AI');
const changed = image(); await identifyDepthImage(changed, new Blob(['changed image']));
await estimateDepth(changed, 'onnx');
assert.equal(estimates, 3, 'changed image bytes must rerun AI');
globalThis.caches.open = async () => { throw new Error('Storage unavailable'); };
const unavailable = image(); await identifyDepthImage(unavailable, blob);
assert.ok((await estimateDepth(unavailable, 'onnx')).data.length);
assert.equal(estimates, 4, 'cache failure must fall back to estimation');
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(estimateDepth(image(),'onnx',undefined,()=>{},cancelled.signal),{name:'AbortError'});
assert.equal(estimates,4,'cancelled request must never start AI');
console.log('PASS: saved/raw depth reuse across reopen/tuning, separate models/images, storage failure fallback and cancellation.');
