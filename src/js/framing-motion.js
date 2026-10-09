import {surfaceAt} from './surface-motion.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const shapedDepth=(near,amount=0)=>near+amount*near*(near-1);
export function shapedMotionDepth(z, scale, amount=0) {
  const reference=scale>0 ? scale:.33, t=z/reference, bounded=clamp(t,0,1);
  const slope=t<0 ? Math.max(.05,1-amount):1+amount;
  return (shapedDepth(bounded,amount)+(t-bounded)*slope)*reference;
}
export const curvatureDepth=(x,y,aspect,amount=0)=>amount*((x/aspect)**2+y*y);
// A CPU copy of the positional vertex operations, evaluated on <=1024 samples
// only. It uses the exact uploaded band levels and the shader's phase clocks.
export function animatedSample(x, y, near, rand, u, data, out, offset) {
  const aspect = u.uAspect.value, bx = x / aspect + 0.5, by = y + 0.5;
  const map = u.uBandMap.value, n = u.uBandCount.value;
  let bt = map < 0.5 ? near : map < 1.5 ? clamp(Math.hypot(bx - 0.5, by - 0.5) * 1.25, 0, 1)
    : map < 2.5 ? 1 - by : bx;
  if(map<.5 && !(u.uSmartDepthBands?.value>.5)) bt=Math.pow(clamp(near,0,1),u.uBandDistribution?.value ?? 1);
  if (u.uInvert.value > 0.5) bt = 1 - bt;
  let band = clamp(Math.floor(bt * n), 0, n - 1);
  if(map<.5 && u.uSmartDepthBands?.value>.5){
    const lookup=u.uDepthBands.value.image.data;
    band=lookup[Math.min(1023,Math.max(0,Math.floor(near*1024)))*4];
    if(u.uInvert.value>.5)band=n-1-band;
  }
  let amp = data[band * 4] / 255;
  let anchorBand=band;
  let motionNear=near,surfaceWeight=0;
  if(map<.5 && u.uSurfaceCohesion?.value>0){
    const image=u.uSurfaceMotion?.value?.image;
    const surface=surfaceAt(image,x,y,near,aspect,u.uSurfaceCohesion.value);
    motionNear=surface.near;surfaceWeight=surface.weight;
    if(surfaceWeight){
      let anchorT=Math.pow(clamp(surface.anchor,0,1),u.uBandDistribution?.value ?? 1);
      if(u.uInvert.value>.5)anchorT=1-anchorT;
      anchorBand=clamp(Math.floor(anchorT*n),0,n-1);
      if(u.uSmartDepthBands?.value>.5){
        anchorBand=u.uDepthBands.value.image.data[Math.min(1023,Math.max(0,Math.floor(surface.anchor*1024)))*4];
        if(u.uInvert.value>.5)anchorBand=n-1-anchorBand;
      }
      amp+=(data[anchorBand*4]/255-amp)*surfaceWeight;
    }
  }
  const l = u.uLayers.value, e = u.uExtraLayers.value;
  const time = u.uWaveTime.value, xyTime = u.uXYTime.value;
  let style = 0;
  if (l.x) style += l.x * Math.sin(time * 1.7 + bx * 7 + motionNear * 5 + rand * 0.7);
  if (l.y) { const d = Math.hypot(bx - 0.5, by - 0.5); style += l.y * Math.sin(d * 16 - time * 3.1 + motionNear * 3) * (1 - d * 0.55); }
  if (l.z) { const row = Math.floor(by * 28); style += l.z * (Math.sin(time * 2.2 + row * 0.9) * 0.75 + Math.sin(time * 5.3 + row * 2.1) * 0.25); }
  if (l.w) style += l.w * clamp(Math.sin(bx * 9 + time * 0.5) * Math.sin(by * 7 - time * 0.42) * 1.3 + Math.sin(time * 0.8 + rand * 6.2831) * 0.45, -1, 1);
  if (e.z) style += e.z * Math.sin((bx + by) * 11 - time * 2 + motionNear * 2);
  const total = l.x + l.y + l.z + l.w + e.z;
  const direct = 1 + (amp * 2 - 1.8) * u.uCentered.value;
  const depthRange = (0.35 + 0.65 * motionNear) * (1 - u.uEqualDepthMovement.value) + u.uEqualDepthMovement.value;
  const drive = amp * u.uIntensity.value * u.uDyn.value;
  let z = shapedDepth(near,u.uDepthShape?.value ?? 0) * u.uDepthScale.value + (direct + style / Math.max(1, total) * 0.65) * drive * u.uZMove.value * 0.11 * depthRange;
  if(u.uDepthShapeMotion?.value>.5) z=shapedMotionDepth(near*u.uDepthScale.value+(direct+style/Math.max(1,total)*.65)*drive*u.uZMove.value*.11*depthRange,u.uDepthScale.value,u.uDepthShape?.value ?? 0);
  let px = x + Math.sin(xyTime * 3.1 + rand * 40) * drive * u.uXYMove.value * 0.006;
  let py = y + Math.cos(xyTime * 2.6 + rand * 30) * drive * u.uXYMove.value * 0.006;
  const layerDrive = amp * Math.min(u.uIntensity.value * u.uDyn.value, 1.5);
  let rx = x, ry = y;
  if (e.x) {
    const turn = Math.sin(time * 0.8 + Math.hypot(x, y) * 4 + motionNear * 1.2) * e.x * layerDrive * 0.112;
    rx = Math.cos(turn) * x - Math.sin(turn) * y;
    ry = Math.sin(turn) * x + Math.cos(turn) * y;
  }
  if (e.y) { const swell = 1 + Math.sin(time * 1.4 + motionNear * 1.2) * e.y * layerDrive * 0.2; rx *= swell; ry *= swell; }
  px += rx - x; py += ry - y;
  if (e.w) {
    const phase = band * 2.399963, shake = e.w * e.w * amp * layerDrive * 0.045;
    let sx=Math.sin(xyTime*4.3+phase),sy=Math.sin(xyTime*5.7+phase*1.37+1.1);
    if(surfaceWeight){
      const anchorPhase=anchorBand*2.399963;
      sx+=(Math.sin(xyTime*4.3+anchorPhase)-sx)*surfaceWeight;
      sy+=(Math.sin(xyTime*5.7+anchorPhase*1.37+1.1)-sy)*surfaceWeight;
    }
    px+=sx*shake;py+=sy*shake;
  }
  const cursor = u.uCursor.value;
  const ripple = Math.exp(-((px - cursor.x) ** 2 + (py - cursor.y) ** 2) * 4) * cursor.z;
  z += ripple * 0.1;
  px += (px - cursor.x) * ripple * 0.05; py += (py - cursor.y) * ripple * 0.05;
  z += curvatureDepth(x,y,aspect,u.uCurvature?.value ?? 0);
  // Ignore the intentional fly-by exit: framing must not chase that effect.
  out[offset] = px; out[offset + 1] = py; out[offset + 2] = z;
}
