import { movementResponse } from './response.js';
import { BandAnalyzer, bandResponse, easingRates } from './bands.js';
import { easingCurve } from './easing.js';

const xAt = x => 60 + x * 224;
const yAt = y => 116 - y * 96;
const path = points => points.map(([x,y],i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
// Monotone cubic segments retain the sampled response without visible corners
// or spline overshoot. Used for the continuously evaluated easing diagrams.
function smoothPath(points, startFlat = false) {
  const slopes=points.slice(1).map((p,i)=>(p[1]-points[i][1])/(p[0]-points[i][0]));
  const tangent=points.map((_,i)=>i===0 ? (startFlat ? 0 : slopes[0]) : i===points.length-1 ? slopes[i-1]
    : slopes[i-1]*slopes[i]>0 ? 2*slopes[i-1]*slopes[i]/(slopes[i-1]+slopes[i]) : 0);
  let d=`M${points[0][0]},${points[0][1]}`;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],h=(b[0]-a[0])/3;
    d+=` C${(a[0]+h).toFixed(3)},${(a[1]+tangent[i-1]*h).toFixed(3)} ${(b[0]-h).toFixed(3)},${(b[1]-tangent[i]*h).toFixed(3)} ${b[0].toFixed(3)},${b[1].toFixed(3)}`;
  }
  return d;
}

// Static illustrations: regenerate on relevant setting changes only.
export function responsePlots(s) {
  const energy = [], band = [];
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    energy.push([xAt(x), yAt(movementResponse(x, s.quietMovement, s.energyResponse))]);
    band.push([xAt(x), yAt(bandResponse(x, s.sensGain, s.sensFloor, s.sensCurve))]);
  }
  const model = new BandAnalyzer(s.bands);
  model.eq = s.eqCurve; model.highBoost = s.highBoost;
  const {lo,hi} = model.edges(1024, 48000);
  model._updateEqWeights(1024, 48000, lo, hi);
  model._updateResponseFactors(s.tiltEQ, s.tiltPivot);
  const weights = [], highs = [];
  for (let i = 0; i < model.count; i++) {
    weights.push(20 * Math.log10(model._tiltFactors[i] * model._hearingFactors[i]));
    highs.push(20 * Math.log10(model._highBoostFactors[i]));
  }
  const min = Math.min(-12, Math.floor(Math.min(...weights) / 12) * 12);
  const max = Math.max(12, Math.ceil(Math.max(...weights, ...highs) / 12) * 12);
  const fy = db => yAt((db - min) / (max - min));
  const fx = i => xAt(Math.max(0, Math.min(1, Math.log(((lo[i] + hi[i]) / 2) * 24000 / 1024 / 30) / Math.log(16000 / 30))));
  const rise = [], fall = [];
  const {up,down} = easingRates(s.stickyIn,s.stickyOut);
  const inCurve=easingCurve(up,s.easeInShape || 0), outCurve=easingCurve(down,s.easeOutShape || 0);
  const seconds=Math.max(.1,Math.ceil(Math.max(inCurve.seconds,outCurve.seconds)*10)/10);
  for (let i = 0; i <= 256; i++) {
    const t=i/256;
    rise.push([xAt(t),yAt(inCurve.atSeconds(t*seconds))]);
    fall.push([xAt(t),yAt(1-outCurve.atSeconds(t*seconds))]);
  }
  return {
    energy: path(energy), energyOriginY: yAt(movementResponse(0,s.quietMovement,s.energyResponse)), band: path(band), threshold: Math.min(1,s.sensFloor / s.sensGain),
    frequencyWeights: weights, frequency: path(weights.map((w,i) => [fx(i),fy(w)])),
    highBoost: path(highs.map((w,i) => [fx(i),fy(w)])),
    frequencyZero: `M60 ${fy(0)}H284`, zeroY: fy(0), min, max,
    easingIn: smoothPath(rise,Math.abs(s.easeInShape)===1), easingOut: smoothPath(fall,Math.abs(s.easeOutShape)===1), easingSeconds: seconds,
  };
}
