import assert from 'node:assert/strict';
import {cleanDepthEdges,crossesCleanDepthEdge} from '../src/js/depth-edges.js';
import fs from 'node:fs';
const w=64,h=40,data=new Float32Array(w*h),labels=new Uint16Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  data[y*w+x]=x<26 ? .85:x>32 ? .15:.85-(x-25)*.1;
  if(x<30)labels[y*w+x]=1;
}
const depth={w,h,data},before=data.slice();
const result=cleanDepthEdges(depth,null,{labels});
assert.deepEqual(data,before,'cached depth must remain unchanged');
const row=y=>Array.from(result.depth.data.subarray(y*w+25,y*w+34));
assert.ok(row(20).every(v=>Math.abs(v-.85)<1e-5||Math.abs(v-.15)<1e-5),JSON.stringify(row(20)));
assert.ok(result.changed>100,'fixture needs a meaningful softened edge');
assert.ok(result.depth.data[20*w+29]>.8 && result.depth.data[20*w+30]<.2,'AI contour locates the foreground edge');
assert.ok(crossesCleanDepthEdge(result,20*w+29,20*w+30),'Gap fill must not rebuild the removed sidewall');
assert.ok(!crossesCleanDepthEdge(result,20*w+27,20*w+28),'same-side fill remains eligible');
// Interior planar slope must survive without being flattened to one depth.
const sloping=Float32Array.from({length:w*h},(_,i)=>.2+.45*(i%w)/(w-1));
const slope=cleanDepthEdges({w,h,data:sloping});assert.deepEqual(slope.depth.data,sloping);
const flat=cleanDepthEdges({w,h,data:new Float32Array(w*h).fill(.5)});assert.equal(flat.changed,0);
// Transpose the image: vertical and horizontal silhouettes behave equally.
const transposed=new Float32Array(w*h),mask=new Uint16Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){transposed[x*h+y]=data[y*w+x];mask[x*h+y]=labels[y*w+x];}
const vertical=cleanDepthEdges({w:h,h:w,data:transposed},null,{labels:mask});
for(let y=4;y<h-4;y++)for(let x=22;x<36;x++)assert.ok(Math.abs(vertical.depth.data[x*h+y]-result.depth.data[y*w+x])<1e-5);
if(fs.existsSync('.zcode/diagnose-depth.bin')){
  const bytes=fs.readFileSync('.zcode/diagnose-depth.bin'),d={w:256,h:228,data:new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))};
  const objects=JSON.parse(fs.readFileSync('.zcode/object-mask-review.json','utf8'));
  const fixed=cleanDepthEdges(d,null,objects);
  assert.ok(fixed.changed>100 && fixed.changed<d.data.length*.25,'wallpaper correction must remain local to edges');
  fs.writeFileSync('.zcode/depth-edge-review.json',JSON.stringify({w:d.w,h:d.h,before:[...d.data],after:[...fixed.depth.data],edge:[...fixed.edgePixels]}));
  console.log(`Saved-wallpaper check: ${fixed.changed} edge pixels corrected (${(100*fixed.changed/d.data.length).toFixed(1)}% of grid)`);
}
console.log('PASS: softened edge collapses to two surfaces, AI contour selects the cut, corrected boundaries identified for foreground sidewalls, slopes/cache/flat depth remain intact, both edge orientations match');
