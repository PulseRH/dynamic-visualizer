import {depthImageIdentity} from './depth.js';
import {OCCLUSION_VERSION} from './occlusion.js';

const RESULTS='dv-hidden-background-v1',memory=new WeakMap();
const FIELDS={owner:Int32Array,back:Float32Array,front:Float32Array,normalX:Int8Array,normalY:Int8Array,rgb:Uint8Array};
// Binary cache avoids turning large typed grids into JS object/JSON trees.
export function packReconstruction(result){
  if(!result)return new ArrayBuffer(12);
  const size=12+Object.keys(FIELDS).reduce((n,key)=>n+result[key].byteLength,0);
  const buffer=new ArrayBuffer(size),header=new Uint32Array(buffer,0,3);header.set([result.w,result.h,result.count]);
  let offset=12;for(const key of Object.keys(FIELDS)){new Uint8Array(buffer,offset,result[key].byteLength).set(new Uint8Array(result[key].buffer,result[key].byteOffset,result[key].byteLength));offset+=result[key].byteLength;}
  return buffer;
}
export function unpackReconstruction(buffer){
  if(buffer.byteLength<12)throw Error('Incomplete reconstruction cache');
  const [w,h,count]=new Uint32Array(buffer,0,3);if(!w&&!h&&buffer.byteLength===12)return null;
  if(!w||!h||w*h>2000000)throw Error('Invalid reconstruction grid');
  const n=w*h,expected=12+n*17;if(buffer.byteLength!==expected)throw Error('Incomplete reconstruction grid');
  const result={w,h,count};let offset=12;
  for(const [key,Type] of Object.entries(FIELDS)){const length=n*(key==='rgb' ? 3:1),bytes=length*Type.BYTES_PER_ELEMENT;result[key]=new Type(buffer.slice(offset,offset+bytes));offset+=bytes;}
  return result;
}
export async function reconstructionKey(bitmap,depth){
  const id=depthImageIdentity(bitmap);if(!id)return null;
  const digest=await crypto.subtle.digest('SHA-256',depth.data);
  const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  return `https://dynamic-visualizer.invalid/hidden-background/${OCCLUSION_VERSION}/${id}-${depth.w}-${depth.h}-${hash}`;
}
let saves=Promise.resolve();
export async function reconstructBackground(bitmap,depth,onStatus=()=>{},signal){
  if(!depth)return null;
  if(signal?.aborted)throw new DOMException('Reconstruction cancelled','AbortError');
  const existing=memory.get(bitmap);if(existing?.depth===depth)return existing.result;
  let key=null;try{key=await reconstructionKey(bitmap,depth);}catch{}
  if(key)try{
    const cached=await(await caches.open(RESULTS)).match(key);
    if(cached){const result=unpackReconstruction(await cached.arrayBuffer());if(signal?.aborted)throw new DOMException('Reconstruction cancelled','AbortError');memory.set(bitmap,{depth,result});onStatus('Using saved hidden background');return result;}
  }catch(err){if(err.name==='AbortError')throw err;}
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
    if(key){const bytes=packReconstruction(result);saves=saves.then(async()=>{
      const cache=await caches.open(RESULTS);await cache.put(key,new Response(bytes));const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-8)))await cache.delete(old);
    }).catch(()=>{});}
    return result;
  }finally{worker?.terminate();copy.close();}
}
