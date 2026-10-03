import {reconstructionKey} from './reconstruction.js';
import {OBJECT_MASK_VERSION,MAX_OBJECT_MASKS} from './object-mask-utils.js';

const CACHE='dv-object-thickness-v1',memory=new WeakMap();
export function packObjectThickness(result,w,h){
  const n=w*h,buffer=new ArrayBuffer(16+n*10);
  new Uint32Array(buffer,0,4).set([OBJECT_MASK_VERSION,w,h,result.count]);
  new Uint8Array(buffer,16,n*4).set(new Uint8Array(result.thickness.buffer,result.thickness.byteOffset,n*4));
  new Uint8Array(buffer,16+n*4,n*4).set(new Uint8Array(result.edgeWeight.buffer,result.edgeWeight.byteOffset,n*4));
  new Uint8Array(buffer,16+n*8,n*2).set(new Uint8Array(result.labels.buffer,result.labels.byteOffset,n*2));
  return buffer;
}
export function unpackObjectThickness(buffer,w,h){
  if(buffer.byteLength!==16+w*h*10)throw Error('Invalid object thickness cache');
  const [version,width,height,count]=new Uint32Array(buffer,0,4);
  if(version!==OBJECT_MASK_VERSION||width!==w||height!==h||count>MAX_OBJECT_MASKS)throw Error('Outdated object thickness cache');
  const n=w*h;
  return {count,thickness:new Float32Array(buffer.slice(16,16+n*4)),edgeWeight:new Float32Array(buffer.slice(16+n*4,16+n*8)),labels:new Uint16Array(buffer.slice(16+n*8))};
}
export async function prepareObjectThickness(bitmap,depth,reconstruction,onStatus=()=>{},signal){
  if(signal?.aborted)throw new DOMException('Object masks cancelled','AbortError');
  const existing=memory.get(bitmap);if(existing?.depth===depth)return existing.result;
  let key=null;
  try{key=(await reconstructionKey(bitmap,depth))?.replace('/hidden-background/','/object-thickness/'+OBJECT_MASK_VERSION+'/');}catch{}
  if(key)try{
    const saved=await(await caches.open(CACHE)).match(key);
    if(saved){
      const result=unpackObjectThickness(await saved.arrayBuffer(),depth.w,depth.h);
      if(signal?.aborted)throw new DOMException('Object masks cancelled','AbortError');
      memory.set(bitmap,{depth,result});onStatus('Using saved object masks');return result;
    }
  }catch(error){if(error.name==='AbortError')throw error;}
  const copy=await createImageBitmap(bitmap),worker=new Worker(new URL('./object-masks-worker.mjs',import.meta.url),{type:'module'});
  try{
    const result=await new Promise((resolve,reject)=>{
      const stop=()=>finish(new DOMException('Object masks cancelled','AbortError'));
      const finish=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);error ? reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(Error('Object mask preparation timed out')),180000);
      if(signal?.aborted){stop();return;}signal?.addEventListener('abort',stop,{once:true});
      worker.onmessage=({data})=>{if(data.status)onStatus(data.status);else if(data.ok)finish(null,data.result);else finish(Error(data.error));};
      worker.onerror=e=>finish(Error(e.message||'Object masks unavailable'));
      worker.postMessage({bitmap:copy,depth,reconstruction:reconstruction ? {owner:reconstruction.owner,back:reconstruction.back,front:reconstruction.front}:null},[copy]);
    });
    memory.set(bitmap,{depth,result});
    if(key)try{
      const cache=await caches.open(CACHE);await cache.put(key,new Response(packObjectThickness(result,depth.w,depth.h)));
      const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-8)))await cache.delete(old);
    }catch{}
    return result;
  }finally{worker.terminate();copy.close();}
}
