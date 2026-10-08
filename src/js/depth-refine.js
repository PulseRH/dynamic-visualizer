// Runs once in the depth worker. Keep silhouette jumps out of the smoothing
// kernel; never create a third depth between a foreground and its background.
export function depthTuning(options={}){
  const value=v=>Number.isFinite(v) ? Math.max(0,Math.min(2,Math.round(v*100)/100)):1;
  return {smoothing:value(options.depthSmoothing),cleanup:value(options.depthSpikeCleanup)};
}
export function depthTuningKey(mode,options={}){
  if(mode!=='onnx'&&mode!=='onnx-base')return '';
  const {smoothing,cleanup}=depthTuning(options);return `${smoothing.toFixed(2)}:${cleanup.toFixed(2)}`;
}
export function refineDepth(input,w,h,options={}){
  const {smoothing,cleanup}=depthTuning(options);
  const repaired=input.slice(),out=new Float32Array(input.length),neighbours=[];
  if(cleanup>0)for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,value=input[i];neighbours.length=0;let support=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){
      const v=input[i+dy*w+dx];neighbours.push(v);if(Math.abs(v-value)<.04)support++;
    }
    // Require six agreeing neighbours and no line support. Thin continuous
    // ledges have two neighbours along the ledge and are deliberately kept.
    if(support>=2)continue;
    neighbours.sort((a,b)=>a-b);const median=(neighbours[3]+neighbours[4])*.5;
    if(Math.abs(value-median)>.08/cleanup && neighbours.filter(v=>Math.abs(v-median)<.04).length>=6)repaired[i]=median;
  }
  if(!smoothing)return repaired;
  const range=.035*Math.max(1,smoothing),mix=Math.min(1,smoothing);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,centre=repaired[i];let sum=centre*4,weight=4;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if((!dx&&!dy)||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
      const v=repaired[i+dy*w+dx],delta=Math.abs(v-centre);
      if(delta>=range)continue;
      const t=1-delta/range,k=t*t*(dx&&dy ? 1:2);
      sum+=v*k;weight+=k;
    }
    out[i]=centre+(sum/weight-centre)*mix;
  }
  return out;
}

export function prepareAIDepth(grid,ow,oh,width,height,maxSize=512,options={}){
  if(!grid.length || grid.length!==ow*oh || !grid.every(Number.isFinite))throw Error('Invalid AI depth output');
  const sorted=Float32Array.from(grid).sort(),lo=sorted[Math.floor(sorted.length*.02)],hi=sorted[Math.floor(sorted.length*.98)];
  const span=Math.max(1e-5,hi-lo);
  const w=Math.max(32,Math.round(maxSize*width/Math.max(width,height)));
  const h=Math.max(32,Math.round(maxSize*height/Math.max(width,height)));
  const near=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    // Nearest sampling keeps hard boundaries hard. Filtering below only mixes
    // compatible depths, rather than averaging across object silhouettes.
    const sx=Math.min(ow-1,Math.floor((x+.5)/w*ow)),sy=Math.min(oh-1,Math.floor((y+.5)/h*oh));
    near[y*w+x]=Math.max(0,Math.min(1,(grid[sy*ow+sx]-lo)/span));
  }
  return {data:refineDepth(near,w,h,options),w,h};
}
