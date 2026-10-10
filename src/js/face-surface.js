// Cached front-surface topology from the already sampled/cleaned depth cloud.
// Connections stay inside occupied cells; no silhouette dilation or new AI.
export function buildFaceSurface({positions,rands,count,aspect},limit=60000) {
  const budget=Math.min(limit,count),cols=Math.max(1,Math.min(budget,Math.floor(Math.sqrt(budget*aspect)))),rows=Math.max(1,Math.floor(budget/cols));
  const cells=new Int32Array(cols*rows).fill(-1),scores=new Float32Array(cells.length).fill(Infinity);
  const low=new Float32Array(cells.length).fill(Infinity),high=new Float32Array(cells.length).fill(-Infinity);
  for(let i=0;i<count;i++){
    const x=(positions[i*3]/aspect+.5)*cols,y=(positions[i*3+1]+.5)*rows,z=positions[i*3+2];
    const cx=Math.max(0,Math.min(cols-1,Math.floor(x))),cy=Math.max(0,Math.min(rows-1,Math.floor(y))),cell=cy*cols+cx;
    low[cell]=Math.min(low[cell],z);high[cell]=Math.max(high[cell],z);
    const score=(x-cx-.5)**2+(y-cy-.5)**2,old=cells[cell];
    if(score<scores[cell] || (score===scores[cell] && old>=0 && z>positions[old*3+2])){cells[cell]=i;scores[cell]=score;}
  }
  const selected=cells.filter(i=>i>=0),points=new Float32Array(selected.length*3),phases=new Float32Array(selected.length),vertices=new Int32Array(cells.length).fill(-1);
  let used=0;
  for(let cell=0;cell<cells.length;cell++)if(cells[cell]>=0){const i=cells[cell];vertices[cell]=used;points.set(positions.subarray(i*3,i*3+3),used*3);phases[used++]=rands[i];}
  const candidates=[],spans=[];
  const triangle=(a,b,c)=>{
    if(vertices[a]<0 || vertices[b]<0 || vertices[c]<0)return;
    const span=Math.max(high[a],high[b],high[c])-Math.min(low[a],low[b],low[c]);
    // An abrupt depth boundary is never connected, even at maximum continuity.
    if(span>.08)return;
    candidates.push(vertices[a],vertices[b],vertices[c]);spans.push(span);
  };
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){
    const a=y*cols+x,b=a+1,c=a+cols,d=c+1;
    const jump=(i,j)=>cells[i]<0 || cells[j]<0 ? Infinity:Math.abs(positions[cells[i]*3+2]-positions[cells[j]*3+2]);
    // Prefer the diagonal following the surface instead of cutting its corner.
    if(jump(a,d)<=jump(b,c)){triangle(a,b,d);triangle(a,d,c);}
    else {triangle(a,b,c);triangle(b,d,c);}
  }
  return {positions:points,rands:phases,candidates:new Uint32Array(candidates),spans:new Float32Array(spans),indices:new Uint32Array(candidates.length)};
}

export function selectFaceTriangles(surface,continuity) {
  const threshold=Math.min(.08,Math.max(0,continuity)*(.08/3));let count=0;
  if(continuity>0)for(let i=0;i<surface.spans.length;i++)if(surface.spans[i]<=threshold){
    surface.indices[count++]=surface.candidates[i*3];surface.indices[count++]=surface.candidates[i*3+1];surface.indices[count++]=surface.candidates[i*3+2];
  }
  return count;
}
