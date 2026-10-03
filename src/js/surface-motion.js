// Cached AI contours identify candidates. A robust local plane check rejects
// protrusions: this changes audio response only, never the original geometry.
export function buildSurfaceMotion(depth, objects) {
  if (!depth || objects?.labels?.length !== depth.w * depth.h) return null;
  const {w,h,data}=depth, n=w*h, labels=objects.labels;
  const texture=new Float32Array(n*4), seen=new Uint8Array(n), queue=new Int32Array(n);
  let surfaceCount=0, covered=0;
  for(let seed=0;seed<n;seed++)if(labels[seed]&&!seen[seed]){
    let head=0,tail=1;queue[0]=seed;seen[seed]=1;
    while(head<tail){
      const i=queue[head++],x=i%w,y=Math.floor(i/w);
      for(const j of [x ? i-1:-1,x+1<w ? i+1:-1,y ? i-w:-1,y+1<h ? i+w:-1]){
        if(j>=0&&!seen[j]&&labels[j]===labels[seed]&&Math.abs(data[i]-data[j])<.065){seen[j]=1;queue[tail++]=j;}
      }
    }
    if(tail<24)continue;
    const cells=queue.subarray(0,tail);
    let plane=fit(cells,w,h,data);
    // Remove small signs/window recesses from the plane fit rather than
    // pulling the main wall toward them. Keep uncertainty visible in coverage.
    for(let pass=0;pass<2;pass++)plane=fit(cells,w,h,data,plane);
    const inliers=[];
    for(const i of cells)if(Math.abs(data[i]-at(plane,i,w,h))<=.04)inliers.push(data[i]);
    if(inliers.length<24 || inliers.length/tail<.55)continue;
    inliers.sort((a,b)=>a-b);
    const anchor=inliers[Math.floor(inliers.length/2)];
    surfaceCount++;
    for(const i of cells){
      const error=Math.abs(data[i]-at(plane,i,w,h));
      const t=Math.max(0,Math.min(1,(error-.04)/.04));
      const weight=1-t*t*(3-2*t);
      texture.set([anchor,weight,data[i],0],i*4);
      if(weight>.5)covered++;
    }
  }
  return {data:texture,w,h,surfaceCount,covered};
}
const at=(plane,i,w,h)=>plane[0]+plane[1]*(i%w/w)+plane[2]*Math.floor(i/w)/h;
function fit(cells,w,h,data,previous){
  let count=0,sx=0,sy=0,sz=0,sxx=0,syy=0,sxy=0,sxz=0,syz=0;
  for(const i of cells){
    const x=i%w/w,y=Math.floor(i/w)/h,z=data[i];
    if(previous&&Math.abs(z-at(previous,i,w,h))>.06)continue;
    count++;sx+=x;sy+=y;sz+=z;sxx+=x*x;syy+=y*y;sxy+=x*y;sxz+=x*z;syz+=y*z;
  }
  if(!count)return previous||[0,0,0];
  const xx=sxx-sx*sx/count,yy=syy-sy*sy/count,xy=sxy-sx*sy/count;
  const xz=sxz-sx*sz/count,yz=syz-sy*sz/count,det=xx*yy-xy*xy;
  const a=det>1e-10 ? (xz*yy-yz*xy)/det:0,b=det>1e-10 ? (yz*xx-xz*xy)/det:0;
  return [sz/count-a*sx/count-b*sy/count,a,b];
}

// Texture layout is top-down like the depth grid. Hidden points at the same
// pixel belong to a different depth and must not inherit foreground motion.
export function surfaceAt(map,x,y,near,aspect,strength){
  if(!map||!strength)return {near,weight:0};
  const w=map.w||map.width,h=map.h||map.height;
  const col=Math.max(0,Math.min(w-1,Math.floor((x/aspect+.5)*w)));
  const row=Math.max(0,Math.min(h-1,Math.floor((.5-y)*h)));
  const i=(row*w+col)*4;
  const weight=Math.abs(near-map.data[i+2])<=.025 ? map.data[i+1]*strength:0;
  return {near:near+(map.data[i]-near)*weight,anchor:map.data[i],weight};
}
