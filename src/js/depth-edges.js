import {prepareOcclusion} from './occlusion.js';

// A soft foreground silhouette is uncertainty between two surfaces, not a
// staircase of physical sidewalls. Collapse just that transition onto its
// front/back plateaus. Original depth caches and genuine surface slopes stay
// untouched. The reconstruction already uses these same plateau depths.
export function cleanDepthEdges(depth, reconstruction=null, objects=null){
  if(!depth)return {depth,edgePixels:null,changed:0};
  const {w,h,data}=depth,n=w*h;
  const edges=reconstruction?.owner?.length===n ? reconstruction:prepareOcclusion(depth);
  const result=data.slice(),edgePixels=new Uint8Array(n),strength=new Float32Array(n);
  const labels=objects?.labels?.length===n ? objects.labels:null;
  for(let edge=0;edge<n;edge++){
    if(edges.owner[edge]!==edge)continue;
    const front=edges.front[edge],back=edges.back[edge],span=front-back;
    if(span<.16)continue;
    const x=edge%w,y=Math.floor(edge/w),dx=edges.normalX[edge],dy=-edges.normalY[edge];
    if(Math.abs(dx)+Math.abs(dy)!==1)continue;
    const index=t=>{const xx=x+dx*t,yy=y+dy*t;return xx<0||xx>=w||yy<0||yy>=h ? -1:yy*w+xx;};
    let lo=0,hi=0;
    // Stop at each plateau, an opposite slope, or another object edge.
    while(lo>-10){const i=index(lo-1),j=index(lo);if(i<0||data[i]<data[j]-.025)break;lo--;if(data[i]>=front-.015)break;}
    while(hi<10){const i=index(hi+1),j=index(hi);if(i<0||data[i]>data[j]+.025)break;hi++;if(data[i]<=back+.015)break;}
    if(hi-lo<2)continue;
    let cut=lo;
    const middle=(front+back)*.5;
    for(let t=lo;t<=hi;t++)if(data[index(t)]>=middle)cut=t;
    // Trust a confident foreground contour when it lies within the uncertain
    // ramp. Never expand a coarse semantic mask deep into visible background.
    const nearId=labels?.[index(lo)],farId=labels?.[index(hi)];
    if(nearId&&nearId!==farId){
      let maskCut=lo;while(maskCut<hi&&labels[index(maskCut+1)]===nearId)maskCut++;
      const value=data[index(maskCut)];
      if(maskCut<hi&&value>back+span*.2&&value<front-span*.2)cut=maskCut;
    }
    for(let t=lo;t<=hi;t++){
      const i=index(t),value=data[i];
      if(value<back-.015||value>front+.015||span<=strength[i])continue;
      result[i]=t<=cut ? front:back;
      edgePixels[i]=t<=cut ? 1:2;strength[i]=span;
    }
  }
  let changed=0;for(let i=0;i<n;i++)if(Math.abs(result[i]-data[i])>.005)changed++;
  return {depth:{w,h,data:result},edgePixels,changed};
}

// A newly sharpened silhouette must remain open for hidden-background reveal,
// even with the user's permissive Gap fill depth-edge limit.
export function crossesCleanDepthEdge(clean,a,b){
  return !!clean?.edgePixels && (clean.edgePixels[a]||clean.edgePixels[b]) && Math.abs(clean.depth.data[a]-clean.depth.data[b])>.08;
}
