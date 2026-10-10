// A visual shell estimate from one relative-depth image, not recovered geometry.
// Prepared once alongside reconstruction and cached; audio bands are not inputs.
import {depthRatio} from './object-mask-utils.js';
export function estimateFillThickness(depth,reconstruction,objects=null){
  const {w,h,data}=depth,n=w*h;
  const objectIds=objects?.labels?.length===n ? objects.labels:null;
  // AI object types outline objects at any depth, including a person standing
  // just in front of a wall: with low Depth scale, audio motion opens those
  // seams although the static step is small. Background types (sky, ground,
  // road) never become walls; without AI types only the foreground does.
  const classes=objects?.classes?.length===n ? objects.classes:null;
  const at=(x,y)=>data[Math.min(h-1,Math.max(0,y))*w+Math.min(w-1,Math.max(0,x))];
  const rim=i=>reconstruction.owner[i]>=0&&data[i]>reconstruction.back[i]+.1;
  const step=new Float32Array(n),objectDepth=new Float32Array(n);
  const thickness=new Float32Array(n),edgeWeight=new Float32Array(n),sizeRatio=new Float32Array(n);
  const offsets=[[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]];
  // Outlines are found locally rather than by flooding regions: real depth
  // maps blend some contours (a person's legs into the wall below), and one
  // such leak merged a whole figure into the background. A depth fall-off
  // within two cells is an outline; gradual slopes and interior seams are not.
  for(let i=0;i<n;i++){
    const typed=classes?.[i]>0,isRim=rim(i);
    if(!typed&&data[i]<=.55&&!isRim)continue;
    const x=i%w,y=Math.floor(i/w),value=data[i];
    let far=value,fx=0,fy=0;
    for(const [dx,dy] of offsets){const v=at(x+dx,y+dy);if(v<far){far=v;fx=dx;fy=dy;}}
    // Tiny depth noise and frame boundaries without a real background are
    // not object edges. A step, not a slope: subtract the rise continuing on
    // the near side, so a uniformly receding wall cancels out. AI-typed
    // outlines then need only a small step.
    const limit=typed ? .03:.08,drop=value-far-Math.max(0,at(x-fx,y-fy)-value);
    if(drop<limit*.5)continue;
    step[i]=drop;
    edgeWeight[i]=Math.min(1,(drop-limit*.5)/(limit*.5));
    // March inward, away from the fall-off, until the far side drops away or
    // the AI type/object changes: the local crossing width. The depth range
    // seen on the way (a facade receding at an angle) is a depth floor.
    let ux=at(x+2,y)-at(x-2,y),uy=at(x,y+2)-at(x,y-2),length=Math.hypot(ux,uy);
    if(length<1e-4){ux=-fx;uy=-fy;length=Math.hypot(ux,uy)||1;}
    ux/=length;uy/=length;
    // Stop at a step, i.e. a sudden steeper fall than the slope so far, so a
    // facade receding steadily is crossed while the far side's drop is not.
    let width=0,high=value,low=value,previous=value,slope=0;
    for(let k=1,max=Math.ceil(h*.5);k<=max;k++){
      const xx=Math.round(x+ux*k),yy=Math.round(y+uy*k);
      if(xx<0||xx>=w||yy<0||yy>=h){width=k;break;}
      const j=yy*w+xx,v=data[j],fall=previous-v;
      if((classes&&classes[j]!==classes[i])||(objectIds&&objectIds[j]!==objectIds[i])||fall-Math.max(0,slope)>limit*.5)break;
      width=k;high=Math.max(high,v);low=Math.min(low,v);slope=fall;previous=v;
    }
    const ratio=classes ? depthRatio(classes[i]):1;
    objectDepth[i]=Math.max((width+1)/h*ratio,high-low,1e-4);
  }
  // Smooth along the outline in log space, so one noisy march cannot carve a
  // notch into a wall. Linear in outline pixels; cached with the result.
  let logSum=0,weight=0;
  for(let i=0;i<n;i++)if(edgeWeight[i]>0){
    const x=i%w,y=Math.floor(i/w);let sum=0,count=0;
    for(let yy=Math.max(0,y-2);yy<=Math.min(h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(w-1,x+2);xx++){
      const j=yy*w+xx;if(edgeWeight[j]>0&&(!classes||classes[j]===classes[i])){sum+=Math.log(objectDepth[j]);count++;}
    }
    sizeRatio[i]=Math.exp(sum/count);logSum+=Math.log(sizeRatio[i])*edgeWeight[i];weight+=edgeWeight[i];
  }
  // Size relative to the image's typical outline (weighted geometric mean).
  // Size balance raises it to a live power in the shader.
  const reference=weight ? Math.exp(logSum/weight):1;
  // A share of the side span, like the manual Fill thickness: half the side
  // for the image's typical object, scaled by relative size, so Depth scale
  // and audio motion stretch walls without changing their share. A small
  // object far in front of a distant background is additionally capped at
  // its own depth. Above 1 is kept so Thickness bias below 1× still shortens.
  for(let i=0;i<n;i++)if(edgeWeight[i]>0){
    const estimate=sizeRatio[i];sizeRatio[i]=estimate/reference;
    thickness[i]=Math.min(8,Math.max(.02,Math.min(.5*sizeRatio[i],estimate/step[i])));
  }
  return {thickness,edgeWeight,sizeRatio};
}
