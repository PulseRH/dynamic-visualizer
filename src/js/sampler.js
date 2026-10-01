// Converts an image (+ optional nearness grid) into a packed point cloud:
// jittered grid sampling so coverage is even, colors in linear space,
// z = nearness (0..1; the shader scales it and the audio drives displacement).

export function sampleImageToCloud(bitmap, depth, count, gapFill=0) {
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
  const extraCapacity=Math.floor(Math.min(n*.5,60000)*fill);
  const capacity=n+extraCapacity;
  const grid=extraCapacity ? new Int32Array(n).fill(-1):null;

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const rands = new Float32Array(capacity);

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
    const keys=new Int32Array(n*2), scores=new Uint8Array(n*2), histogram=new Uint32Array(256);
    const spacing2=(cell/H)**2;
    let candidates=0;
    for(let slot=0;slot<n;slot++){
      const a=grid[slot];if(a<0)continue;
      for(let axis=0;axis<2;axis++){
        if(axis===0 ? slot%cols===cols-1 : slot+cols>=n)continue;
        const b=grid[slot+(axis===0 ? 1:cols)];if(b<0)continue;
        const ai=a*3,bi=b*3;
        if(Math.abs(positions[ai+2]-positions[bi+2])>.06)continue;
        const x=(positions[ai]+positions[bi])*.5, y=(positions[ai+1]+positions[bi+1])*.5;
        const u=x/aspect+.5,v=.5-y;
        const midNear=depth ? sampleGrid(depth,u,v):.5;
        if(Math.abs(midNear-positions[ai+2])>.06 || Math.abs(midNear-positions[bi+2])>.06)continue;
        const sx=Math.min(W-1,Math.max(0,Math.floor(u*W))),sy=Math.min(H-1,Math.max(0,Math.floor(v*H)));
        if(px[(sy*W+sx)*4+3]<24)continue;
        const distance2=(positions[ai]-positions[bi])**2+(positions[ai+1]-positions[bi+1])**2;
        const ratio=distance2/spacing2;
        if(ratio<=1)continue;
        const score=Math.min(255,Math.floor((ratio-1)*64));
        keys[candidates]=slot*2+axis;scores[candidates]=score;histogram[score]++;candidates++;
      }
    }
    const budget=Math.min(candidates,Math.floor(Math.min(baseCount*.5,60000)*fill));
    let threshold=255,above=0;
    while(threshold>0 && above+histogram[threshold]<budget){above+=histogram[threshold];threshold--;}
    let ties=budget-above;
    for(let c=0;c<candidates && used-baseCount<budget;c++){
      if(scores[c]<threshold || (scores[c]===threshold && ties--<=0))continue;
      const slot=keys[c]>>1, axis=keys[c]&1;
      const ai=grid[slot]*3,bi=grid[slot+(axis===0 ? 1:cols)]*3;
      const x=(positions[ai]+positions[bi])*.5,y=(positions[ai+1]+positions[bi+1])*.5,u=x/aspect+.5,v=.5-y;
      const sx=Math.min(W-1,Math.max(0,Math.floor(u*W))),sy=Math.min(H-1,Math.max(0,Math.floor(v*H))),i=(sy*W+sx)*4,p=used*3;
      positions[p]=x;positions[p+1]=y;positions[p+2]=depth ? sampleGrid(depth,u,v):.5;
      colors[p]=px[i]/255;colors[p+1]=px[i+1]/255;colors[p+2]=px[i+2]/255;
      rands[used]=rand();used++;
    }
  }

  return {
    positions: positions.subarray(0, used * 3),
    colors: colors.subarray(0, used * 3),
    rands: rands.subarray(0, used),
    count: used,
    baseCount,
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
