import assert from 'node:assert/strict';
import {identifyDepthImage} from '../src/js/depth.js';
import {prepareObjectThickness} from '../src/js/object-thickness.js';
import {sceneObjects} from '../src/js/object-mask-utils.js';
import {prepareOcclusion} from '../src/js/occlusion.js';
import {estimateFillThickness} from '../src/js/fill-thickness.js';
const stores=new Map();
globalThis.caches={open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
  return {match:async key=>entries.get(key)?.clone(),put:async(key,r)=>entries.set(key,r.clone()),keys:async()=>[...entries.keys()],delete:async key=>entries.delete(key)};
}};
globalThis.createImageBitmap=async image=>({...image,close(){}});
let estimates=0,terminated=0;
globalThis.Worker=class{
  postMessage({depth,reconstruction,classifications}){
    if(!classifications){estimates++;classifications={classes:new Uint8Array(depth.w*depth.h).fill(1),confidence:new Float32Array(depth.w*depth.h).fill(3)};}
    reconstruction ||= prepareOcclusion(depth,2.5);
    const objects=sceneObjects(classifications.classes,classifications.confidence,depth,reconstruction),field=estimateFillThickness(depth,reconstruction,objects);
    queueMicrotask(()=>this.onmessage({data:{ok:true,classifications,result:{...field,labels:objects.labels,count:objects.count}}}));
  }
  terminate(){terminated++;}
};
const image={},blob=new Blob(['test image']);await identifyDepthImage(image,blob);
const depth=amount=>({w:32,h:32,data:Float32Array.from({length:1024},(_,i)=>i%32<16 ? amount:.1)});
const original=depth(.9),tuned=depth(.85);
const first=await prepareObjectThickness(image,original,null);
assert.equal(estimates,1);
const next=await prepareObjectThickness(image,tuned,null);
assert.equal(estimates,1,'adjusted depth must reuse image classifications');
assert.notEqual(first,next,'derived surface/thickness fields must follow the new depth');
assert.equal(await prepareObjectThickness(image,tuned,null),next);
const reopened={};await identifyDepthImage(reopened,blob);
await prepareObjectThickness(reopened,depth(.8),null);
assert.equal(estimates,1,'classifications must survive reopening the image');
const changed={};await identifyDepthImage(changed,new Blob(['different image']));
await prepareObjectThickness(changed,original,null);assert.equal(estimates,2,'changed image must obtain its own classification');
assert.equal(terminated,4,'each preparation releases its worker');
console.log('PASS: AI classifications persist across depth tuning/reopen, surfaces recalculate, images stay separate and workers terminate.');
