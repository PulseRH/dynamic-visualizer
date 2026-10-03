import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const occlusion=await readFile(new URL('../src/js/occlusion.js',import.meta.url),'utf8');
const {prepareOcclusion}=await import(`data:text/javascript;base64,${Buffer.from(occlusion).toString('base64')}`);
const thicknessSource=await readFile(new URL('../src/js/fill-thickness.js',import.meta.url),'utf8');
const {estimateFillThickness}=await import(`data:text/javascript;base64,${Buffer.from(thicknessSource).toString('base64')}`);
const source=(await readFile(new URL('../src/js/sampler.js',import.meta.url),'utf8')).replace("'./occlusion.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(occlusion).toString('base64')}`));
const rewritten=source.replace("'./depth-bands.js'",JSON.stringify(new URL('../src/js/depth-bands.js',import.meta.url).href));
const {sampleImageToCloud}=await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`);
let pixels;
globalThis.OffscreenCanvas=class {getContext(){return {drawImage(){},getImageData(){return {data:pixels};}};}};
const image={width:400,height:240};pixels=new Uint8ClampedArray(image.width*image.height*4).fill(255);
const depth={w:100,h:60,data:new Float32Array(6000)};
for(let y=0;y<60;y++)for(let x=0;x<100;x++)depth.data[y*100+x]=x<50 ? .05:.95;
const base=sampleImageToCloud(image,depth,12000), filled=sampleImageToCloud(image,depth,12000,1), repeat=sampleImageToCloud(image,depth,12000,1);
assert.ok(filled.count>base.count);assert.ok(filled.count<=base.count*2.5);
assert.deepEqual(filled.positions.subarray(0,base.positions.length),base.positions);
assert.deepEqual(filled.colors.subarray(0,base.colors.length),base.colors);
assert.deepEqual(filled.rands.subarray(0,base.rands.length),base.rands);
assert.deepEqual(filled,repeat,'infill is deterministic');
for(let i=base.count;i<filled.count;i++)assert.equal(filled.positions[i*3+2],Math.fround(filled.positions[i*3]<0 ? .05:.95),'infill must stay on its surface');
const reconstruction=prepareOcclusion(depth,2.5);reconstruction.rgb=new Uint8Array(depth.w*depth.h*3).fill(100);delete reconstruction.mask;
Object.assign(reconstruction,estimateFillThickness(depth,reconstruction));
const classified=sampleImageToCloud(image,depth,12000,1,{reconstruction});
for(const key of ['positions','colors','rands','fillStarts','fillEnds','fillFractions'])assert.deepEqual(classified[key],filled[key],'foreground classification must not alter existing geometry');
assert.equal(classified.fillThickness.length,classified.fillFractions.length*2);
assert.equal(classified.fillForeground.length,classified.fillFractions.length*4);
let edges=0,interior=0;
for(let f=0;f<classified.fillFractions.length;f++){
 const near=classified.positions[(classified.baseCount+f)*3+2],limit=classified.fillThickness[f*2],weight=classified.fillThickness[f*2+1];
 if(near<.55){assert.equal(limit,0);assert.equal(weight,0);}
 else if(weight>0)edges++;else interior++;
}
assert.ok(edges>0&&interior>0,'foreground outlines and interior must be distinguished');
assert.equal(filled.fillThickness,undefined,'ordinary gap fill must not reserve shell metadata');
assert.equal(filled.fillForeground,undefined,'ordinary gap fill must not reserve foreground metadata');
for(let y=0;y<image.height;y++)for(let x=170;x<230;x++)pixels[(y*image.width+x)*4+3]=0;
const transparent=sampleImageToCloud(image,null,12000,1);
for(let i=0;i<transparent.count;i++){
  const sx=(transparent.positions[i*3]/transparent.aspect+.5)*image.width;
  assert.ok(sx<170.01 || sx>=229.99,'transparent holes are not bridged');
}
pixels.fill(255);
const gradient={w:400,h:240,data:Float32Array.from({length:400*240},(_,i)=>(i%400)/399)};
const seams=sampleImageToCloud(image,gradient,12000,.2,{bandMap:'depth',bands:16});
assert.ok(seams.fillFractions.length>0);
for(let f=0;f<seams.fillFractions.length;f++){
  const startBand=Math.min(15,Math.floor(seams.fillStarts[f*4+2]*16)),endBand=Math.min(15,Math.floor(seams.fillEnds[f*4+2]*16));
  assert.notEqual(startBand,endBand,'moving band seams must outrank ordinary density gaps');
  assert.ok(seams.fillFractions[f]>0 && seams.fillFractions[f]<1);
}
const dense=sampleImageToCloud(image,gradient,12000,1,{bandMap:'depth',bands:16});
const rows=new Map();
for(let f=0;f<dense.fillFractions.length;f++){
  const key=Array.from(dense.fillStarts.subarray(f*4,f*4+4)).join(',')+'|'+Array.from(dense.fillEnds.subarray(f*4,f*4+4)).join(',');
  if(!rows.has(key))rows.set(key,[]);
  rows.get(key).push(dense.fillFractions[f]);
}
assert.ok([...rows.values()].some(ts=>ts.length===12),'twelve samples across a row at full fill');
const firstRows=[...rows.keys()].slice(0,3).map(key=>key.split('|')[0].split(',').map(Number));
assert.equal(firstRows.length,3);
assert.ok(Math.hypot(firstRows[0][0]-firstRows[1][0],firstRows[0][1]-firstRows[1][1])>0,'rows spread across the seam instead of overlapping');
assert.equal(firstRows[0][3],firstRows[1][3],'parallel rows share the same endpoint motion seed');
assert.notDeepEqual([...rows.values()][0],[...rows.values()][1],'rows stagger their samples');
const large=sampleImageToCloud(image,null,400000,1);
assert.ok(large.count-large.baseCount<=180000);
const limited=sampleImageToCloud(image,null,400000,1,{gapFillPointLimit:30000});
assert.ok(limited.count-limited.baseCount<=30000&&limited.count>limited.baseCount);
const disabled=sampleImageToCloud(image,null,12000,1,{gapFillPointLimit:0});
assert.equal(disabled.count,disabled.baseCount);assert.equal(disabled.fillFractions,undefined);
const expanded=sampleImageToCloud(image,null,400000,1,{gapFillPointLimit:300000});
assert.ok(expanded.count-expanded.baseCount>large.count-large.baseCount,'the explicit point slider must allow more than the old 180k limit');
assert.ok(expanded.count-expanded.baseCount<=300000);
assert.deepEqual(expanded.positions.subarray(0,expanded.baseCount*3),large.positions.subarray(0,large.baseCount*3),'changing gap budget must preserve base points');
assert.ok(!('walls' in expanded),'ordinary Gap fill must not generate outline-wall geometry');
for(const gapFillRows of [1,7])for(const gapFillDensity of [3,24])for(const gapFillSpread of [.2,2]){
  const tuned=sampleImageToCloud(image,gradient,12000,1,{bandMap:'depth',bands:16,gapFillRows,gapFillDensity,gapFillSpread});
  assert.ok(tuned.count>tuned.baseCount && tuned.count<=tuned.baseCount*2.5);
  assert.equal(tuned.fillStarts.length,(tuned.count-tuned.baseCount)*4);
  for(let f=0;f<tuned.fillFractions.length;f++)assert.ok(tuned.fillFractions[f]>0 && tuned.fillFractions[f]<1);
}
assert.equal(sampleImageToCloud(image,null,12000,0).count,sampleImageToCloud(image,null,12000).count);
const horizontalGradient={w:400,h:240,data:Float32Array.from({length:400*240},(_,i)=>Math.floor(i/400)/239)};
const verticalSeams=sampleImageToCloud(image,gradient,12000,1,{bands:16});
const horizontalSeams=sampleImageToCloud(image,horizontalGradient,12000,1,{bands:16});
const extra=cloud=>cloud.count-cloud.baseCount;
assert.ok(Math.min(extra(verticalSeams),extra(horizontalSeams))/Math.max(extra(verticalSeams),extra(horizontalSeams))>.85,'vertical/horizontal coverage should be comparable');
let diagonal=false;
for(let f=0;f<verticalSeams.fillFractions.length;f++){
  const dx=Math.abs(verticalSeams.fillEnds[f*4]-verticalSeams.fillStarts[f*4]);
  const dy=Math.abs(verticalSeams.fillEnds[f*4+1]-verticalSeams.fillStarts[f*4+1]);
  if(dx>0 && dy>0)diagonal=true;
  assert.ok(verticalSeams.rands[verticalSeams.baseCount+f]>=0 && verticalSeams.rands[verticalSeams.baseCount+f]<1,'adaptive ranks stay inside pool');
}
assert.ok(diagonal);
const step={w:400,h:240,data:Float32Array.from({length:400*240},(_,i)=>i%400<200 ? .45:.55)};
const guarded=sampleImageToCloud(image,step,12000,1,{bands:16,gapFillDepthLimit:.06});
const relaxed=sampleImageToCloud(image,step,12000,1,{bands:16,gapFillDepthLimit:.15});
const crossing=cloud=>Array.from(cloud.fillFractions).filter((_,f)=>cloud.fillStarts[f*4+2]!==cloud.fillEnds[f*4+2]).length;
assert.equal(crossing(guarded),0);assert.ok(crossing(relaxed)>0,'depth limit makes formerly rejected seams available');
// Red foreground beside blue background: the sidewall must retain the red
// endpoint sample even where the interpolated image position samples blue.
for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
 const i=(y*image.width+x)*4;pixels[i]=x>=200 ? 220:0;pixels[i+1]=0;pixels[i+2]=x<200 ? 220:0;
}
const owned=sampleImageToCloud(image,step,12000,1,{bands:16,gapFillDepthLimit:.15,gapFillRows:1,reconstruction:{...reconstruction,w:400,h:240,thickness:new Float32Array(96000).fill(.05),edgeWeight:new Float32Array(96000).fill(1),count:0}});
let backgroundSamples=0,frontAtStart=0,frontAtEnd=0;
for(let f=0;f<owned.fillFractions.length;f++){
 const startsNear=owned.fillStarts[f*4+2],endsNear=owned.fillEnds[f*4+2];
 const isStart=startsNear>=endsNear;
 assert.equal(owned.fillForeground[f*4+3],isStart ? 1:-1);
 if(startsNear!==endsNear){
   assert.ok(owned.fillForeground[f*4]>.8&&owned.fillForeground[f*4+2]===0,'wall colour must come from original nearer red endpoint');
   if(owned.colors[(owned.baseCount+f)*3+2]>.8)backgroundSamples++;
   if(isStart)frontAtStart++;else frontAtEnd++;
 }
}
assert.ok(backgroundSamples>0&&frontAtEnd>0,'fixture must expose the original blue-midpoint bug');
console.log(`Gap fill adds ${filled.count-base.count} same-surface points; base data unchanged, repeatable, transparent holes preserved, extra count capped.`);
