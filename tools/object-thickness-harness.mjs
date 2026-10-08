import assert from 'node:assert/strict';
import {sceneClasses,sceneObjects,surfaceClass,MAX_OBJECT_MASKS} from '../src/js/object-mask-utils.js';
import {estimateFillThickness} from '../src/js/fill-thickness.js';
import {prepareOcclusion} from '../src/js/occlusion.js';
import {packObjectThickness,unpackObjectThickness,packObjectClasses,unpackObjectClasses} from '../src/js/object-thickness.js';

// Building, windows and signs are one surface group, not a wall full of holes.
const logits=new Float32Array(150*4).fill(-10);
for(let i=0;i<4;i++){logits[1*4+i]=8;logits[8*4+i]=7.9;logits[43*4+i]=7.8;logits[12*4+i]=0;}
const classified=sceneClasses(logits,[1,150,2,2],8,8);
assert.ok(classified.classes.every(v=>v===surfaceClass(1)));
assert.ok(classified.confidence.every(v=>v>7),'confidence must compare surface groups, not building vs its windows');
const alpha=new Uint8Array(8*8*4).fill(255);alpha[3]=0;
assert.equal(sceneClasses(logits,[1,150,2,2],8,8,alpha).classes[0],0,'transparent holes stay unmasked');

// Two touching, similar-depth objects with distinct AI identities must not
// borrow each other's local width. Their original depth values stay intact.
const w=96,h=96,data=new Float32Array(w*h).fill(.15),labels=new Uint16Array(w*h);
for(let y=12;y<80;y++)for(let x=16;x<68;x++){data[y*w+x]=.9;labels[y*w+x]=x<60 ? 1:2;}
const depth={w,h,data},reconstruction=prepareOcclusion(depth,2.5),before=data.slice();
const plain=estimateFillThickness(depth,reconstruction),guided=estimateFillThickness(depth,reconstruction,{labels});
assert.deepEqual(data,before);
assert.ok(guided.thickness[40*w+16]>guided.thickness[40*w+67]*3,'wide building and thin person need distinct width estimates');
assert.ok(guided.thickness[40*w+67]<plain.thickness[40*w+67]*.5,'object masks must actually change the merged depth-only estimate');
assert.deepEqual(estimateFillThickness(depth,reconstruction,{labels:new Uint16Array(w*h)}),plain,'no masks must preserve depth-only fallback');

const classes=new Uint8Array(w*h),confidence=new Float32Array(w*h).fill(3);
for(let i=0;i<labels.length;i++)if(labels[i])classes[i]=labels[i]===1 ? surfaceClass(1):surfaceClass(12);
const objects=sceneObjects(classes,confidence,depth,reconstruction);
assert.equal(objects.count,2);assert.notEqual(objects.labels[40*w+20],objects.labels[40*w+65]);
confidence.fill(.01);assert.equal(sceneObjects(classes,confidence,depth,reconstruction).count,0,'uncertain regions fall back');

// A smooth chain of same-class depth must not merge every building into one.
const chain={w:96,h:32,data:Float32Array.from({length:96*32},(_,i)=>.1+(i%96)/96*.9)};
const separated=sceneObjects(new Uint8Array(96*32).fill(1),new Float32Array(96*32).fill(3),chain,prepareOcclusion(chain,2.5));
assert.ok(separated.count>=2);assert.notEqual(separated.labels[16*96+48],separated.labels[16*96+90]);

const result={...guided,labels,count:2},restored=unpackObjectThickness(packObjectThickness(result,w,h),w,h);
assert.deepEqual(restored,result);
assert.throws(()=>unpackObjectThickness(new ArrayBuffer(16),w,h));
const bad=packObjectThickness(result,w,h);new Uint32Array(bad,0,4)[3]=MAX_OBJECT_MASKS+1;
assert.throws(()=>unpackObjectThickness(bad,w,h));
const stale=packObjectThickness(result,w,h);new Uint32Array(stale,0,4)[0]=0;
assert.throws(()=>unpackObjectThickness(stale,w,h));
const classData={classes,confidence};
assert.deepEqual(unpackObjectClasses(packObjectClasses(classData,w,h),w,h),classData);
assert.throws(()=>unpackObjectClasses(packObjectClasses(classData,w,h),h,w+1));
console.log('PASS: semantic masks combine building parts, split objects/depth chains, preserve transparency and original depth, guide distinct local widths, fall back on uncertainty, round-trip cached fields and reject stale/corrupt data.');
