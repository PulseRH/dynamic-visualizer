// A visual shell estimate from one relative-depth image, not recovered geometry.
// Prepared once alongside reconstruction and cached; audio bands are not inputs.
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
  const thickness=new Float32Array(n),edgeWeight=new Float32Array(n);
  for(let i=0;i<n;i++)if(labels[i]&&boundary[i]>=0){
    const gap=Math.max(0,surface[i]-background[boundary[i]]),r=radius[i]||distance[i];
    // A fraction of the side span, like the manual Fill thickness: assume an
    // object is about as deep as it is wide (image-plane width vs relative
    // depth gap). A building keeps most of its wall, a person or pole a thin
    // shell. Independent of Depth scale and audio motion, which stretch the
    // span but not the percentage. Tiny depth noise and frame boundaries
    // without a real background are not object edges; leave them untouched.
    thickness[i]=gap>=.08 ? Math.min(1,Math.max(.05,2*r/h/gap)):0;
    const t=Math.min(1,Math.max(0,(distance[i]-.5)/Math.max(1,r*.65)));
    edgeWeight[i]=thickness[i]>0 ? 1-t*t*(3-2*t):0;
  }
  return {thickness,edgeWeight};
}
