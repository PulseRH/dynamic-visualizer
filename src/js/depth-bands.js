// Snap evenly distributed audio boundaries towards valleys in the depth
// histogram. This is surface-aware placement, not semantic object recognition.
export const DEPTH_BINS=1024;
export function depthHistogram(depth){
  const histogram=new Uint32Array(DEPTH_BINS);
  for(const value of depth?.data || [])histogram[Math.max(0,Math.min(DEPTH_BINS-1,Math.floor(value*DEPTH_BINS)))]++;
  return histogram;
}
export function depthBandLookup(histogram,bands,distribution=0){
  bands=Math.max(4,Math.min(256,Math.round(bands)));
  const exponent=4**Math.max(-1,Math.min(1,distribution)),density=new Float64Array(DEPTH_BINS);
  for(let i=0;i<DEPTH_BINS;i++)for(let d=-2;d<=2;d++)density[i]+=(histogram?.[i+d] || 0)*(3-Math.abs(d));
  const cuts=[];
  for(let band=1;band<bands;band++){
    const ideal=(band/bands)**(1/exponent);
    const lo=((band-.35)/bands)**(1/exponent),hi=((band+.35)/bands)**(1/exponent);
    let best=ideal,score=Infinity,peak=1;
    const start=Math.max(1,Math.ceil(lo*DEPTH_BINS)),end=Math.min(DEPTH_BINS-1,Math.floor(hi*DEPTH_BINS));
    for(let i=start;i<=end;i++)peak=Math.max(peak,density[i]);
    for(let i=start;i<=end;i++){
      const t=i/DEPTH_BINS,cost=density[i]/peak+Math.abs(t-ideal)/Math.max(hi-lo,1/DEPTH_BINS)*.25;
      if(cost<score){score=cost;best=t;}
    }
    cuts.push(best);
  }
  const lookup=new Uint8Array(DEPTH_BINS);let band=0;
  for(let i=0;i<DEPTH_BINS;i++){while(band<cuts.length&&(i+.5)/DEPTH_BINS>=cuts[band])band++;lookup[i]=band;}
  return lookup;
}
