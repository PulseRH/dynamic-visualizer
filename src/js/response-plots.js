import { movementResponse } from './response.js';
import { BandAnalyzer, bandResponse, easingRates } from './bands.js';

const xAt = x => 42 + x * 242;
const yAt = y => 106 - y * 86;
const path = points => points.map(([x,y],i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

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
  const eased = [];
  const {up,down} = easingRates(s.stickyIn,s.stickyOut);
  let level = 0;
  for (let i = 0; i <= 90; i++) {
    const target = i >= 15 && i < 45 ? 1 : 0;
    level += (target-level) * (target > level ? up : down);
    eased.push([xAt(i/90),yAt(level)]);
  }
  return {
    energy: path(energy), band: path(band), threshold: Math.min(1,s.sensFloor / s.sensGain),
    frequencyWeights: weights, frequency: path(weights.map((w,i) => [fx(i),fy(w)])),
    highBoost: path(highs.map((w,i) => [fx(i),fy(w)])),
    frequencyZero: `M42 ${fy(0)}H284`, zeroY: fy(0), min, max,
    easing: path(eased), easingInput: `M42 106H${xAt(15/90)}V20H${xAt(45/90)}V106H284`,
  };
}
