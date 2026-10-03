import {sceneClasses,sceneObjects} from './object-mask-utils.js';
import {prepareOcclusion,OCCLUSION_MAX_WIDTH} from './occlusion.js';
import {estimateFillThickness} from './fill-thickness.js';
// Quantised SegFormer B0 ADE20K, pinned to the published ONNX revision.
const MODEL='https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/d3e5499fa8701ff0453ca940a8dfeae39b2f1504/onnx/model_quantized.onnx';
async function model(){
  let cache,response;
  try{cache=await caches.open('dv-model-cache-v1');response=await cache.match(MODEL);}catch{}
  if(!response){response=await fetch(MODEL);if(!response.ok)throw Error(`Object model download failed (${response.status})`);try{await cache?.put(MODEL,response.clone());}catch{}}
  return response.arrayBuffer();
}
self.onmessage=async({data:{bitmap,depth,reconstruction}})=>{
  let session;
  try{
    self.postMessage({status:'Loading object masks (4.5 MB first use)…'});
    const ort=await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs');ort.env.wasm.numThreads=1;
    session=await ort.InferenceSession.create(await model(),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,512,512);
    const rgba=ctx.getImageData(0,0,512,512).data,pixels=new Float32Array(3*512*512),mean=[.485,.456,.406],std=[.229,.224,.225];
    for(let i=0;i<512*512;i++)for(let c=0;c<3;c++)pixels[c*512*512+i]=(rgba[i*4+c]/255-mean[c])/std[c];
    self.postMessage({status:'Finding object surfaces…'});
    const output=await session.run({pixel_values:new ort.Tensor('float32',pixels,[1,3,512,512])});
    const logits=output[session.outputNames[0]];
    const small=new OffscreenCanvas(depth.w,depth.h),smallCtx=small.getContext('2d',{willReadFrequently:true});smallCtx.drawImage(bitmap,0,0,depth.w,depth.h);
    const alpha=smallCtx.getImageData(0,0,depth.w,depth.h).data;
    const {classes,confidence}=sceneClasses(logits.data,logits.dims,depth.w,depth.h,alpha);
    reconstruction ||= prepareOcclusion(depth,OCCLUSION_MAX_WIDTH);
    const objects=sceneObjects(classes,confidence,depth,reconstruction),field=estimateFillThickness(depth,reconstruction,objects);
    self.postMessage({ok:true,result:{...field,labels:objects.labels,count:objects.count}},[field.thickness.buffer,field.edgeWeight.buffer,objects.labels.buffer]);
  }catch(error){self.postMessage({ok:false,error:error.message});}
  finally{try{await session?.release();}catch{}bitmap?.close();}
};
