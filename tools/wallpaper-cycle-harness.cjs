const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/js/app.js'),'utf8');
const start=source.indexOf('async function nextWallpaper()');
const next=source.slice(start,source.indexOf('\nasync function loadInitialImage()',start));
const playlist=[{url:'a'},{url:'b'},{url:'c'}];
let reads=0,picks=[];
const c={isWallpaperWindow:false,cycleBusy:false,cycleElapsed:100,cycleEntries:[],currentImageUrl:'a',
  bridge:{recentImages:async()=>{reads++;return [...playlist];}},ui:{toast:()=>{}},
  handleImagePick:async({url,cycling})=>{assert.ok(cycling);picks.push(url);c.currentImageUrl=url;},
};vm.createContext(c);vm.runInContext(next,c);
(async()=>{
  await vm.runInContext('nextWallpaper()',c);
  await vm.runInContext('nextWallpaper()',c);
  await vm.runInContext('nextWallpaper()',c);
  assert.deepEqual(picks,['b','c','a']);assert.equal(reads,1,'cycle order survives MRU reordering');
  assert.equal(c.cycleElapsed,0);
  let release;c.cycleEntries=[];c.bridge.recentImages=()=>new Promise(r=>release=r);
  const first=vm.runInContext('nextWallpaper()',c);
  await vm.runInContext('nextWallpaper()',c);release(playlist);await first;
  assert.equal(picks.length,4,'concurrent requests must not skip images');
  c.isWallpaperWindow=true;await vm.runInContext('nextWallpaper()',c);assert.equal(picks.length,4,'only preview owns cycling');
  const timerStart=source.indexOf('  let lastCycle=');
  const timer=source.slice(timerStart,source.indexOf('  let lastA',timerStart));
  let callback,clock=0;const settings={wallpaperCycle:true,wallpaperCycleMinutes:1};
  Object.assign(c,{performance:{now:()=>clock},setInterval:fn=>{callback=fn;},get:k=>settings[k],wallpaperAudioActive:true,gameMode:false});
  vm.runInContext(timer,c);c.isWallpaperWindow=false;
  for(let i=0;i<30;i++){clock+=1000;callback();}assert.equal(c.cycleElapsed,30000);
  c.gameMode=true;for(let i=0;i<30;i++){clock+=1000;callback();}assert.equal(c.cycleElapsed,30000,'pause freezes cycle countdown');
  c.gameMode=false;c.wallpaperAudioActive=false;clock+=1000;callback();assert.equal(c.cycleElapsed,30000,'wallpaper off freezes countdown');
  c.wallpaperAudioActive=true;
  for(let i=0;i<30;i++){clock+=1000;callback();}
  await new Promise(r=>setImmediate(r));assert.equal(picks.length,5,'interval selects exactly one next image');
  console.log('Wallpaper cycle wraps in stable order, serializes loading, has a single owner and pauses its countdown with rendering.');
})().catch(e=>{console.error(e);process.exitCode=1;});
