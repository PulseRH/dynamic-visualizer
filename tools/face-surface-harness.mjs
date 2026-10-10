import assert from 'node:assert/strict';
import {buildFaceSurface,selectFaceTriangles} from '../src/js/face-surface.js';
const grid=(n,depth,skip=()=>false)=>{
 const positions=[],rands=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(!skip(x,y)){positions.push((x+.5)/n-.5,(y+.5)/n-.5,depth(x,y));rands.push((x+y)/(2*n));}
 return {positions:new Float32Array(positions),rands:new Float32Array(rands),count:rands.length,aspect:1};
};
const flat=buildFaceSurface(grid(8,()=>.7));
assert.equal(selectFaceTriangles(flat,1),7*7*6);
assert.equal(selectFaceTriangles(flat,0),0);
const positions=flat.positions.slice();selectFaceTriangles(flat,3);
assert.deepEqual(flat.positions,positions,'continuity must never expand the silhouette');
const slope=buildFaceSurface(grid(8,x=>.4+x*.025));
const low=selectFaceTriangles(slope,.5),normal=selectFaceTriangles(slope,1),high=selectFaceTriangles(slope,2);
assert.equal(low,0);assert(normal>0);assert(high>=normal);
const step=buildFaceSurface(grid(8,x=>x<4 ? .8:.2));selectFaceTriangles(step,3);
for(let i=0;i<step.candidates.length;i+=3){const z=[0,1,2].map(j=>step.positions[step.candidates[i+j]*3+2]);assert(Math.max(...z)-Math.min(...z)<.08,'triangle crossed an object boundary');}
// A missing pixel at native density remains a hole, rather than a wide patch.
const missing=buildFaceSurface(grid(8,()=>.7,(x,y)=>x===3&&y===3));
assert(missing.candidates.length<flat.candidates.length);
const budget=buildFaceSurface(grid(400,()=>.5));
assert(budget.positions.length/3<=60000);assert(budget.candidates.length/3<=120000);
console.log('PASS: flat/slope connectivity, continuity selects cached triangles, no silhouette expansion, sharp boundaries and empty cells stay open, bounded mesh size.');
