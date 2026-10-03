// Converts an image (+ optional nearness grid) into a packed point cloud:
// jittered grid sampling so coverage is even, colors in linear space,
// z = nearness (0..1; the shader scales it and the audio drives displacement).

import {sampleOcclusion} from './occlusion.js';
import {depthHistogram,depthBandLookup,DEPTH_BINS} from './depth-bands.js';

export function sampleImageToCloud(bitmap, depth, count, gapFill=0, mapping={}) {
  const W = bitmap.width, H = bitmap.height;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  const aspect = W / H;
  const cell = Math.sqrt((W * H) / count);
  const cols = Math.max(1, Math.floor(W / cell));
  const rows = Math.max(1, Math.floor(H / cell));
  const n = cols * rows;
  const fill=Math.max(0,Math.min(1,Number.isFinite(gapFill) ? gapFill:0));
  const depthLimit=Math.max(.01,Math.min(.3,mapping.gapFillDepthLimit ?? .06));
  const pointLimit=Math.max(0,Math.min(400000,Number.isFinite(mapping.gapFillPointLimit) ? Math.round(mapping.gapFillPointLimit):180000));
  const extraCapacity=Math.floor(Math.min(n*1.5,pointLimit)*fill);
  const capacity=n+extraCapacity;
  const grid=extraCapacity ? new Int32Array(n).fill(-1):null;

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const rands = new Float32Array(capacity);
  const fillStarts=extraCapacity ? new Float32Array(extraCapacity*4):null;
  const fillEnds=extraCapacity ? new Float32Array(extraCapacity*4):null;
  const fillFractions=extraCapacity ? new Float32Array(extraCapacity):null;
  // Local world thickness and outline influence, prepared with reconstruction.
  // Bias changes live without another model, rebuild or draw pass.
  const reconstruction=mapping.reconstruction;
  const fillThickness=extraCapacity && reconstruction?.thickness ? new Float32Array(extraCapacity*2):null;
  // RGB and endpoint ownership for foreground sidewalls. Kept separate from
  // midpoint colours so ordinary interior seams preserve their image samples.
  const fillForeground=fillThickness ? new Float32Array(extraCapacity*4):null;
  const histogram=depthHistogram(depth);
  const lookup=mapping.smartDepthBands ? depthBandLookup(histogram,mapping.bands||64,mapping.bandDistribution||0):null;
  const bandAt=i=>{
    const x=positions[i*3]/aspect+.5,y=positions[i*3+1]+.5,near=positions[i*3+2];
    const mode=mapping.bandMap || 'depth';
    if(mode==='depth'&&lookup){const band=lookup[Math.max(0,Math.min(DEPTH_BINS-1,Math.floor(near*DEPTH_BINS)))];return mapping.invertBands ? (mapping.bands||64)-1-band:band;}
    let t=mode==='depth' ? near**(4**(mapping.bandDistribution || 0)):mode==='radial' ? Math.min(1,Math.hypot(x-.5,y-.5)*1.25):mode==='vertical' ? 1-y:x;
    if(mapping.invertBands)t=1-t;
    return Math.max(0,Math.min((mapping.bands || 64)-1,Math.floor(t*(mapping.bands || 64))));
  };

  let used = 0;
  let rngState = 0x12345678;
  const rand = () => {
    // xorshift for deterministic jitter
    rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
    return ((rngState >>> 0) / 4294967296);
  };

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const sx = Math.min(W - 1, ((rx + rand()) * cell) | 0);
      const sy = Math.min(H - 1, ((ry + rand()) * cell) | 0);
      const i = (sy * W + sx) * 4;
      const a = px[i + 3];
      if (a < 24) continue;

      const x = (sx / W - 0.5) * aspect;
      const y = 0.5 - sy / H;
      const near = depth ? sampleGrid(depth, sx / W, sy / H) : 0.5;

      const p = used * 3;
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = near;
      // keep display-space colors: our ShaderMaterials write raw to the
      // framebuffer (no output encoding), so linear conversion would darken
      colors[p] = px[i] / 255;
      colors[p + 1] = px[i + 1] / 255;
      colors[p + 2] = px[i + 2] / 255;
      rands[used] = rand();
      if(grid) grid[ry*cols+rx]=used;
      used++;
    }
  }
  const baseCount=used;
  if(grid && baseCount>1){
    // Rank neighbour gaps with a small histogram, rather than sorting hundreds
    // of thousands of JS objects. Temporary arrays live only in the worker.
    const keys=new Int32Array(n*4), scores=new Uint8Array(n*4), histogram=new Uint32Array(256);
    const neighbours=[1,cols,cols+1,cols-1];
    const spacing2=(cell/H)**2;
    let candidates=0;
    for(let slot=0;slot<n;slot++){
      const a=grid[slot];if(a<0)continue;
      for(let axis=0;axis<4;axis++){
        if((axis!==0 && slot+cols>=n) || ((axis===0||axis===2) && slot%cols===cols-1) || (axis===3 && slot%cols===0))continue;
        const b=grid[slot+neighbours[axis]];if(b<0)continue;
        const ai=a*3,bi=b*3;
        if(Math.abs(positions[ai+2]-positions[bi+2])>depthLimit)continue;
        const x=(positions[ai]+positions[bi])*.5, y=(positions[ai+1]+positions[bi+1])*.5;
        const u=x/aspect+.5,v=.5-y;
        const midNear=depth ? sampleGrid(depth,u,v):.5;
        if(Math.abs(midNear-positions[ai+2])>depthLimit || Math.abs(midNear-positions[bi+2])>depthLimit)continue;
        const sx=Math.min(W-1,Math.max(0,Math.floor(u*W))),sy=Math.min(H-1,Math.max(0,Math.floor(v*H)));
        if(px[(sy*W+sx)*4+3]<24)continue;
        const distance2=(positions[ai]-positions[bi])**2+(positions[ai+1]-positions[bi+1])**2;
        const ratio=distance2/(spacing2*(axis>=2 ? 2:1));
        const seam=bandAt(a)!==bandAt(b);
        if(!seam && ratio<=1)continue;
        // Band seams take precedence over density gaps. Unlike ordinary
        // particles, the generated points will interpolate both endpoints.
        const score=seam ? 192+Math.min(63,Math.floor(ratio*12)):Math.min(127,Math.floor((ratio-1)*32));
        keys[candidates]=slot*4+axis;scores[candidates]=score;histogram[score]++;candidates++;
      }
    }
    const pointBudget=Math.floor(Math.min(baseCount*1.5,pointLimit)*fill);
    // More fill increases both the number of bridges and their density.
    // Ordinary point sizes are retained even when animated bands pull apart.
    const samplesPerEdge=Math.max(3,Math.min(24,Math.round(mapping.gapFillDensity ?? 12)));
    const fillRows=Math.max(1,Math.min(7,Math.round(mapping.gapFillRows ?? 3)));
    const spread=Math.max(.2,Math.min(2,mapping.gapFillSpread ?? .8));
    // Reveal central points first, then fill the widest remaining intervals.
    // This progressive order spreads even a small active count across a row.
    const sampleOrder=[],selected=[0,samplesPerEdge+1];
    while(sampleOrder.length<samplesPerEdge){
      let best=0,bestDistance=-1;
      for(let i=1;i<=samplesPerEdge;i++){
        const distance=Math.min(...selected.map(j=>Math.abs(i-j)));
        if(distance>bestDistance){best=i;bestDistance=distance;}
      }
      sampleOrder.push(best);selected.push(best);
    }
    const budget=Math.min(candidates,Math.floor(pointBudget/(samplesPerEdge*fillRows)));
    let threshold=255,above=0;
    while(threshold>0 && above+histogram[threshold]<budget){above+=histogram[threshold];threshold--;}
    const ties=budget-above;
    let tieSeen=0,tieSelected=0;
    const validEndpoint=(x,y,near)=>{
      const u=x/aspect+.5,v=.5-y;
      if(u<0||u>=1||v<0||v>=1)return false;
      return px[(Math.floor(v*H)*W+Math.floor(u*W))*4+3]>=24 && (!depth||Math.abs(sampleGrid(depth,u,v)-near)<=depthLimit);
    };
    let edges=0;
    for(let c=0;c<candidates && edges<budget;c++){
      if(scores[c]<threshold)continue;
      if(scores[c]===threshold){
        const target=Math.floor(++tieSeen*ties/histogram[threshold]);
        if(target===tieSelected)continue;
        tieSelected=target;
      }
      const slot=keys[c]>>2, axis=keys[c]&3;
      const ai=grid[slot]*3,bi=grid[slot+neighbours[axis]]*3;
      edges++;
      const dx=positions[bi]-positions[ai],dy=positions[bi+1]-positions[ai+1];
      const length=Math.hypot(dx,dy);
      if(length===0)continue;
      for(let row=0;row<fillRows;row++){
        // Spread neighbouring rows perpendicular to the bridge. Stagger the
        // samples so the fill reads as a surface rather than aligned strings.
        const offset=(fillRows===1 ? 0:row/(fillRows-1)-.5)*spread*cell/H;
        const ox=-dy/length*offset,oy=dx/length*offset;
        const ax=positions[ai]+ox,ay=positions[ai+1]+oy,bx=positions[bi]+ox,by=positions[bi+1]+oy;
        if(!validEndpoint(ax,ay,positions[ai+2])||!validEndpoint(bx,by,positions[bi+2]))continue;
        for(let sample=1;sample<=samplesPerEdge;sample++){
          const t=(sampleOrder[sample-1]+(rand()-.5)*.6)/(samplesPerEdge+1);
          const x=ax*(1-t)+bx*t,y=ay*(1-t)+by*t,u=x/aspect+.5,v=.5-y;
          const sx=Math.min(W-1,Math.max(0,Math.floor(u*W))),sy=Math.min(H-1,Math.max(0,Math.floor(v*H))),i=(sy*W+sx)*4,p=used*3;
          const near=depth ? sampleGrid(depth,u,v):.5;
          if(px[i+3]<24 || Math.abs(near-positions[ai+2])>depthLimit || Math.abs(near-positions[bi+2])>depthLimit)continue;
          positions[p]=x;positions[p+1]=y;positions[p+2]=near;
          colors[p]=px[i]/255;colors[p+1]=px[i+1]/255;colors[p+2]=px[i+2]/255;
          const f=used-baseCount;
          fillStarts.set([ax,ay,positions[ai+2],rands[ai/3]],f*4);
          fillEnds.set([bx,by,positions[bi+2],rands[bi/3]],f*4);
          fillFractions[f]=t;rands[used]=(sample-1)/samplesPerEdge;used++;
          if(fillThickness){
            const index=Math.min(reconstruction.h-1,Math.floor(v*reconstruction.h))*reconstruction.w
              +Math.min(reconstruction.w-1,Math.floor(u*reconstruction.w));
            fillThickness[f*2]=reconstruction.thickness[index];
            fillThickness[f*2+1]=reconstruction.edgeWeight[index];
            if(reconstruction.edgeWeight[index]>.01){
              const front=positions[ai+2]>=positions[bi+2] ? ai:bi;
              fillForeground.set([colors[front],colors[front+1],colors[front+2],front===ai ? 1:-1],f*4);
            }
          }
        }
      }
    }
  }

  return {
    positions: positions.subarray(0, used * 3),
    colors: colors.subarray(0, used * 3),
    rands: rands.subarray(0, used),
    count: used,
    baseCount,
    depthHistogram:histogram,
    reconstruction: mapping.reconstruction ? sampleOcclusion(mapping.reconstruction,aspect,baseCount,mapping):null,
    fillStarts:fillStarts?.subarray(0,(used-baseCount)*4),
    fillEnds:fillEnds?.subarray(0,(used-baseCount)*4),
    fillFractions:fillFractions?.subarray(0,used-baseCount),
    fillThickness:fillThickness?.subarray(0,(used-baseCount)*2),
    fillForeground:fillForeground?.subarray(0,(used-baseCount)*4),
    aspect,
  };
}

function sampleGrid(depth, u, v) {
  const { data, w, h } = depth;
  const x = Math.min(w - 1, Math.max(0, (u * w) | 0));
  const y = Math.min(h - 1, Math.max(0, (v * h) | 0));
  return data[y * w + x];
}

/** Procedural fallback image so there is always something to visualize. */
export function makeProceduralImage(width = 1600, height = 900) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0b1026');
  sky.addColorStop(0.45, '#232a5c');
  sky.addColorStop(0.75, '#5a3d8a');
  sky.addColorStop(1, '#c4527a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // stars
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * width, y = Math.random() * height * 0.55;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`;
    ctx.fillRect(x, y, Math.random() < 0.1 ? 2 : 1, 1);
  }

  // sun
  const sunY = height * 0.62;
  const sun = ctx.createRadialGradient(width * 0.5, sunY, 10, width * 0.5, sunY, height * 0.42);
  sun.addColorStop(0, 'rgba(255,214,130,0.95)');
  sun.addColorStop(0.35, 'rgba(255,140,105,0.55)');
  sun.addColorStop(1, 'rgba(255,120,90,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);

  // mountains, three parallax layers
  const layers = [
    { base: 0.68, amp: 0.10, color: '#2b2150' },
    { base: 0.78, amp: 0.08, color: '#1d1740' },
    { base: 0.88, amp: 0.05, color: '#120e2c' },
  ];
  layers.forEach((L, li) => {
    ctx.beginPath();
    ctx.moveTo(0, height);
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const x = (s / steps) * width;
      const y = height * L.base - Math.abs(Math.sin(s * (1.7 + li * 0.9) + li * 3)) * height * L.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = L.color;
    ctx.fill();
  });

  // haze band
  const haze = ctx.createLinearGradient(0, height * 0.55, 0, height * 0.85);
  haze.addColorStop(0, 'rgba(255,170,140,0)');
  haze.addColorStop(0.5, 'rgba(255,170,140,0.25)');
  haze.addColorStop(1, 'rgba(255,170,140,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.55, width, height * 0.3);

  return canvas;
}
