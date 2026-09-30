import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { DynamicFraming } from '../src/js/dynamic-framing.js';
import { animatedSample } from '../src/js/framing-motion.js';

const positions = [], rands = [];
for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
  const px = x / 119 - .5, py = y / 79 - .5;
  positions.push(px * 1.8, py, .1 + .85 * (1 - x / 119));
  rands.push(((x * 37 + y * 19) % 101) / 101);
}
const cloud = { positions: new Float32Array(positions), rands: new Float32Array(rands), count: rands.length, aspect: 1.8 };
const framing = new DynamicFraming(cloud);
const u = Object.fromEntries(Object.entries({ uAspect: 1.8, uBandCount: 32, uBandMap: 0, uInvert: 0,
  uLayers: { x: .7, y: .6, z: .5, w: .4 }, uExtraLayers: { x: 1, y: 1, z: .5, w: 1 },
  uWaveTime: 0, uXYTime: 0, uCentered: 1, uEqualDepthMovement: 1, uIntensity: 1.5, uDyn: 1,
  uDepthScale: .9, uZMove: 2, uXYMove: 2, uCursor: { x: -.4, y: .2, z: 1 }
}).map(([k, value]) => [k, { value }]));
const data = new Uint8Array(32 * 4);
const camera = new PerspectiveCamera(45, 16 / 9, .01, 100);
const p = new Vector3(), xyz = new Float64Array(3);
let leastCover = Infinity;
for (let step = 0; step < 120; step++) {
  u.uBandMap.value = Math.floor(step / 30);
  u.uInvert.value = step % 2;
  u.uWaveTime.value = step * .19; u.uXYTime.value = step * .13;
  for (let b = 0; b < 32; b++) data[b * 4] = Math.round(255 * (.5 + .5 * Math.sin(step * .7 + b * 1.3)));
  camera.position.set(Math.sin(step * .2) * .25, Math.cos(step * .17) * .2, 1.2);
  const x = camera.position.x, y = camera.position.y;
  framing.update(camera, 1.2, u, data, 1 / 40);
  assert.equal(camera.position.x, x); assert.equal(camera.position.y, y);
  for (let i = 0; i < cloud.count; i++) {
    animatedSample(...cloud.positions.subarray(i * 3, i * 3 + 3), cloud.rands[i], u, data, xyz, 0);
    p.set(...xyz).project(camera);
    assert.ok(Number.isFinite(p.x) && p.z > -1 && p.z < 1, 'point remains in front of camera');
    const col = i % 120, row = Math.floor(i / 120);
    if (col === 0) leastCover = Math.min(leastCover, -p.x);
    if (col === 119) leastCover = Math.min(leastCover, p.x);
    if (row === 0) leastCover = Math.min(leastCover, -p.y);
    if (row === 79) leastCover = Math.min(leastCover, p.y);
  }
}
assert.ok(leastCover > 1, `every original border stays outside the screen: ${leastCover}`);
console.log(`PASS: asymmetric depth, four band mappings, combined layers, 120 frames; least edge coverage ${leastCover.toFixed(3)}`);
const started = performance.now();
for (let i = 0; i < 2000; i++) framing.update(camera, 1.2, u, data, 1 / 40);
console.log(`Cached framing cost (32 bands): ${((performance.now() - started) / 2000).toFixed(3)} ms/frame`);
// A flat image at rest should need only the small edge safety margin.
const flat = { ...cloud, positions: cloud.positions.slice() };
for (let i = 2; i < flat.positions.length; i += 3) flat.positions[i] = 0;
const still = new DynamicFraming(flat);
data.fill(0); u.uCursor.value.z = 0;
camera.aspect = cloud.aspect;
camera.position.set(0, 0, 1.2);
const baseZ = .5 / Math.tan(camera.fov * Math.PI / 360);
still.update(camera, baseZ, u, data, 1 / 40);
assert.ok(Math.abs(camera.zoom - 1.025) < .001, `resting image adds only edge margin: ${camera.zoom}`);
assert.ok(Math.abs(still.centerX) < .001 && Math.abs(still.centerY) < .001);
console.log('PASS: flat image keeps centred cover fit with only 2.5% edge margin.');
