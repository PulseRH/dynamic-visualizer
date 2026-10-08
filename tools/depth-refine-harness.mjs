import assert from 'node:assert/strict';
import {refineDepth,prepareAIDepth,depthTuningKey} from '../src/js/depth-refine.js';
import {prepareOcclusion} from '../src/js/occlusion.js';
const w=64,h=48,step=Float32Array.from({length:w*h},(_,i)=>i%w<32 ? .2:.8);
assert.deepEqual(refineDepth(step,w,h),step,'silhouette must not acquire intermediate depths');
const impulse=new Float32Array(w*h).fill(.2);impulse[24*w+24]=.9;
assert.deepEqual(refineDepth(impulse,w,h,{depthSmoothing:0,depthSpikeCleanup:0}),impulse,'zero must disable both filters');
assert.ok(Math.abs(refineDepth(impulse,w,h)[24*w+24]-.2)<1e-6,'isolated spike survives');
const ledge=new Float32Array(w*h).fill(.2);for(let x=5;x<58;x++)ledge[24*w+x]=.8;
const fixed=refineDepth(ledge,w,h);for(let x=6;x<57;x++)assert.ok(fixed[24*w+x]>.79,'thin continuous ledge was flattened');
const slope=Float32Array.from({length:w*h},(_,i)=>.2+(i%w)*.005);
const smooth=refineDepth(slope,w,h);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)assert.ok(Math.abs(smooth[y*w+x]-slope[y*w+x])<1e-6,'planar gradient changed');
for(const [iw,ih] of [[1330,1183],[1183,1330],[4000,500]]){
 const result=prepareAIDepth(step,w,h,iw,ih);assert.equal(Math.max(result.w,result.h),512);assert.ok(result.data.every(v=>v===0||v===1),'resampling blurred a step');
}
const field=size=>{const data=Float32Array.from({length:size*size},(_,i)=>i%size<size/2 ? .8:.2);return prepareOcclusion({w:size,h:size,data},2.5);};
const a=field(256),b=field(512);assert.ok(Math.abs(a.count/256**2-b.count/512**2)<.01,'higher resolution changed hidden width');
assert.throws(()=>prepareAIDepth(new Float32Array([NaN]),1,1,100,100));
const smaller=new Float32Array(w*h).fill(.2),at=24*w+24;smaller[at]=.26;
assert.equal(refineDepth(smaller,w,h,{depthSmoothing:0,depthSpikeCleanup:1})[at],smaller[at]);
assert.ok(Math.abs(refineDepth(smaller,w,h,{depthSmoothing:0,depthSpikeCleanup:2})[at]-.2)<1e-6,'extra cleanup must catch smaller isolated spikes');
const noise=new Float32Array(w*h).fill(.2);noise[at]=.23;
const values=[0,.5,1,2].map(depthSmoothing=>refineDepth(noise,w,h,{depthSmoothing,depthSpikeCleanup:0})[at]);
for(let i=1;i<values.length;i++)assert.ok(values[i]<values[i-1],'smoothing strength must progressively reduce local noise');
assert.deepEqual(refineDepth(step,w,h,{depthSmoothing:2,depthSpikeCleanup:2}),step,'maximum settings must retain silhouette jumps');
assert.equal(depthTuningKey('onnx',{depthSmoothing:1.051,depthSpikeCleanup:0}),'1.05:0.00');
assert.equal(depthTuningKey('auto',{depthSmoothing:2}),'');
console.log('PASS: tunable/off filters, hard edges, isolated spikes, thin ledges, planar slopes, aspect-correct detail and proportional hidden coverage.');
