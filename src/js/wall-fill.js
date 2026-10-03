// Side shells originate at real depth silhouettes, not arbitrary band seams.
// Their endpoint is capped on the GPU; all samples stay inside the short wall.
export function sampleWalls(reconstruction,aspect,pixels,W,H,limit=0){
  if(!reconstruction?.thickness||!limit)return null;
  limit=Math.max(0,Math.min(200000,Math.round(limit)));
  const {w,h,owner,front,back,thickness}=reconstruction,edges=[];
  for(let i=0;i<owner.length;i++)if(owner[i]===i&&thickness[i]>0&&front[i]-back[i]>=.1)edges.push(i);
  if(!edges.length)return null;
  const cloud={positions:new Float32Array(limit*3),colors:new Float32Array(limit*3),rands:new Float32Array(limit),
    fillStarts:new Float32Array(limit*4),fillEnds:new Float32Array(limit*4),fillFractions:new Float32Array(limit),fillThickness:new Float32Array(limit*2)};
  let state=0x531728a9,used=0;
  const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  for(let j=0;j<limit;j++){
    const edge=edges[Math.min(edges.length-1,Math.floor(j*edges.length/limit))];
    const u=(edge%w+.5+(rand()-.5)*.8)/w,v=(Math.floor(edge/w)+.5+(rand()-.5)*.8)/h;
    // Read the foreground side, away from the softened ramp's middle.
    const sx=Math.min(W-1,Math.max(0,Math.floor((u-reconstruction.normalX[edge]*1.5/w)*W)));
    const sy=Math.min(H-1,Math.max(0,Math.floor((v+reconstruction.normalY[edge]*1.5/h)*H))),p=(sy*W+sx)*4;
    if(pixels[p+3]<24)continue;
    const x=(u-.5)*aspect,y=.5-v,t=rand(),r=rand();
    cloud.positions.set([x,y,front[edge]],used*3);cloud.colors.set([pixels[p]/255,pixels[p+1]/255,pixels[p+2]/255],used*3);
    cloud.rands[used]=r;cloud.fillStarts.set([x,y,front[edge],r],used*4);cloud.fillEnds.set([x,y,back[edge],r],used*4);
    cloud.fillFractions[used]=t;cloud.fillThickness.set([thickness[edge],1],used*2);used++;
  }
  for(const [key,array] of Object.entries(cloud)){const size=key==='positions'||key==='colors' ? 3:key==='fillStarts'||key==='fillEnds' ? 4:key==='fillThickness' ? 2:1;cloud[key]=array.subarray(0,used*size);}
  return cloud;
}
