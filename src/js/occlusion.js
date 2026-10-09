// Geometry preparation only. AI colours are generated separately, once per image.
// A bounded strip behind each significant near/far edge stores its background
// depth and the foreground boundary that must move away before it is revealed.
export const OCCLUSION_VERSION = 5;
export const OCCLUSION_WIDTH = 12; // pixels of the 256-wide depth grid (~5%)
export const OCCLUSION_MAX_WIDTH = 2.5;

export const occlusionWidth = value => Math.max(.5,Math.min(OCCLUSION_MAX_WIDTH,Number.isFinite(value) ? value:1));
export const occlusionPointLimit = value => Math.max(10000,Math.min(200000,Number.isFinite(value) ? Math.round(value):40000));

export function prepareOcclusion(depth, width=1) {
  const {w,h,data}=depth, n=w*h;
  const maxDistance=Math.round(OCCLUSION_WIDTH*(Math.max(w,h)>256 ? w/256:1)*occlusionWidth(width));
  const owner=new Int32Array(n).fill(-1), distance=new Uint8Array(n).fill(255);
  const back=new Float32Array(n), front=new Float32Array(n);
  const normalX=new Int8Array(n),normalY=new Int8Array(n);
  const queue=new Int32Array(n);let head=0,tail=0;
  const directions=[[1,0],[-1,0],[0,1],[0,-1]];
  const jumpAt=(x,y,dx,dy)=>{
    const radius=Math.max(1,Math.round(2*(Math.max(w,h)>256 ? w/256:1)));
    const xx=x+dx*radius,yy=y+dy*radius;
    return xx<0||xx>=w||yy<0||yy>=h ? 0:data[y*w+x]-data[yy*w+xx];
  };
  // A softened silhouette is one transition, not several nested objects.
  // Keep its gradient peak, then follow the ramp to the depths on both sides.
  // All of this runs once in the preparation worker, never in the render loop.
  const trace=(x,y,dx,dy,sign)=>{
    let value=data[y*w+x],endX=x,endY=y,quiet=0;
    for(let step=1;step<=Math.round(10*(Math.max(w,h)>256 ? w/256:1));step++){
      const xx=x+dx*step,yy=y+dy*step;if(xx<0||xx>=w||yy<0||yy>=h)break;
      const next=data[yy*w+xx],change=(next-value)*sign;
      if(change<-.02)break; // another surface, rather than this silhouette
      if(change<.003){if(++quiet>=Math.round(2*(Math.max(w,h)>256 ? w/256:1)))break;}else quiet=0;
      if(change>0){value=next;endX=xx;endY=yy;}
    }
    return {value,x:endX,y:endY};
  };
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const i=y*w+x;let best=.12,dx=0,dy=0;
    for(const [nx,ny] of directions){
      const jump=jumpAt(x,y,nx,ny);
      if(jump>best){best=jump;dx=nx;dy=ny;}
    }
    if(!dx&&!dy)continue;
    let peak=true;
    for(const step of [-2,-1,1,2]){
      const xx=x+dx*step,yy=y+dy*step;if(xx<0||xx>=w||yy<0||yy>=h)continue;
      const other=jumpAt(xx,yy,dx,dy),j=yy*w+xx;
      if(other>best+1e-6||(Math.abs(other-best)<=1e-6&&j<i)){peak=false;break;}
    }
    if(!peak)continue;
    const far=trace(x,y,dx,dy,-1),near=trace(x,y,-dx,-dy,1);
    const middle=(far.value+near.value)*.5;
    // Place the owner at the silhouette's half-depth contour. Its depth must
    // be the foreground plateau, so the background moves independently of it.
    let ex=far.x,ey=far.y;
    while(data[ey*w+ex]<middle&&(ex!==near.x||ey!==near.y)){ex-=dx;ey-=dy;}
    const edge=ey*w+ex;
    if(owner[edge]>=0&&front[edge]-back[edge]>=near.value-far.value)continue;
    if(owner[edge]<0)queue[tail++]=edge;
    owner[edge]=edge;distance[edge]=0;back[edge]=far.value;front[edge]=near.value;
    normalX[edge]=dx;normalY[edge]=-dy;
  }
  // Multi-source flood keeps one owner per hidden pixel, avoiding duplicate
  // strips/hotspots at corners. Restrict it to the foreground side of the edge.
  while(head<tail){
    const i=queue[head++],x=i%w,y=Math.floor(i/w);
    if(distance[i]>=maxDistance)continue;
    for(const [dx,dy] of directions){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;
      const j=yy*w+xx;if(owner[j]>=0||data[j]<back[i]+.1)continue;
      const edge=owner[i],ex=edge%w,ey=Math.floor(edge/w);
      if((xx-ex)*normalX[i]-(yy-ey)*normalY[i]>0)continue;
      owner[j]=edge;distance[j]=distance[i]+1;back[j]=back[i];front[j]=front[i];
      normalX[j]=normalX[i];normalY[j]=normalY[i];queue[tail++]=j;
    }
  }
  const mask=new Uint8Array(n).fill(255);let count=0;
  for(let i=0;i<n;i++){
    if(owner[i]>=0){mask[i]=0;count++;}
    // Remove the rest of the main foreground too, so its colours are not
    // available for the AI to smear into the hidden background near its rim.
    if(data[i]>.55)mask[i]=0;
  }
  return {w,h,owner,back,front,normalX,normalY,distance,mask,count};
}

// Resolve sparse wall rows onto the same nearby silhouette. An owner ID is
// an image-grid cell, not a continuous surface: requiring an exact ID leaves
// one-cell channels. Never borrow across corners or distinct depth pairs.
export function resolveSideWalls(reconstruction, walls, aspect, spacing) {
  const {w,h,owner,front,back,normalX,normalY}=reconstruction;
  const result=new Int32Array(w*h).fill(-1);
  const radius=Math.max(1,Math.min(4,Math.ceil(spacing*h*1.5)));
  const maxDistance2=((radius+1.5)*Math.max(aspect/w,1/h))**2;
  for(let edge=0;edge<owner.length;edge++){
    if(owner[edge]!==edge)continue;
    const x=edge%w,y=Math.floor(edge/w);
    const ex=((x+.5+normalX[edge]*.5)/w-.5)*aspect;
    const ey=.5-(y+.5-normalY[edge]*.5)/h;
    let score=Infinity;
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx*dx+dy*dy>radius*radius || x+dx<0 || x+dx>=w || y+dy<0 || y+dy>=h)continue;
      const candidate=(y+dy)*w+x+dx;
      if(!Number.isFinite(walls.score[candidate]) || normalX[candidate]!==normalX[edge] || normalY[candidate]!==normalY[edge])continue;
      const j=candidate*4;
      if(Math.abs(walls.front[j+2]-front[edge])>.045 || Math.abs(walls.rear[j+2]-back[edge])>.045)continue;
      const distance=(walls.front[j]-ex)**2+(walls.front[j+1]-ey)**2;
      if(distance>maxDistance2)continue;
      if(distance<score){score=distance;result[edge]=candidate;}
    }
  }
  return result;
}

export function sampleOcclusion(reconstruction, aspect, count, options={}) {
  if(!reconstruction?.count)return null;
  const {w,h,owner,back,front,normalX,normalY,rgb,distance}=reconstruction;
  const walls=options.sideWalls;
  const bindings=walls ? resolveSideWalls(reconstruction,walls,aspect,options.fillSpacing || 1/h):null;
  const limit=occlusionPointLimit(options.reconstructionPointLimit);
  const maxDistance=Math.round(OCCLUSION_WIDTH*(Math.max(w,h)>256 ? w/256:1)*occlusionWidth(options.reconstructionWidth));
  // Preserve base-cloud density, rather than adding multiple rows to a seam.
  // The hard cap also bounds live vertex work and GPU memory independently.
  // 40k retains the original density and 20% cap. Raising the limit increases
  // sampling density too, so it can add points even in a small hidden region.
  const density=limit/40000;
  const budget=Math.min(limit,Math.floor(count*.2*density));
  const cell=Math.max(.1,Math.sqrt(w*h/Math.max(1,count*density)));
  let state=0x634f128b;
  const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  // Stratified selection distributes a capped pool over the whole image.
  // Packed temporary storage avoids hundreds of thousands of tiny JS arrays
  // at higher density. It is reclaimed when the sampling worker terminates.
  const cols=Math.ceil(w/cell),rows=Math.ceil(h/cell);
  const candidates=new Float32Array(cols*rows*3);
  let candidatesUsed=0;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x=col*cell,y=row*cell;
    const u=Math.min(w-1,x+rand()*cell),v=Math.min(h-1,y+rand()*cell);
    const i=Math.floor(v)*w+Math.floor(u);if(owner[i]<0 || (distance && distance[i]>maxDistance))continue;
    candidates[candidatesUsed*3]=u;candidates[candidatesUsed*3+1]=v;candidates[candidatesUsed*3+2]=i;candidatesUsed++;
  }
  const used=Math.min(candidatesUsed,budget),step=Math.max(1,candidatesUsed/Math.max(1,budget));
  const positions=new Float32Array(used*3),colors=new Float32Array(used*3),rands=new Float32Array(used),occluders=new Float32Array(used*4),normals=new Float32Array(used*2),sideThickness=new Float32Array(used*2);
  const sideFronts=new Float32Array(used*4),sideRears=new Float32Array(used*4);
  for(let j=0;j<used;j++){
    const k=Math.floor(j*step)*3,x=candidates[k],y=candidates[k+1],i=candidates[k+2],edge=owner[i];
    positions[j*3]=(x/w-.5)*aspect;positions[j*3+1]=.5-y/h;positions[j*3+2]=back[i];rands[j]=rand();
    colors[j*3]=rgb[i*3]/255;colors[j*3+1]=rgb[i*3+1]/255;colors[j*3+2]=rgb[i*3+2]/255;
    // Boundary is half a cell towards the far side of the foreground sample.
    occluders[j*4]=((edge%w+.5+normalX[i]*.5)/w-.5)*aspect;
    occluders[j*4+1]=.5-(Math.floor(edge/w)+.5-normalY[i]*.5)/h;occluders[j*4+2]=front[i];occluders[j*4+3]=rand();
    normals[j*2]=normalX[i];normals[j*2+1]=normalY[i];
    // Use one cached estimate at the foreground boundary, just as Gap fill
    // does. No AI, image processing or geometry rebuild on toggle/bias changes.
    sideThickness[j*2]=reconstruction.thickness?.[edge] || 0;
    sideThickness[j*2+1]=reconstruction.edgeWeight?.[edge] || 0;
    // -2: sampler checked but no actual wall; -1: legacy/unbound geometry.
    sideRears[j*4+3]=walls ? -2:-1;
    const bound=bindings?.[edge] ?? -1;
    if(bound>=0){
      sideFronts.set(walls.front.subarray(bound*4,bound*4+4),j*4);
      sideRears.set(walls.rear.subarray(bound*4,bound*4+4),j*4);
      sideThickness.set(walls.thickness.subarray(bound*2,bound*2+2),j*2);
    }
  }
  return {positions,colors,rands,occluders,normals,sideThickness,sideFronts,sideRears};
}
