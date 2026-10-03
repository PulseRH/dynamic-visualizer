import {prepareOcclusion,OCCLUSION_MAX_WIDTH} from './occlusion.js';
import {estimateFillThickness} from './fill-thickness.js';

// Official MI-GAN-512 pipeline, pinned to a content revision (MIT weights).
const MODEL='https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx';
self.onmessage=async ({data:{bitmap,depth}})=>{
  let session;
  try{
    // Prepare the largest supported strip once. Width/count controls only
    // resample this asset, so dragging them cannot launch another AI session.
    const prepared=prepareOcclusion(depth,OCCLUSION_MAX_WIDTH);
    if(!prepared.count){self.postMessage({ok:true,result:null});return;}
    // Source transparency is intentional, not an occluded background.
    const alphaCanvas=new OffscreenCanvas(depth.w,depth.h),alphaCtx=alphaCanvas.getContext('2d',{willReadFrequently:true});
    alphaCtx.drawImage(bitmap,0,0,depth.w,depth.h);const alpha=alphaCtx.getImageData(0,0,depth.w,depth.h).data;
    for(let i=0;i<prepared.owner.length;i++)if(alpha[i*4+3]<24){
      if(prepared.owner[i]>=0){prepared.owner[i]=-1;prepared.count--;}
      prepared.mask[i]=255;
    }
    if(!prepared.count){self.postMessage({ok:true,result:null});return;}
    self.postMessage({status:'Loading hidden-background model (27 MB first use)…'});
    const ort=await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs');
    // One CPU worker, no competition with the live visualiser's GPU. The
    // worker and its WASM heap are terminated as soon as preparation ends.
    ort.env.wasm.numThreads=1;
    let cache=null,response=null;
    try{cache=await caches.open('dv-model-cache-v1');response=await cache.match(MODEL);}catch{}
    if(!response){response=await fetch(MODEL);if(!response.ok)throw Error(`Model download failed (${response.status})`);try{await cache?.put(MODEL,response.clone());}catch{}}
    session=await ort.InferenceSession.create(await response.arrayBuffer(),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    const scale=Math.min(512/bitmap.width,512/bitmap.height),w=Math.max(32,Math.round(bitmap.width*scale)),h=Math.max(32,Math.round(bitmap.height*scale));
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h).data;
    const image=new Uint8Array(w*h*3),mask=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,j=Math.min(depth.h-1,Math.floor(y/h*depth.h))*depth.w+Math.min(depth.w-1,Math.floor(x/w*depth.w));
      for(let c=0;c<3;c++)image[c*w*h+i]=pixels[i*4+c];mask[i]=prepared.mask[j];
    }
    self.postMessage({status:'Reconstructing behind foreground objects…'});
    const output=await session.run({image:new ort.Tensor('uint8',image,[1,3,h,w]),mask:new ort.Tensor('uint8',mask,[1,1,h,w])});
    const result=output[session.outputNames[0]],values=result.data;
    if(values.length!==w*h*3)throw Error('Unexpected reconstruction dimensions');
    const rgb=new Uint8Array(depth.w*depth.h*3);
    for(let y=0;y<depth.h;y++)for(let x=0;x<depth.w;x++){
      const i=y*depth.w+x,j=Math.min(h-1,Math.floor((y+.5)/depth.h*h))*w+Math.min(w-1,Math.floor((x+.5)/depth.w*w));
      for(let c=0;c<3;c++)rgb[i*3+c]=values[c*w*h+j];
    }
    delete prepared.mask;prepared.rgb=rgb;
    Object.assign(prepared,estimateFillThickness(depth,prepared));
    self.postMessage({ok:true,result:prepared},Object.values(prepared).filter(v=>ArrayBuffer.isView(v)).map(v=>v.buffer));
  }catch(err){self.postMessage({ok:false,error:err.message || String(err)});}
  finally{try{await session?.release();}catch{}bitmap.close();}
};
