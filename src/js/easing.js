const SETTLE = -Math.log(.01);
const SAMPLE_COUNT = 512;
const curves = new Map();
const cubic = (t, a, b) => 3 * (1-t) * (1-t) * t * a + 3 * (1-t) * t * t * b + t*t*t;
const interpolate = (values, x) => {
  const index = Math.max(0, Math.min(SAMPLE_COUNT, x * SAMPLE_COUNT));
  const lo = Math.min(SAMPLE_COUNT-1, Math.floor(index));
  return values[lo] + (values[lo+1]-values[lo]) * (index-lo);
};

// Shape moves a smooth Bézier transition earlier/later within the same
// settling interval. Centre blends back to the original exponential exactly.
// Tables are shared across bands, built on control changes, never per frame.
export function easingCurve(rate, bend = 0) {
  const key = `${rate}/${bend}`;
  if (curves.has(key)) return curves.get(key);
  const strength = Math.min(1, Math.abs(bend));
  const x1 = bend > 0 ? .6 : .2, x2 = bend > 0 ? .8 : .4;
  const step = -Math.log(1-rate) / SETTLE;
  const end = 1 - (1-strength) * .01;
  const forward = new Float64Array(SAMPLE_COUNT+1);
  function at(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1 - (1-strength) * Math.exp(-SETTLE*u);
    if (!strength) return 1 - Math.exp(-SETTLE*u);
    let lo=0, hi=1;
    for(let i=0;i<22;i++) {
      const t=(lo+hi)/2;
      if(cubic(t,x1,x2)<u) lo=t; else hi=t;
    }
    const bezier=cubic((lo+hi)/2,0,1);
    return (1-strength)*(1-Math.exp(-SETTLE*u)) + strength*bezier;
  }
  for(let i=0;i<=SAMPLE_COUNT;i++) forward[i]=at(i/SAMPLE_COUNT);
  const curve = {
    seconds: .033/step,
    atSeconds: seconds => at(seconds/.033*step),
    advance(previous,target,span=1) {
      const gap=Math.abs(target-previous);
      if(!gap) return previous;
      if(!strength || gap/Math.max(gap,span)<=1-end) return previous+(target-previous)*rate;
      span=Math.max(gap,span);
      const progress=1-gap/span;
      // Search the forward table itself: a uniformly sampled inverse loses
      // precision near flat endpoints and can stall a strongly delayed bend.
      let lo=0,hi=SAMPLE_COUNT;
      while(hi-lo>1) {
        const mid=(lo+hi)>>>1;
        if(forward[mid]<progress) lo=mid; else hi=mid;
      }
      const width=forward[hi]-forward[lo];
      const u=(lo+(width ? (progress-forward[lo])/width : 0))/SAMPLE_COUNT+step;
      const next=u>=1 ? 1-(1-strength)*Math.exp(-SETTLE*u) : interpolate(forward,u);
      const delta=Math.max(0,Math.min(gap, gap-span*(1-next)));
      return previous+Math.sign(target-previous)*delta;
    },
  };
  curves.set(key,curve);
  if(curves.size>64) curves.delete(curves.keys().next().value);
  return curve;
}

export function easeBand(previous,target,rate,bend=0,span=1) {
  if(!bend) return previous+(target-previous)*rate;
  return easingCurve(rate,bend).advance(previous,target,span);
}
