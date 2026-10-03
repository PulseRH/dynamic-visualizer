// A bounded set of hidden depth targets, independent of audio band count.
// Each target uses only visible content at/behind that depth as AI context.
export function planReconstructionLayers(depth,prepared,maxLayers=4){
  const histogram=new Uint32Array(64),assignment=new Uint8Array(depth.w*depth.h).fill(255);
  for(let i=0;i<assignment.length;i++)if(prepared.owner[i]>=0)histogram[Math.min(63,Math.floor(prepared.back[i]*64))]++;
  const groups=[];
  for(let bin=0;bin<64;bin++)if(histogram[bin]){
    const centre=(bin+.5)/64,last=groups.at(-1);
    // Bound each group's full depth range. Comparing only adjacent bins
    // chains a noisy continuous ramp into one almost-full-depth layer.
    if(last&&centre-last.min<.10){last.bins.push(bin);last.count+=histogram[bin];last.max=centre;}
    else groups.push({bins:[bin],count:histogram[bin],min:centre,max:centre});
  }
  while(groups.length>maxLayers){
    let pair=0,cost=Infinity;
    for(let i=0;i<groups.length-1;i++){
      const value=(groups[i+1].max-groups[i].min)*(groups[i].count+groups[i+1].count);
      if(value<cost){cost=value;pair=i;}
    }
    const a=groups[pair],b=groups[pair+1];a.bins.push(...b.bins);a.count+=b.count;a.max=b.max;groups.splice(pair+1,1);
  }
  const binLayer=new Uint8Array(64).fill(255);
  const layers=groups.map((group,index)=>{
    for(const bin of group.bins)binLayer[bin]=index;
    // Upper depth of this hidden surface with a small tolerance for noise.
    const cutoff=Math.min(1,group.max+.04),mask=new Uint8Array(assignment.length).fill(255);
    for(let i=0;i<mask.length;i++)if(depth.data[i]>cutoff)mask[i]=0;
    return {cutoff,mask,count:group.count};
  });
  for(let i=0;i<assignment.length;i++)if(prepared.owner[i]>=0){
    const layer=binLayer[Math.min(63,Math.floor(prepared.back[i]*64))];assignment[i]=layer;layers[layer].mask[i]=0;
  }
  return {layers,assignment};
}
