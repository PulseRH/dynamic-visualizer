import {depthImageIdentity} from './depth.js';
import {OCCLUSION_VERSION} from './occlusion.js';

const RESULTS=`dv-hidden-background-v${OCCLUSION_VERSION}`,memory=new WeakMap();
const FIELDS={owner:Int32Array,back:Float32Array,front:Float32Array,normalX:Int8Array,normalY:Int8Array,distance:Uint8Array,rgb:Uint8Array};
const THICKNESS_FIELDS={thickness:Float32Array,edgeWeight:Float32Array,sizeRatio:Float32Array};
// Version the derived estimate separately, so changing it cannot rerun AI.
const THICKNESS_VERSION=5;
const fieldsFor=result=>result.thickness&&result.edgeWeight&&result.sizeRatio ? {...FIELDS,...THICKNESS_FIELDS}:FIELDS;
// Binary cache avoids turning large typed grids into JS object/JSON trees.
export function packReconstruction(result){
  if(!result)return new ArrayBuffer(12);
  const fields=fieldsFor(result);
  const headerBytes=fields===FIELDS ? 12:16;
  const size=headerBytes+Object.keys(fields).reduce((n,key)=>n+result[key].byteLength,0);
  const buffer=new ArrayBuffer(size),header=new Uint32Array(buffer,0,headerBytes/4);header.set([result.w,result.h,result.count]);
  if(headerBytes===16)header[3]=THICKNESS_VERSION;
  let offset=headerBytes;for(const key of Object.keys(fields)){new Uint8Array(buffer,offset,result[key].byteLength).set(new Uint8Array(result[key].buffer,result[key].byteOffset,result[key].byteLength));offset+=result[key].byteLength;}
  return buffer;
}
export function unpackReconstruction(buffer){
  if(buffer.byteLength<12)throw Error('Incomplete reconstruction cache');
  const [w,h,count]=new Uint32Array(buffer,0,3);if(!w&&!h&&buffer.byteLength===12)return null;
  if(!w||!h||w*h>2000000)throw Error('Invalid reconstruction grid');
  // Earlier thickness layouts (two fields, 26 bytes/cell) are stale: keep the
  // AI reconstruction, recompute only the inexpensive thickness estimate.
  const n=w*h,current=buffer.byteLength===16+n*30&&new Uint32Array(buffer,0,4)[3]===THICKNESS_VERSION;
  if(!current&&![12+n*18,12+n*26,16+n*26,16+n*30].includes(buffer.byteLength))throw Error('Incomplete reconstruction grid');
  const fields=current ? {...FIELDS,...THICKNESS_FIELDS}:FIELDS;
  const result={w,h,count};let offset=buffer.byteLength===12+n*18||buffer.byteLength===12+n*26 ? 12:16;
  for(const [key,Type] of Object.entries(fields)){const length=n*(key==='rgb' ? 3:1),bytes=length*Type.BYTES_PER_ELEMENT;result[key]=new Type(buffer.slice(offset,offset+bytes));offset+=bytes;}
  return result;
}
export async function reconstructionKey(bitmap,depth){
  const id=depthImageIdentity(bitmap);if(!id)return null;
  const digest=await crypto.subtle.digest('SHA-256',depth.data);
  const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  return `https://dynamic-visualizer.invalid/hidden-background/${OCCLUSION_VERSION}/${id}-${depth.w}-${depth.h}-${hash}`;
}
let saves=Promise.resolve();
function saveResult(key,result){
  if(!key)return;const bytes=packReconstruction(result);
  saves=saves.then(async()=>{
    const cache=await caches.open(RESULTS);await cache.put(key,new Response(bytes));
    const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-8)))await cache.delete(old);
  }).catch(()=>{});
}
async function upgradeThickness(depth,result,signal){
  const worker=new Worker(new URL('./fill-thickness-worker.mjs',import.meta.url),{type:'module'});
  try{
    const field=await new Promise((resolve,reject)=>{
      const stop=()=>finish(new DOMException('Reconstruction cancelled','AbortError'));
      const timer=setTimeout(()=>finish(Error('Thickness preparation timed out')),15000);
      const finish=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);error ? reject(error):resolve(value);};
      if(signal?.aborted){stop();return;}signal?.addEventListener('abort',stop,{once:true});
      worker.onmessage=({data})=>data.ok ? finish(null,data.result):finish(Error(data.error));
      worker.onerror=e=>finish(Error(e.message||'Thickness preparation failed'));
      // No image, colour model or AI runtime is needed for a saved result.
      worker.postMessage({depth,reconstruction:{owner:result.owner,back:result.back,front:result.front}});
    });
    Object.assign(result,field);return result;
  }finally{worker.terminate();}
}
export async function reconstructBackground(bitmap,depth,onStatus=()=>{},signal){
  if(!depth)return null;
  if(signal?.aborted)throw new DOMException('Reconstruction cancelled','AbortError');
  const existing=memory.get(bitmap);if(existing?.depth===depth)return existing.result;
  let key=null;try{key=await reconstructionKey(bitmap,depth);}catch{}
  let savedResult;
  if(key)try{
    const cached=await(await caches.open(RESULTS)).match(key);
    if(cached)savedResult=unpackReconstruction(await cached.arrayBuffer());
  }catch(err){if(err.name==='AbortError')throw err;}
  if(savedResult!==undefined){
    if(signal?.aborted)throw new DOMException('Reconstruction cancelled','AbortError');
    if(savedResult&&!savedResult.sizeRatio){onStatus('Estimating foreground thickness…');await upgradeThickness(depth,savedResult,signal);saveResult(key,savedResult);}
    memory.set(bitmap,{depth,result:savedResult});onStatus('Using saved hidden background');return savedResult;
  }
  const copy=await createImageBitmap(bitmap);
  let worker;
  try{
    worker=new Worker(new URL('./reconstruction-worker.mjs',import.meta.url),{type:'module'});
    const result=await new Promise((resolve,reject)=>{
      const stop=()=>finish(new DOMException('Reconstruction cancelled','AbortError'));
      const timer=setTimeout(()=>finish(Error('Reconstruction timed out')),120000);
      const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);error ? reject(error):resolve(result);};
      if(signal?.aborted){stop();return;}
      signal?.addEventListener('abort',stop,{once:true});
      worker.onmessage=({data})=>{if(data.status)onStatus(data.status);else if(data.ok)finish(null,data.result);else finish(Error(data.error));};
      worker.onerror=e=>finish(Error(e.message || 'Reconstruction worker failed'));
      worker.postMessage({bitmap:copy,depth},[copy]);
    });
    memory.set(bitmap,{depth,result});
    saveResult(key,result);
    return result;
  }finally{worker?.terminate();copy.close();}
}
