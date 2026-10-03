import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../src/js/music-parallax.js',import.meta.url),'utf8');
const {MusicParallaxDirection} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const direction=new MusicParallaxDirection(), quadrants=new Set();
for(let i=0;i<1000;i++) {
  direction.update(.05,true,.4,-.8);
  assert.ok(Math.abs(Math.hypot(direction.x,direction.y)-Math.hypot(.4,.8))<1e-12,'cycling must preserve audio strength');
  quadrants.add(`${Math.sign(direction.x)},${Math.sign(direction.y)}`);
}
assert.equal(quadrants.size,4,'the same audio accent must reach all tilt directions');
const phase=direction.phase;
for(let i=0;i<100;i++)direction.update(.05,false,0,0);
assert.equal(direction.phase,phase);assert.equal(direction.x,0);assert.equal(direction.y,0);
const slow=new MusicParallaxDirection(),fast=new MusicParallaxDirection();
for(let i=0;i<100;i++)slow.update(.05,true,1,0);
for(let i=0;i<300;i++)fast.update(1/60,true,1,0);
assert.ok(Math.hypot(slow.x-fast.x,slow.y-fast.y)<1e-12,'direction must be frame-rate independent');
console.log('PASS: repeat accents cycle through four quadrants at unchanged strength; silence/off are neutral and cycle speed is frame-rate independent.');
