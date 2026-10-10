import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=async file=>import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(file,import.meta.url),'utf8')).toString('base64')}`);
const {prepareOcclusion}=await load('../src/js/occlusion.js');
const {estimateFillThickness}=await import('../src/js/fill-thickness.js');
const {surfaceClass}=await import('../src/js/object-mask-utils.js');
const make=(scale=1)=>{
 const w=96*scale,h=96*scale,data=new Float32Array(w*h).fill(.15);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((x>=16*scale&&x<60*scale&&y>=12*scale&&y<80*scale)||(x>=76*scale&&x<84*scale&&y>=22*scale&&y<70*scale))data[y*w+x]=.9;
 return {w,h,data};
};
const depth=make(),reconstruction=prepareOcclusion(depth,2.5),field=estimateFillThickness(depth,reconstruction);
const at=(x,y)=>y*96+x;
assert.ok(field.thickness[at(16,40)]>field.thickness[at(76,40)]*3,'wide wall must have a larger shell estimate than a thin figure');
assert.ok(field.edgeWeight[at(16,40)]>.99,'outer rim must receive the shell limit');
assert.equal(field.edgeWeight[at(38,40)],0,'interior band seams must remain connected');
assert.equal(field.edgeWeight[at(80,40)],0,'thin figure centre must remain connected');
assert.equal(field.thickness[at(4,40)],0);assert.equal(field.edgeWeight[at(4,40)],0);
assert.ok(field.thickness.every(Number.isFinite)&&field.edgeWeight.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
const doubled=make(2),doubleField=estimateFillThickness(doubled,prepareOcclusion(doubled,2.5));
assert.ok(Math.abs(doubleField.thickness[80*192+32]-field.thickness[at(16,40)])<.01,'estimate must use image-plane distance, not raw grid pixels');
const transpose={w:96,h:96,data:new Float32Array(96*96)};
for(let y=0;y<96;y++)for(let x=0;x<96;x++)transpose.data[y*96+x]=depth.data[x*96+y];
const turned=estimateFillThickness(transpose,prepareOcclusion(transpose,2.5));
assert.ok(Math.abs(turned.thickness[16*96+40]-field.thickness[at(16,40)])<.02,'vertical and horizontal silhouettes need comparable estimates');
// Thickness is a fraction of the side span, like the manual percentage.
assert.ok(field.thickness[at(16,40)]>.4&&field.thickness[at(16,40)]<=1,'wide wall keeps a large share of its side');
assert.ok(field.thickness[at(76,40)]>=.05&&field.thickness[at(76,40)]<.2,'thin figure gets a thin shell, not zero');
const block=(near,back,x0,x1)=>{const data=new Float32Array(256*128).fill(back);for(let y=12;y<116;y++)for(let x=x0;x<x1;x++)data[y*256+x]=near;const depth={w:256,h:128,data};return estimateFillThickness(depth,prepareOcclusion(depth,2.5)).thickness[64*256+x0];};
assert.ok(block(.65,.15,120,136)>block(.9,.15,120,136)*1.3,'the same width across a deeper gap must occupy a smaller share');
{
  // Shares are relative to the image's typical object, like a percentage.
  const pair={w:256,h:128,data:new Float32Array(256*128).fill(.15)};
  for(let y=12;y<116;y++)for(let x=0;x<256;x++)if((x>=10&&x<170)||(x>=200&&x<210))pair.data[y*256+x]=.9;
  const shares=estimateFillThickness(pair,prepareOcclusion(pair,2.5));
  assert.ok(shares.thickness[64*256+10]>=.5,'a broad surface keeps at least half its side');
  assert.ok(shares.thickness[64*256+200]<shares.thickness[64*256+10]*.2,'a narrow object beside it gets a thin shell');
}
// A person just in front of a wall (small static step, opened by audio
// motion at low Depth scale) must still be an outline when AI types it.
{
  const scene={w:128,h:96,data:new Float32Array(128*96).fill(.37)},types=new Uint8Array(128*96).fill(surfaceClass(1));
  for(let y=30;y<80;y++)for(let x=60;x<70;x++){scene.data[y*128+x]=.41;types[y*128+x]=surfaceClass(12);}
  const prepared=prepareOcclusion(scene,2.5),typedOnly=estimateFillThickness(scene,prepared,{classes:types}),depthOnly=estimateFillThickness(scene,prepared);
  assert.equal(depthOnly.edgeWeight[50*128+60],0,'without AI types, a 0.04 depth step is not an outline');
  assert.ok(typedOnly.edgeWeight[50*128+60]>.99,'AI-typed person outline must be limited');
  assert.ok(typedOnly.thickness[50*128+60]>.02&&typedOnly.thickness[50*128+60]<=.5,'person must get a partial shell, not the whole gap');
  assert.equal(typedOnly.edgeWeight[50*128+59],0,'the wall behind the person is not its sidewall');
  assert.equal(typedOnly.edgeWeight[50*128+30],0,'wall interior stays connected');
}
// Jagged, noisy real outlines create one-pixel medial spurs. One width per
// object must not collapse to them (the earlier ~5% floor on real images).
let seed=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const noisy={w:256,h:160,data:new Float32Array(256*160)};
for(let y=0;y<160;y++)for(let x=0;x<256;x++){
  let d=.15+.05*rnd();
  if(x>=20+3*rnd()&&x<120+3*rnd()&&y>=10&&y<150)d=.75+.08*(x-20)/100+.03*rnd();
  const dx=(x-190)/14,dy=(y-90)/45;if(dx*dx+dy*dy<1+.3*rnd())d=.85+.02*rnd();
  noisy.data[y*256+x]=d;
}
const median=(field,x0,x1,key='thickness')=>{const v=[];for(let i=0;i<field.thickness.length;i++){const x=i%256;if(x>=x0&&x<x1&&field.edgeWeight[i]>.9)v.push(field[key][i]);}v.sort((a,b)=>a-b);return v[v.length>>1];};
const rough=estimateFillThickness(noisy,prepareOcclusion(noisy,2.5));
assert.ok(median(rough,15,130)>.5,'jagged building outline must keep a deep wall');
assert.ok(median(rough,170,215)>.1&&median(rough,170,215)<median(rough,15,130)*.5,'jagged person outline must be thinner than the building, but not collapse');
assert.ok(median(rough,15,130,'sizeRatio')>1&&median(rough,170,215,'sizeRatio')<1,'size ratio must rank objects around the image typical size');
// AI object types scale the same widths: a person mask is thinner than an
// equally wide building mask.
const twin={w:128,h:96,data:new Float32Array(128*96).fill(.15)},twinLabels=new Uint16Array(128*96),twinClasses=new Uint8Array(128*96);
for(let y=20;y<76;y++)for(let x=0;x<128;x++)if((x>=16&&x<40)||(x>=80&&x<104)){const i=y*128+x;twin.data[i]=.85;twinLabels[i]=x<64 ? 1:2;twinClasses[i]=surfaceClass(x<64 ? 1:12);}
const typed=estimateFillThickness(twin,prepareOcclusion(twin,2.5),{labels:twinLabels,classes:twinClasses});
assert.ok(typed.thickness[48*128+16]>typed.thickness[48*128+80]*2,'building type must run deeper than a same-width person');
// A facade receding sideways shows its own depth range; it sets a minimum.
// Compared with a fixed reference object, as shares are relative.
const facade=angled=>{
  const scene={w:128,h:96,data:new Float32Array(128*96).fill(.1)};
  for(let y=20;y<76;y++){for(let x=20;x<44;x++)scene.data[y*128+x]=angled ? .9-.4*(x-20)/23:.9;for(let x=90;x<100;x++)scene.data[y*128+x]=.9;}
  const field=estimateFillThickness(scene,prepareOcclusion(scene,2.5));
  return field.sizeRatio[48*128+20]/field.sizeRatio[48*128+90];
};
assert.ok(facade(true)>facade(false)*1.5,'depth slope across an object must deepen its wall');
const softer=make();for(let i=0;i<softer.data.length;i++)if(softer.data[i]>.5)softer.data[i]=.4;
assert.ok(estimateFillThickness(softer,prepareOcclusion(softer,2.5)).thickness[at(76,40)]>0,'detected lower-depth objects must not depend on the .55 foreground threshold');
console.log('PASS: local width and depth contrast vary thickness, interior seams stay connected, background stays untouched, orientations and grid scales agree, lower-depth silhouettes supported.');
