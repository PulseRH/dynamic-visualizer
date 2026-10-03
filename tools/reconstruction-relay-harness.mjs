import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/js/app.js',import.meta.url),'utf8');
const rebuild=source.slice(source.indexOf('async function rebuildCloud()'),source.indexOf('// ------------------------------------------------------- wallpaper mode'));
const reconstruction={rgb:new Uint8Array([10,20,30]),count:1};
const make=(ready,result)=>{
 let requested=0,cloudOptions;
 const config={depthMode:'onnx',occludedBackground:true,pointCount:100000,gapFill:0,reconstructionPointLimit:120000,reconstructionWidth:2.5};
 const context=vm.createContext({currentImage:{},currentImageUrl:'test-wallpaper',isWallpaperWindow:true,
  relayedDepth:{key:'test-wallpaper',mode:'onnx',data:new Float32Array([.1,.9]),w:2,h:1,reconstructionReady:ready,reconstruction:result},
  rebuildToken:0,activeDepthAbort:null,activeReconstructionAbort:null,awaitingRelay:false,displayedImage:null,
  gameMode:false,previewVisible:false,ImageBitmap:class{},
  get:key=>config[key],getAll:()=>config,depthModelUrl:()=>null,
  estimateDepth:()=>{throw Error('Wallpaper must reuse the preview depth');},
  reconstructBackground:()=>{throw Error('Wallpaper must never load an AI runtime');},
  bridge:{requestDepthGrid:()=>requested++},
  buildCloud:async(_image,_depth,_count,_fill,options)=>{cloudOptions=options;return {count:100};},
  scene:{points:null,beginCrossfade(){},setCloud(){},setBackdrop(){},applySettings(){}},
 });
 vm.runInContext(rebuild,context);
 return {run:()=>context.rebuildCloud(),requested:()=>requested,options:()=>cloudOptions,context};
};
const completed=make(true,reconstruction);await completed.run();assert.equal(completed.options().reconstruction,reconstruction);
assert.equal(completed.options().reconstructionPointLimit,120000);assert.equal(completed.options().reconstructionWidth,2.5);
const failed=make(true,null);await failed.run();assert.equal(failed.options().reconstruction,null,'failed inference must allow the normal cloud to appear');
const pending=make(false,null);await pending.run();assert.equal(pending.requested(),1);assert.equal(pending.options(),undefined);assert.equal(pending.context.awaitingRelay,true);
pending.context.relayedDepth.reconstructionReady=true;pending.context.relayedDepth.reconstruction=reconstruction;await pending.run();assert.equal(pending.options().reconstruction,reconstruction);
console.log('PASS: wallpaper reuses the preview asset, requests pending assets, accepts late completion and tolerates failed AI without loading a model.');
