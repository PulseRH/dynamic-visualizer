import assert from 'node:assert/strict';
import {prepareOcclusion} from '../src/js/occlusion.js';
import {planReconstructionLayers} from '../src/js/reconstruction-layers.js';
import {depthHistogram,depthBandLookup} from '../src/js/depth-bands.js';
const depth={w:128,h:96,data:new Float32Array(128*96)};
for(let y=0;y<96;y++)for(let x=0;x<128;x++)depth.data[y*128+x]=x<32 ? .1:x<72 ? .45:.9;
const prepared=prepareOcclusion(depth,2.5),plan=planReconstructionLayers(depth,prepared);
assert.equal(plan.layers.length,2,'distinct hidden surfaces need distinct AI masks');
assert.equal(plan.layers[0].mask[48*128+48],0,'distant reconstruction must remove the middle object');
assert.equal(plan.layers[1].mask[48*128+48],255,'middle reconstruction must retain visible middle-layer context');
assert.equal(plan.layers[1].mask[48*128+100],0,'the near foreground must be removed from both layers');
for(let i=0;i<prepared.owner.length;i++)if(prepared.owner[i]>=0){
 assert.ok(plan.assignment[i]<plan.layers.length);assert.equal(plan.layers[plan.assignment[i]].mask[i],0);
}
const many={...prepared,back:prepared.back.slice()};
let k=0;for(let i=0;i<many.owner.length;i++)if(many.owner[i]>=0)many.back[i]=(k++%8)*.12;
assert.ok(planReconstructionLayers(depth,many).layers.length<=4,'AI passes must stay capped independently of band count');
const ramp={...prepared,back:prepared.back.slice()};k=0;
for(let i=0;i<ramp.owner.length;i++)if(ramp.owner[i]>=0)ramp.back[i]=(k++%50)/100;
assert.equal(planReconstructionLayers(depth,ramp).layers.length,4,'continuous noisy depth must not chain into one shared background mask');
const histogram=depthHistogram(depth),lookup=depthBandLookup(histogram,20);
assert.ok(lookup.every((v,i)=>v<20&&(!i||v>=lookup[i-1])),'surface-aware audio assignment must remain ordered');
const peak=410,hist=new Uint32Array(1024);hist[peak]=500;
const smart=depthBandLookup(hist,10);assert.equal(smart[peak],smart[peak+1],'cut should move away from a densely populated depth');
for(const bias of [-1,0,1])assert.ok(depthBandLookup(histogram,256,bias).every(v=>v<256));
console.log('PASS: separate depth masks preserve middle-layer context, four-pass cap and ordered surface-aware audio cuts.');
