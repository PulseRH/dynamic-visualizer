// SegFormer scene classes become connected object/surface masks. Depth splits
// abrupt jumps; sky, ground and uncertain pixels never become foreground walls.
export const OBJECT_MASK_VERSION=5;
export const MAX_OBJECT_MASKS=64;
const STRUCTURE=new Set([0,1,8,14,25,38,42,43,48,58,63,79,84,86,95,100,106,123,144]);
const PLANTS=new Set([4,17,66,72]);
const BACKGROUND=new Set([2,3,5,6,9,11,13,16,21,26,29,46,52,54,60,68,91,94,109,113,128]);
// Typical depth/width of each surface group (ADE20K ids + 3) for Auto
// thickness: walls of buildings run deep, people and poles are thin, vehicles
// are longer than their visible width. Unknown objects use 1.
const DEPTH_RATIOS=new Map([[1,1.5],[2,.8],
  ...[12,126].map(id=>[id+3,.6]),
  ...[93,87,136,149,36,98,135].map(id=>[id+3,.4]),
  ...[22,27,18,130,141,143,89,32].map(id=>[id+3,.2]),
  ...[20,80,83,102,76,103,90,116,127].map(id=>[id+3,2])]);
export const depthRatio=group=>DEPTH_RATIOS.get(group) ?? 1;
export function surfaceClass(id){return BACKGROUND.has(id) ? 0:STRUCTURE.has(id) ? 1:PLANTS.has(id) ? 2:id+3;}
export function sceneClasses(logits,dims,w,h,alpha){
  const [,channels,height,width]=dims;
  if(channels!==150||logits.length!==channels*width*height)throw Error('Unexpected segmentation dimensions');
  const classes=new Uint8Array(w*h),confidence=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const fx=Math.max(0,Math.min(width-1,(x+.5)/w*width-.5)),fy=Math.max(0,Math.min(height-1,(y+.5)/h*height-.5));
    const xx=Math.floor(fx),yy=Math.floor(fy),tx=fx-xx,ty=fy-yy;
    let best=-Infinity,next=-Infinity,id=-1;
    for(let c=0;c<channels;c++){
      const at=(dx,dy)=>logits[c*width*height+Math.min(height-1,yy+dy)*width+Math.min(width-1,xx+dx)];
      const value=(at(0,0)*(1-tx)+at(1,0)*tx)*(1-ty)+(at(0,1)*(1-tx)+at(1,1)*tx)*ty;
      const group=surfaceClass(c);
      if(group===id){best=Math.max(best,value);}
      else if(value>best){next=best;best=value;id=group;}
      else if(value>next)next=value;
    }
    const i=y*w+x;classes[i]=alpha&&alpha[i*4+3]<24 ? 0:id;
    confidence[i]=Math.max(0,best-next);
  }
  return {classes,confidence};
}
export function sceneObjects(classes,confidence,depth,reconstruction){
  const {w,h,data}=depth,n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n),regions=[];
  const near=new Float32Array(n),seeds=Uint32Array.from({length:n},(_,i)=>i);
  for(let i=0;i<n;i++)near[i]=reconstruction.owner[i]>=0&&data[i]>reconstruction.back[i]+.1 ? Math.max(data[i],reconstruction.front[i]):data[i];
  seeds.sort((a,b)=>near[b]-near[a]||a-b);
  for(const seed of seeds)if(classes[seed]&&confidence[seed]>=.25&&!seen[seed]){
    let head=0,tail=1,evidence=0;queue[0]=seed;seen[seed]=1;
    while(head<tail){
      const i=queue[head++],x=i%w,y=Math.floor(i/w);
      if(data[i]>.55||(reconstruction.owner[i]>=0&&data[i]>reconstruction.back[i]+.1))evidence++;
      for(const j of [x ? i-1:-1,x+1<w ? i+1:-1,y ? i-w:-1,y+1<h ? i+w:-1]){
        // Never chain a row of distant buildings into the foreground just
        // because their adjacent depth differences are individually small.
        if(j>=0&&!seen[j]&&classes[j]===classes[i]&&confidence[j]>=.25&&Math.abs(near[i]-near[j])<=.18&&Math.abs(near[seed]-near[j])<=.3){seen[j]=1;queue[tail++]=j;}
      }
    }
    if(tail>=8&&evidence>=4&&evidence/tail>=.05)regions.push({cells:queue.slice(0,tail),area:tail});
  }
  regions.sort((a,b)=>b.area-a.area);
  const labels=new Uint16Array(n);let count=0;
  for(const region of regions.slice(0,MAX_OBJECT_MASKS)){count++;for(const i of region.cells)labels[i]=count;}
  return {labels,count};
}
