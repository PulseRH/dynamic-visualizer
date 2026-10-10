// A visual shell estimate from one relative-depth image, not recovered geometry.
// Prepared once alongside reconstruction and cached; audio bands are not inputs.
import {depthRatio} from './object-mask-utils.js';
export function estimateFillThickness(depth,reconstruction,objects=null){
  const {w,h,data}=depth,n=w*h;
  const surface=new Float32Array(n),labels=new Int32Array(n),queue=new Int32Array(n);
  const distance=new Float32Array(n).fill(Infinity),boundary=new Int32Array(n).fill(-1);
  const background=new Float32Array(n),radius=new Float32Array(n);
  const neighbours=(i,visit)=>{const x=i%w,y=Math.floor(i/w);if(x)visit(i-1);if(x+1<w)visit(i+1);if(y)visit(i-w);if(y+1<h)visit(i+w);};
  for(let i=0;i<n;i++){
    const rim=reconstruction.owner[i]>=0&&data[i]>reconstruction.back[i]+.1;
    if(data[i]>.55||rim)surface[i]=rim ? Math.max(data[i],reconstruction.front[i]):data[i];
  }
  const objectIds=objects?.labels?.length===n ? objects.labels:null;
  if(objectIds){
    const sums=new Float64Array(65536),counts=new Uint32Array(65536),evidence=new Uint32Array(65536);
    for(let i=0;i<n;i++)if(objectIds[i]){const id=objectIds[i];sums[id]+=data[i];counts[id]++;if(surface[i])evidence[id]++;}
    for(let i=0;i<n;i++)if(objectIds[i]){
      const id=objectIds[i];
      // Masks identify contours; depth still rejects background regions and
      // severe within-mask depth disagreement. Depth values remain original.
      if(evidence[id]>=4&&evidence[id]/counts[id]>=.05&&data[i]>=Math.max(.1,sums[id]/counts[id]-.2))surface[i]=Math.max(surface[i],data[i]);
    }
  }
  // Segment continuous depth surfaces, merging the already consolidated soft
  // silhouettes. Never derive object boundaries from the user's band count.
  let label=0;
  for(let seed=0;seed<n;seed++)if(surface[seed]&&!labels[seed]){
    let head=0,tail=1;queue[0]=seed;labels[seed]=++label;
    while(head<tail){const i=queue[head++];neighbours(i,j=>{
      const sameObject=!objectIds||objectIds[i]===objectIds[j];
      const continuous=objectIds?.[i]>0||Math.abs(surface[i]-surface[j])<=.16;
      if(surface[j]&&!labels[j]&&sameObject&&continuous){labels[j]=label;queue[tail++]=j;}
    });}
  }
  // Seed the outline, with the local depth behind it. The half-pixel distance
  // makes the estimate independent of image/grid size and includes thin parts.
  for(let i=0;i<n;i++)if(labels[i]){
    let edge=i%w===0||i%w===w-1||i<w||i>=n-w,far=surface[i];
    neighbours(i,j=>{if(labels[j]!==labels[i]){edge=true;far=Math.min(far,data[j]);}});
    if(edge){
      if(reconstruction.owner[i]>=0)far=Math.min(far,reconstruction.back[i]);
      distance[i]=.5;boundary[i]=i;background[i]=far;
    }
  }
  const relax=(i,j,cost)=>{
    if(j<0||j>=n||labels[j]!==labels[i]||boundary[j]<0)return;
    const candidate=distance[j]+cost;
    if(candidate<distance[i]){distance[i]=candidate;boundary[i]=boundary[j];}
  };
  // Chamfer distance and nearest-outline propagation in two linear passes.
  for(let i=0;i<n;i++)if(labels[i]){const x=i%w;if(x)relax(i,i-1,1);relax(i,i-w,1);if(x)relax(i,i-w-1,Math.SQRT2);if(x+1<w)relax(i,i-w+1,Math.SQRT2);}
  for(let i=n-1;i>=0;i--)if(labels[i]){const x=i%w;if(x+1<w)relax(i,i+1,1);relax(i,i+w,1);if(x+1<w)relax(i,i+w+1,Math.SQRT2);if(x)relax(i,i+w-1,Math.SQRT2);}
  const d=(i,label)=>i<0||i>=n||labels[i]!==label ? 0:distance[i];
  let head=0,tail=0;
  for(let i=0;i<n;i++)if(labels[i]){
    const x=i%w,value=distance[i],left=x ? d(i-1,labels[i]):0,right=x+1<w ? d(i+1,labels[i]):0;
    const up=d(i-w,labels[i]),down=d(i+w,labels[i]);
    // Medial ridges give local half-widths: a head, arm and broad wall can
    // have different radii even inside one connected foreground component.
    if((value>=left&&value>=right&&(value>left+.01||value>right+.01))
      ||(value>=up&&value>=down&&(value>up+.01||value>down+.01))){radius[i]=value;queue[tail++]=i;}
  }
  while(head<tail){const i=queue[head++];neighbours(i,j=>{if(labels[j]===labels[i]&&!radius[j]){radius[j]=radius[i];queue[tail++]=j;}});}
  // One depth estimate per object, not per outline pixel: jagged real edges
  // create tiny medial spurs that made local widths collapse to a pixel or two.
  // The inscribed diameter is robust to that noise; the AI class scales it by
  // a typical depth/width ratio, and the object's own depth slope (a building
  // seen at an angle) sets a floor. All linear passes, cached with the result.
  const maxDistance=new Float32Array(label+1),deepest=new Int32Array(label+1).fill(-1);
  const bins=32,histogram=new Uint32Array((label+1)*bins),members=new Uint32Array(label+1),edges=new Uint32Array(label+1);
  for(let i=0;i<n;i++)if(labels[i]){
    const L=labels[i];members[L]++;histogram[L*bins+Math.min(bins-1,Math.floor(surface[i]*bins))]++;
    if(distance[i]>maxDistance[L]&&Number.isFinite(distance[i])){maxDistance[L]=distance[i];deepest[L]=i;}
  }
  const quantile=(L,q)=>{let target=members[L]*q,sum=0;for(let b=0;b<bins;b++){sum+=histogram[L*bins+b];if(sum>=target)return (b+.5)/bins;}return 1;};
  const classes=objects?.classes?.length===n ? objects.classes:null;
  const objectDepth=new Float32Array(label+1);
  for(let L=1;L<=label;L++){
    const width=2*maxDistance[L]/h,ratio=classes&&deepest[L]>=0 ? depthRatio(classes[deepest[L]]):1;
    // Ignore slope on small regions, where depth noise dominates.
    const slope=members[L]>=64 ? Math.max(0,quantile(L,.9)-quantile(L,.1)):0;
    objectDepth[L]=Math.max(width*ratio,slope);
  }
  const thickness=new Float32Array(n),edgeWeight=new Float32Array(n),sizeRatio=new Float32Array(n);
  for(let i=0;i<n;i++)if(labels[i]&&boundary[i]>=0){
    const gap=Math.max(0,surface[i]-background[boundary[i]]);
    // Tiny depth noise and frame boundaries without a real background are
    // not object edges; leave them untouched.
    if(gap<.08)continue;
    // A fraction of the side span, like the manual Fill thickness, so Depth
    // scale and audio motion stretch the wall without changing its share.
    // Above 1 is kept so Thickness bias below 1× can still shorten it.
    thickness[i]=Math.min(8,Math.max(.02,objectDepth[labels[i]]/gap));edges[labels[i]]++;
    const r=Math.min(radius[i]||distance[i],maxDistance[labels[i]]);
    const t=Math.min(1,Math.max(0,(distance[i]-.5)/Math.max(1,r*.65)));
    edgeWeight[i]=1-t*t*(3-2*t);
  }
  // Size relative to the image's typical object (outline-weighted geometric
  // mean). Size balance raises it to a live power in the shader.
  let logSum=0,weight=0;
  for(let L=1;L<=label;L++)if(edges[L]&&objectDepth[L]>0){logSum+=Math.log(objectDepth[L])*edges[L];weight+=edges[L];}
  const reference=weight ? Math.exp(logSum/weight):1;
  for(let i=0;i<n;i++)if(thickness[i])sizeRatio[i]=objectDepth[labels[i]]/reference;
  return {thickness,edgeWeight,sizeRatio};
}
