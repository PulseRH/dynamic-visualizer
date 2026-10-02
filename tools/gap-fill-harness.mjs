import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sampler.js',import.meta.url),'utf8');
const {sampleImageToCloud}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
for(const gapFillRows of [1,7])for(const gapFillDensity of [3,24])for(const gapFillSpread of [.2,2]){
  const tuned=sampleImageToCloud(image,gradient,12000,1,{bandMap:'depth',bands:16,gapFillRows,gapFillDensity,gapFillSpread});
  assert.ok(tuned.count>tuned.baseCount && tuned.count<=tuned.baseCount*2.5);
  assert.equal(tuned.fillStarts.length,(tuned.count-tuned.baseCount)*4);
  for(let f=0;f<tuned.fillFractions.length;f++)assert.ok(tuned.fillFractions[f]>0 && tuned.fillFractions[f]<1);
}
assert.equal(sampleImageToCloud(image,null,12000,0).count,sampleImageToCloud(image,null,12000).count);
console.log(`Gap fill adds ${filled.count-base.count} same-surface points; base data unchanged, repeatable, transparent holes preserved, extra count capped.`);
