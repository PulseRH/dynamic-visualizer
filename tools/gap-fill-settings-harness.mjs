import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/settings.js',import.meta.url),'utf8');
globalThis.window={addEventListener(){}};
globalThis.setInterval=()=>0;
let saved;
globalThis.localStorage={getItem:()=>JSON.stringify(saved),setItem(){}};
let run=0;
for(const [value,expected] of [[true,1],[false,0],[.35,.35],[-1,0],[2,1],[undefined,1]]){
  saved={gapFillAdaptive:value,gapFillBrightness:.7};
  const settings=await import(`data:text/javascript;base64,${Buffer.from(source+'\n//'+run++).toString('base64')}`);
  assert.equal(settings.get('gapFillAdaptive'),expected);
  assert.equal(settings.get('gapFillBrightness'),.7);
  settings.set({gapFillAdaptive:.6});assert.equal(settings.get('gapFillAdaptive'),.6);
}
console.log('PASS: old checkbox choices migrate, slider strengths persist, unrelated fill settings preserved.');
