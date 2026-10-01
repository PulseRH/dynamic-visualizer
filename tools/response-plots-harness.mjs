import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { responsePlots } from '../src/js/response-plots.js';
import { BandAnalyzer, bandResponse, easeBand } from '../src/js/bands.js';
import { easingCurve, easingProgress, easingBendAt, sCurveProgress, bezierProgress, constrainBezier, moveBezierControl } from '../src/js/easing.js';
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
assert.ok(responsePlots({...s,stickyOut:1}).easingOutSeconds>original.easingOutSeconds,'speed sets the duration, shape stays independent');
assert.equal(original.easingInSeconds,responsePlots({...s,stickyOut:1}).easingInSeconds);
assert.notEqual(original.easingIn,responsePlots({...s,easeInShape:1}).easingIn);
assert.equal(original.easingOut,responsePlots({...s,easeInShape:1}).easingOut);
assert.notEqual(original.easingOut,responsePlots({...s,easeOutShape:-1}).easingOut);
assert.ok(easeBand(0,1,.3,-1,1)>easeBand(0,1,.3,1,1));
assert.ok(easeBand(0,1,.3,1,1)<easeBand(0,1,.3,0,1));
for(const rate of [.04,.1,.3,.6,.9]) {
  const early=easingCurve(rate,-1), late=easingCurve(rate,1);
  assert.equal(early.seconds,late.seconds,'bend moves the response within the same interval');
  assert.ok(early.atSeconds(early.seconds*.5)>.7 && late.atSeconds(late.seconds*.5)<.3);
  assert.equal(early.atSeconds(early.seconds),1);
  assert.equal(easingCurve(rate,0).atSeconds(early.seconds*.5),.5,'zero tension is a straight ramp');
  for(const bend of [-1,-.5,0,.5,1]) {
    const profile=easingCurve(rate,bend);
    let value=0;
    for(let tick=1;tick<=160;tick++) {
      value=profile.advance(value,1,1);
      assert.ok(Math.abs(value-profile.atSeconds(tick*.033))<.00004,'audio steps match the continuous graph, including flat endpoints');
    }
  }
}
for(let b=-1;b<=1;b+=.02) {
  assert.ok(Math.abs(easingBendAt(.5,easingProgress(.5,b))-b)<.0051,'dragging the midpoint recovers the displayed/audio tension');
}
for(const slope of [0,.25,.5,1]) for(const position of [.15,.3,.5,.7,.85]) {
  assert.equal(sCurveProgress(0,slope,position),0);
  assert.equal(sCurveProgress(1,slope,position),1);
  assert.ok(Math.abs(sCurveProgress(position,slope,position)-.5)<1e-12);
  let before=0;
  for(let i=0;i<=1000;i++) {
    const value=sCurveProgress(i/1000,slope,position);
    assert.ok(value>=before && value<=1,'S-curve never reverses or overshoots');before=value;
  }
  for(const rate of [.04,.1,.3,.6,.9]) {
    const profile=easingCurve(rate,0,'s',slope,position);
    let value=0;
    for(let tick=1;tick<=160;tick++) {
      const next=profile.advance(value,1,1);
      assert.ok(next>=value && next<=1);
      assert.ok(Math.abs(next-profile.atSeconds(tick*.033))<.0001,'S-curve audio matches its graph');
      value=next;
    }
    assert.ok(value>.999,'flat starts must not stall');
  }
  const reactive=new BandAnalyzer(2);
  reactive.curve=1;reactive.easeInStyle=reactive.easeOutStyle='s';
  reactive.easeInSlope=reactive.easeOutSlope=slope;
  reactive.easeInPosition=reactive.easeOutPosition=position;
  for(let i=0;i<500;i++) {
    const target=Math.max(0,Math.sin(i*.31));reactive.raw.set([1,target]);
    const prev=reactive.bands[1];reactive._finish();const next=reactive.bands[1];
    assert.ok(Number.isFinite(next) && next>=Math.min(prev,target)-1e-6 && next<=Math.max(prev,target)+1e-6,'S-curve retargeting cannot overshoot');
  }
}
assert.notEqual(original.easingIn,responsePlots({...s,easeInStyle:'s'}).easingIn);
assert.equal(original.easingOut,responsePlots({...s,easeInStyle:'s'}).easingOut);
assert.ok(bezierProgress(.5)>.65 && bezierProgress(.9)>.97,'default custom curve gives the requested quick drop and gentle finish');
for(const points of [[.2,.35,.6,1],[.33,0,.67,1],[.02,0,.02,0],[.98,0,.98,0],[.02,1,.98,1],[.5,.5,.5,.5]]) {
  let before=0;
  for(let i=0;i<=1000;i++) {
    const value=bezierProgress(i/1000,points);
    assert.ok(value>=before && value<=1,'custom curve is monotonic and bounded');before=value;
  }
  for(const rate of [.04,.1,.3,.6,.9]) {
    const profile=easingCurve(rate,0,'custom',.5,.5,points);let value=0;
    for(let tick=1;tick<=160;tick++) {
      const next=profile.advance(value,1,1);
      assert.ok(next>=value && next<=1);
      assert.ok(Math.abs(next-profile.atSeconds(tick*.033))<.0002,'custom audio follows the exact graph');value=next;
    }
    assert.ok(value>.999,'custom curve cannot stall');
  }
  const moved=moveBezierControl(points,0,2,2);
  assert.deepEqual(moved,constrainBezier(moved),'dragging cannot cross the other control or leave the graph');
  const reactive=new BandAnalyzer(2);
  reactive.curve=1;reactive.easeInStyle=reactive.easeOutStyle='custom';
  reactive.easeInBezier=reactive.easeOutBezier=points;
  for(let i=0;i<500;i++) {
    const target=Math.max(0,Math.sin(i*.31));reactive.raw.set([1,target]);
    const prev=reactive.bands[1];reactive._finish();const next=reactive.bands[1];
    assert.ok(Number.isFinite(next) && next>=Math.min(prev,target)-1e-6 && next<=Math.max(prev,target)+1e-6,'custom retargeting stays bounded');
  }
}
for(const bend of [-1,-.5,.5,1]) {
  for(let i=1;i<100;i++) {
    const second=easingProgress((i+1)/100,bend)-2*easingProgress(i/100,bend)+easingProgress((i-1)/100,bend);
    assert.ok(second*Math.sign(bend)>0,'tension bows consistently, without the unwanted S-curve');
  }
}
for(const name of ['easingIn','easingOut']) {
  assert.ok(original[name].includes(' C') && !original[name].includes(' L'),'curves use smooth cubic segments');
}
assert.ok(original.easingIn.startsWith('M60,116') && original.easingOut.startsWith('M60,20'));
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
// Only the envelope changes: spectra, peak normalization, EQ, high boost and
// measured loudness must remain exact compared with the original analyzer.
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
  assert.deepEqual(now.raw,old.raw); assert.deepEqual(now._wraw,old._wraw);
  assert.equal(now.peak,old.peak); assert.equal(now.loud,old.loud); assert.equal(now.bassEnergy,old.bassEnergy);
}
console.log('PASS: envelope tension/drag mapping, graph/audio agreement, bounded retargeting and unchanged spectrum processing across 600 spectra.');
