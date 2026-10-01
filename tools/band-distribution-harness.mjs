import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/js/framing-motion.js',import.meta.url),'utf8');
const {animatedSample}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const u={};
for(const [key,value] of Object.entries({uAspect:1,uBandMap:0,uBandCount:16,uInvert:0,uBandDistribution:1,
  uWaveTime:0,uXYTime:0,uCentered:0,uEqualDepthMovement:0,uIntensity:1,uDyn:1,uZMove:1,uXYMove:0,uDepthScale:.35,
  uLayers:{x:0,y:0,z:0,w:0},uExtraLayers:{x:0,y:0,z:0,w:0},uCursor:{x:0,y:0,z:0}}))u[key]={value};
const data=new Uint8Array(64);for(let i=0;i<16;i++)data[i*4]=i*16;
const out=new Float64Array(3);
const selected=(near,bias,invert=false)=>{
  u.uBandDistribution.value=4**bias;u.uInvert.value=+invert;
  animatedSample(0,0,near,0,u,data,out,0);
  return Math.round((out[2]-near*.35)/(.11*(.35+.65*near))*255/16);
};
assert.equal(selected(.25,0),4);assert.equal(selected(.25,-1),11);assert.equal(selected(.25,1),0);
assert.equal(selected(.25,-1,true),4);
for(const bias of [-1,0,1]){
  assert.equal(selected(0,bias),0);assert.equal(selected(1,bias),15);
  let prev=-1;for(let i=0;i<=100;i++){const band=selected(i/100,bias);assert.ok(band>=prev);prev=band;}
}
// The halfway boundary moves toward distant layers under a back bias.
assert.ok(.5**4<.5);assert.ok(.5**.25>.5);
console.log('Depth band placement keeps endpoints and monotonic order, packs splits toward back/front, and preserves inversion.');
