import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const occlusionSource=await readFile(new URL('../src/js/occlusion.js',import.meta.url),'utf8');
const occlusionUrl=`data:text/javascript;base64,${Buffer.from(occlusionSource).toString('base64')}`;
const {prepareOcclusion,sampleOcclusion}=await import(occlusionUrl);
const depth={w:128,h:96,data:new Float32Array(128*96).fill(.15)};
for(let y=20;y<76;y++)for(let x=40;x<88;x++)depth.data[y*128+x]=.9;
const prepared=prepareOcclusion(depth);assert.ok(prepared.count>1000);
for(let i=0;i<prepared.owner.length;i++)if(prepared.owner[i]>=0){
  assert.ok(depth.data[i]>.8,'hidden geometry must be inside the foreground');
  assert.ok(prepared.back[i]<.2,'hidden geometry must receive background depth');
  assert.ok(prepared.front[i]>.8);
}
assert.equal(prepareOcclusion({...depth,data:new Float32Array(depth.data.length).fill(.8)}).count,0,'flat depth must not invent occluders');
prepared.rgb=new Uint8Array(depth.w*depth.h*3).fill(96);delete prepared.mask;
for(const count of [20000,100000,400000]){
  const cloud=sampleOcclusion(prepared,4/3,count);
  assert.ok(cloud.rands.length<=Math.min(40000,count*.2));
  assert.ok(cloud.rands.length>0);
  assert.deepEqual(cloud,sampleOcclusion(prepared,4/3,count),'sampling must be deterministic');
}

const entries=new Map();globalThis.caches={open:async()=>({match:async key=>entries.get(key)?.clone(),put:async(key,value)=>entries.set(key,value.clone()),keys:async()=>[...entries.keys()],delete:async key=>entries.delete(key)})};
let started=0,terminated=0,hold=false;globalThis.createImageBitmap=async()=>({close(){}});
globalThis.Worker=class{postMessage(){started++;if(!hold)queueMicrotask(()=>this.onmessage({data:{ok:true,result:prepared}}));}terminate(){terminated++;}};
const reconstructionUrl=new URL('../src/js/reconstruction.js',import.meta.url);
const source=(await readFile(reconstructionUrl,'utf8')).replace("'./occlusion.js'",JSON.stringify(occlusionUrl)).replace("import {depthImageIdentity} from './depth.js';","const depthImageIdentity=bitmap=>bitmap.hash;").replaceAll('import.meta.url',JSON.stringify(reconstructionUrl.href));
const {packReconstruction,unpackReconstruction,reconstructBackground}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.deepEqual(unpackReconstruction(packReconstruction(prepared)),prepared);
assert.equal(unpackReconstruction(packReconstruction(null)),null);
assert.throws(()=>unpackReconstruction(new ArrayBuffer(17)));
const bitmap={hash:'same'};assert.equal(await reconstructBackground(bitmap,depth),prepared);
assert.equal(started,1);assert.equal(terminated,1);
assert.equal(await reconstructBackground(bitmap,depth),prepared);assert.equal(started,1);
for(let i=0;i<20&&!entries.size;i++)await new Promise(r=>setTimeout(r,0));
assert.deepEqual(await reconstructBackground({hash:'same'},depth),prepared);assert.equal(started,1,'same wallpaper reopened must use saved reconstruction');
await reconstructBackground({hash:'changed'},depth);assert.equal(started,2);
hold=true;const controller=new AbortController(),pending=reconstructBackground({hash:'cancel'},depth,()=>{},controller.signal);
await new Promise(r=>setTimeout(r,0));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,started,'cancelled inference worker must release its heap');
console.log('PASS: foreground-only strips, correct hidden depth, flat bypass, deterministic capped sampling, binary/cache reuse, image invalidation and cancellation cleanup.');
