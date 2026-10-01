const SETTLE = -Math.log(.01);
const SAMPLE_COUNT = 512;
const curves = new Map();

// Envelope tension, as in an audio envelope editor: zero is a straight ramp,
// negative bows toward a fast start, positive bows toward a slow start.
export function easingProgress(u, bend = 0) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const k = 6 * Math.max(-1, Math.min(1, bend));
  return Math.abs(k) < 1e-6 ? u : Math.expm1(k*u) / Math.expm1(k);
}

// Inverse for the draggable midpoint; shared with the audio curve definition.
export function easingBendAt(u, progress) {
  let lo=-1, hi=1;
  for(let i=0;i<24;i++) {
    const mid=(lo+hi)/2;
    if(easingProgress(u,mid)>progress) lo=mid; else hi=mid;
  }
  return Math.round((lo+hi)/2*100)/100;
}

// Positive odds and a positive exponent guarantee a forward-only sigmoid.
// Position is its half-response point; slope controls the middle tangent.
export function sCurveProgress(u, slope=.5, position=.5) {
  if(u<=0) return 0;
  if(u>=1) return 1;
  const p=Math.max(.15,Math.min(.85,position));
  const n=1+3*Math.max(0,Math.min(1,slope));
  return 1/(1+Math.pow(p*(1-u)/(u*(1-p)),n));
}

export function sCurveTangent(slope=.5,position=.5) {
  const p=Math.max(.15,Math.min(.85,position));
  return (1+3*Math.max(0,Math.min(1,slope)))/(4*p*(1-p));
}

// Tables are shared across bands and built only when controls change.
export function easingCurve(rate, bend = 0, style='envelope', slope=.5, position=.5) {
  const key = `${rate}/${bend}/${style}/${slope}/${position}`;
  if (curves.has(key)) return curves.get(key);
  const step = -Math.log(1-rate) / SETTLE;
  const forward = new Float64Array(SAMPLE_COUNT+1);
  const progressAt=u=>style==='s' ? sCurveProgress(u,slope,position) : easingProgress(u,bend);
  for(let i=0;i<=SAMPLE_COUNT;i++) forward[i]=progressAt(i/SAMPLE_COUNT);
  const curve = {
    seconds: .033/step,
    atSeconds: seconds => progressAt(seconds/.033*step),
    advance(previous,target,span=1) {
      const gap=Math.abs(target-previous);
      if(!gap) return previous;
      span=Math.max(gap,span);
      if(style!=='s' && !bend) return previous+Math.sign(target-previous)*Math.min(gap,span*step);
      const progress=1-gap/span;
      let lo=0,hi=SAMPLE_COUNT;
      while(hi-lo>1) {
        const mid=(lo+hi)>>>1;
        if(forward[mid]<progress) lo=mid; else hi=mid;
      }
      const width=forward[hi]-forward[lo];
      const u=(lo+(width ? (progress-forward[lo])/width : 0))/SAMPLE_COUNT+step;
      const index=Math.min(SAMPLE_COUNT,u*SAMPLE_COUNT);
      const indexLo=Math.min(SAMPLE_COUNT-1,Math.floor(index));
      const next=forward[indexLo]+(forward[indexLo+1]-forward[indexLo])*(index-indexLo);
      const delta=Math.max(0,Math.min(gap,span*(next-progress)));
      return previous+Math.sign(target-previous)*delta;
    },
  };
  curves.set(key,curve);
  if(curves.size>64) curves.delete(curves.keys().next().value);
  return curve;
}

export function easeBand(previous,target,rate,bend=0,span=1) {
  return easingCurve(rate,bend).advance(previous,target,span);
}
