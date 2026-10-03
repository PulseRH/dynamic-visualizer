import assert from 'node:assert/strict';
import {buildSurfaceMotion,surfaceAt} from '../src/js/surface-motion.js';
import {animatedSample} from '../src/js/framing-motion.js';
import fs from 'node:fs';

const w=80,h=60,data=new Float32Array(w*h),labels=new Uint16Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;data[i]=.35+.35*x/w+.05*y/h;labels[i]=1;
  if(x>65){data[i]=.9;labels[i]=2;} // independent protruding surface
}
labels[10*w+10]=0; // uncertainty/transparent hole
const depth={w,h,data},before=data.slice(),map=buildSurfaceMotion(depth,{labels});
assert.deepEqual(data,before,'surface motion never flattens geometric depth');
assert.equal(map.surfaceCount,2);
assert.ok(map.covered>w*h*.98);
const a=surfaceAt(map,-.3,0,data[30*w+16],1,1),b=surfaceAt(map,.2,0,data[30*w+56],1,1);
assert.ok(Math.abs(a.near-b.near)<1e-7,'sloping wall shares response anchor');
assert.notEqual(surfaceAt(map,.45,0,.9,1,1).anchor,a.anchor,'protrusion stays independent');
assert.equal(surfaceAt(map,-.3,0,.1,1,1).weight,0,'hidden background cannot inherit foreground motion');
assert.equal(surfaceAt(map,-.3,0,data[30*w+16],1,0).weight,0,'off is neutral');
assert.equal(map.data[(10*w+10)*4+1],0,'unclassified pixels remain independent');
// A large depth recess accidentally included in a building mask is rejected.
const recess=data.slice();for(let y=20;y<30;y++)for(let x=30;x<40;x++)recess[y*w+x]+=.12;
const checked=buildSurfaceMotion({w,h,data:recess},{labels});
assert.notEqual(checked.data[(25*w+35)*4],checked.data[(15*w+35)*4],'recess has its own response instead of joining the main wall');
const u=Object.fromEntries(Object.entries({uAspect:1,uBandCount:8,uBandMap:0,uInvert:0,uSurfaceMotion:{image:{data:map.data,width:w,height:h}},uSurfaceCohesion:1,uLayers:{x:0,y:0,z:0,w:0},uExtraLayers:{x:0,y:0,z:0,w:0},uWaveTime:0,uXYTime:0,uCentered:0,uEqualDepthMovement:0,uIntensity:1,uDyn:1,uDepthScale:.7,uZMove:1,uXYMove:0,uCursor:{x:0,y:0,z:0}}).map(([k,value])=>[k,{value}]));
const levels=new Uint8Array(8*4);for(let i=0;i<8;i++)levels[i*4]=i*30;
const result=new Float64Array(3),displacements=[];
for(const x of [16,40,56]){const near=data[30*w+x];animatedSample(x/w-.5,0,near,.5,u,levels,result,0);displacements.push(result[2]-near*.7);}
assert.ok(displacements.every(v=>Math.abs(v-displacements[0])<1e-8),'shared depth movement preserves slope without tearing');
u.uSurfaceCohesion.value=0;
animatedSample(16/w-.5,0,data[30*w+16],.5,u,levels,result,0);
assert.ok(Math.abs(result[2]-data[30*w+16]*.7-displacements[0])>.005,'off restores independent bands');
assert.equal(buildSurfaceMotion(depth,null),null);
// Optional private fixture: report real-wallpaper coverage without committing it.
if(fs.existsSync('.zcode/diagnose-depth.bin')&&fs.existsSync('.zcode/object-mask-review.json')){
  const bytes=fs.readFileSync('.zcode/diagnose-depth.bin');
  const fixture=buildSurfaceMotion({w:256,h:228,data:new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))},{labels:JSON.parse(fs.readFileSync('.zcode/object-mask-review.json','utf8')).labels});
  console.log(`Wallpaper: ${fixture.surfaceCount} surfaces, ${(100*fixture.covered/(256*228)).toFixed(1)}% confident coverage`);
}
console.log('PASS: coherent sloping walls, independent protrusions/recesses, hidden-depth rejection, original geometry and neutral restoration');
