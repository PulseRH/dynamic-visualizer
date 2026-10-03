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
// Smoothed depth edges must carry the far background through the full strip,
// rather than let the near-side ramp samples seed an intermediate-depth layer.
for(const rampWidth of [3,6,8])for(const vertical of [false,true]){
  const w=96,h=96,data=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const axis=vertical ? y:x;
    data[y*w+x]=.15+.75*Math.max(0,Math.min(1,(axis-24)/rampWidth));
  }
  const result=prepareOcclusion({w,h,data},2.5);
  for(let axis=24+rampWidth;axis<24+rampWidth+18;axis++){
    const i=vertical ? axis*w+48:48*w+axis;
    assert.ok(result.owner[i]>=0,'soft silhouette must extend behind the foreground');
    assert.ok(Math.abs(result.back[i]-.15)<.001,'hidden layer must keep the far plateau depth');
    assert.ok(Math.abs(result.front[i]-.9)<.001,'occluder must keep the foreground plateau depth');
  }
}
// A small foreground figure needs fill behind its centre, including where its
// two softened sides meet.
const figure={w:96,h:96,data:new Float32Array(96*96).fill(.15)};
for(let y=0;y<96;y++)for(let x=0;x<96;x++){
  const head=Math.hypot(x-48,y-28)-7;
  const body=Math.max(Math.abs(x-48)-9,Math.abs(y-52)-17);
  figure.data[y*96+x]=.15+.75*Math.max(0,Math.min(1,-Math.min(head,body)/3));
}
const figureFill=prepareOcclusion(figure,2.5);
for(const [x,y] of [[48,28],[48,45],[48,60]]){
  const i=y*96+x;assert.ok(figureFill.owner[i]>=0,'fill must reach behind a small foreground figure');
  assert.ok(figureFill.back[i]<.16,'the figure must reveal its background, not another figure slice');
  assert.ok(figureFill.front[i]>.85);
}
const layered={w:96,h:64,data:new Float32Array(96*64)};
for(let y=0;y<64;y++)for(let x=0;x<96;x++)layered.data[y*96+x]=x<24 ? .15:x<48 ? .5:.9;
const layers=prepareOcclusion(layered,2.5),layerIndex=32*96+54;
assert.ok(Math.abs(layers.back[layerIndex]-.5)<.001,'separate depth surfaces must retain their own background');
assert.ok(Math.abs(layers.front[layerIndex]-.9)<.001);
const largeDepth={w:256,h:128,data:new Float32Array(256*128).fill(.15)};
for(let y=16;y<112;y++)for(let x=48;x<208;x++)largeDepth.data[y*256+x]=.9;
const originalWidth=prepareOcclusion(largeDepth),wide=prepareOcclusion(largeDepth,2.5);
assert.ok(wide.count>originalWidth.count*1.5,'2.5x preparation must extend coverage, not only increase density');
for(let i=0;i<originalWidth.owner.length;i++)if(originalWidth.owner[i]>=0)assert.equal(wide.owner[i],originalWidth.owner[i],'wider coverage must retain the original edge owners');
wide.rgb=new Uint8Array(wide.w*wide.h*3).fill(96);delete wide.mask;
const baseline=sampleOcclusion(wide,2,400000),more=sampleOcclusion(wide,2,400000,{reconstructionPointLimit:120000,reconstructionWidth:2.5});
assert.equal(baseline.rands.length,40000);assert.equal(more.rands.length,120000,'explicit point budget must exceed both 40k and the old 20% cap');
const furthest=cloud=>{let max=0;for(let i=0;i<cloud.rands.length;i++){const x=(cloud.positions[i*3]/2+.5)*256,y=(.5-cloud.positions[i*3+1])*128;max=Math.max(max,Math.min(x-48,208-x,y-16,112-y));}return max;};
assert.ok(furthest(more)>furthest(baseline)+10,'wider sampling must add points further behind the object');
assert.ok(more.positions.every(Number.isFinite));
assert.deepEqual(more,sampleOcclusion(wide,2,400000,{reconstructionPointLimit:120000,reconstructionWidth:2.5}));
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
for(let i=0;i<50&&started<3;i++)await new Promise(r=>setTimeout(r,0));
assert.equal(started,3,'cancellation test must wait until inference has started');
controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,started,'cancelled inference worker must release its heap');
console.log('PASS: softened horizontal/vertical silhouettes keep full background depth, small foreground figures fill through their centre, 2.5x coverage retains owners, point caps, deterministic sampling, cache reuse and cancellation cleanup.');
