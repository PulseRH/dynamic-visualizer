// Geometry preparation only. AI colours are generated separately, once per image.
// A bounded strip behind each significant near/far edge stores its background
// depth and the foreground boundary that must move away before it is revealed.
export const OCCLUSION_VERSION = 1;
export const OCCLUSION_WIDTH = 12; // pixels of the 256-wide depth grid (~5%)

export function prepareOcclusion(depth) {
  const {w,h,data}=depth, n=w*h;
  const owner=new Int32Array(n).fill(-1), distance=new Uint8Array(n).fill(255);
  const back=new Float32Array(n), front=new Float32Array(n);
  const normalX=new Int8Array(n),normalY=new Int8Array(n);
  const queue=new Int32Array(n);let head=0,tail=0;
  // Look across two depth samples: depth estimation deliberately smooths edges.
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const i=y*w+x;let best=.12,dx=0,dy=0,far=0;
    for(const [nx,ny] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const value=data[(y+ny*2)*w+x+nx*2],jump=data[i]-value;
      if(jump>best){best=jump;dx=nx;dy=ny;far=value;}
    }
    if(!dx&&!dy)continue;
    owner[i]=i;distance[i]=0;back[i]=far;front[i]=data[i];
    normalX[i]=dx;normalY[i]=-dy;queue[tail++]=i;
  }
  // Multi-source flood keeps one owner per hidden pixel, avoiding duplicate
  // strips/hotspots at corners. Restrict it to the foreground side of the edge.
  while(head<tail){
    const i=queue[head++],x=i%w,y=Math.floor(i/w);
    if(distance[i]>=OCCLUSION_WIDTH)continue;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
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
  return {w,h,owner,back,front,normalX,normalY,mask,count};
}

export function sampleOcclusion(reconstruction, aspect, count) {
  if(!reconstruction?.count)return null;
  const {w,h,owner,back,front,normalX,normalY,rgb}=reconstruction;
  // Preserve base-cloud density, rather than adding multiple rows to a seam.
  // The hard cap also bounds live vertex work and GPU memory independently.
  const budget=Math.min(40000,Math.floor(count*.2));
  const cell=Math.max(.1,Math.sqrt(w*h/Math.max(1,count)));
  const positions=[],colors=[],rands=[],occluders=[],normals=[];
  let state=0x634f128b;
  const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  // Stratified selection distributes a capped pool over the whole image.
  const candidates=[];
  for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell){
    const u=Math.min(w-1,x+rand()*cell),v=Math.min(h-1,y+rand()*cell);
    const i=Math.floor(v)*w+Math.floor(u);if(owner[i]<0)continue;
    candidates.push([u,v,i]);
  }
  const step=Math.max(1,candidates.length/Math.max(1,budget));
  for(let k=0;k<candidates.length && rands.length<budget;k+=step){
    const [x,y,i]=candidates[Math.floor(k)],edge=owner[i];
    positions.push((x/w-.5)*aspect,.5-y/h,back[i]);rands.push(rand());
    colors.push(rgb[i*3]/255,rgb[i*3+1]/255,rgb[i*3+2]/255);
    // Boundary is half a cell towards the far side of the foreground sample.
    occluders.push(((edge%w+.5+normalX[i]*.5)/w-.5)*aspect,
      .5-(Math.floor(edge/w)+.5-normalY[i]*.5)/h,front[i],rand());
    normals.push(normalX[i],normalY[i]);
  }
  return {positions:new Float32Array(positions),colors:new Float32Array(colors),
    rands:new Float32Array(rands),occluders:new Float32Array(occluders),normals:new Float32Array(normals)};
}
