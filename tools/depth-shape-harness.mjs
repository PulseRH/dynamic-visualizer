import assert from 'node:assert/strict';
import {shapedDepth} from '../src/js/framing-motion.js';
for(const amount of [0,.25,.5,.75,1]){
  assert.equal(shapedDepth(0,amount),0);assert.equal(shapedDepth(1,amount),1);
  let previous=0;
  for(let i=0;i<=1000;i++){
    const near=i/1000,value=shapedDepth(near,amount);
    assert.ok(value>=previous && value<=1);
    if(amount===0)assert.equal(value,near);
    previous=value;
  }
  if(amount>0){
    assert.ok(shapedDepth(.2,amount)-shapedDepth(.1,amount)<.1);
    assert.ok(shapedDepth(.9,amount)-shapedDepth(.8,amount)>.1);
  }
}
console.log('PASS: depth shape is monotonic, keeps endpoints, compresses background, expands foreground; zero is exact.');
