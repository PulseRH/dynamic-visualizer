import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { responsePlots } from '../src/js/response-plots.js';
import { BandAnalyzer, bandResponse, easeBand } from '../src/js/bands.js';
const s = {bands:64,quietMovement:.6,energyResponse:1,sensGain:1,sensFloor:.1,sensCurve:1.5,
  eqCurve:.4,tiltEQ:0,tiltPivot:.5,highBoost:0,stickyIn:.5,stickyOut:.5};
const original = responsePlots(s);
const contrast = responsePlots({...s,sensCurve:3});
assert.equal(original.energy,contrast.energy,'band contrast must not redraw an invented overall-energy response');
assert.notEqual(original.band,contrast.band);
const energy = responsePlots({...s,energyResponse:3});
assert.equal(original.band,energy.band,'overall energy response must not change the band transfer function');
assert.notEqual(original.energy,energy.energy);
assert.equal(bandResponse(0,3,.1,.5),0,'no input always gives zero new band drive');
assert.equal(bandResponse(.05,1,.1,2),0,'noise floor gives zero drive');
assert.equal(bandResponse(1,1,.1,2),1,'peak reference gives full drive');
assert.notEqual(original.frequency,responsePlots({...s,eqCurve:1}).frequency);
assert.deepEqual(original.frequencyWeights,responsePlots({...s,highBoost:2}).frequencyWeights,'high boost is separate from pre-normalisation weighting');
assert.notEqual(original.highBoost,responsePlots({...s,highBoost:2}).highBoost);
assert.notEqual(original.easingOut,responsePlots({...s,stickyOut:1}).easingOut);
assert.equal(original.easingIn,responsePlots({...s,stickyOut:1}).easingIn);
assert.equal(original.easingOut,responsePlots({...s,stickyIn:1}).easingOut);
assert.notEqual(original.easingIn,responsePlots({...s,easeInShape:1}).easingIn);
assert.equal(original.easingOut,responsePlots({...s,easeInShape:1}).easingOut);
assert.notEqual(original.easingOut,responsePlots({...s,easeOutShape:-1}).easingOut);
assert.ok(easeBand(0,1,.3,-1,1)>easeBand(0,1,.3,0,1));
assert.ok(easeBand(0,1,.3,1,1)<easeBand(0,1,.3,0,1));
for(const bend of [-1,-.5,0,.5,1]) {
  let rise=0,fall=1;
  for(let i=0;i<100;i++) {
    const r=easeBand(rise,1,.3,bend,1), f=easeBand(fall,0,.1,bend,1);
    assert.ok(r>=rise && r<=1 && f<=fall && f>=0);
    rise=r; fall=f;
  }
  const reactive = new BandAnalyzer(2);
  reactive.curve=1; reactive.easeInShape=bend; reactive.easeOutShape=bend;
  for(let i=0;i<500;i++) {
    const target=Math.max(0,Math.sin(i*.31));
    reactive.raw.set([1,target]);
    const before=reactive.bands[1]; reactive._finish();
    const after=reactive.bands[1];
    assert.ok(Number.isFinite(after) && after>=Math.min(before,target)-1e-6 && after<=Math.max(before,target)+1e-6,'retargeting is bounded without overshoot');
  }
}
for (const value of Object.values(original)) if (typeof value==='string') assert.ok(!/NaN|Infinity/.test(value));
// Compare shared graph helpers against the pre-change analyzer through actual
// spectra, normalization, EQ, high boost and smoothing. Audio must stay exact.
const oldSource = execFileSync('git',['show','dc861d0:src/js/bands.js'],{encoding:'utf8'});
const {BandAnalyzer:Previous} = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const old = new Previous(64), now = new BandAnalyzer(64);
const samples = new Float32Array(1024);
for(let frame=0;frame<600;frame++) {
  for(const a of [old,now]) {
    a.sensitivity=.2+(frame%29)/10; a.floor=(frame%50)/100; a.curve=.5+(frame%70)/20;
    a.eq=(frame%80)/20; a.highBoost=(frame%30)/10; a.tiltEQ=Math.sin(frame*.2);
    a.tiltPivot=(frame%20)/20; a.stickyIn=(frame%20)/20; a.stickyOut=(frame%17)/17;
  }
  for(let i=0;i<samples.length;i++) samples[i]=Math.max(0,Math.sin(i*.013+frame*.17))*.3;
  old.fromFloat(samples,48000); now.fromFloat(samples,48000);
  assert.deepEqual(now.bands,old.bands); assert.equal(now.loud,old.loud); assert.equal(now.energy,old.energy);
}
console.log('PASS: independent, labelled graph stages, no-input drive, frequency/easing controls and exact analyzer regression across 600 spectra.');
