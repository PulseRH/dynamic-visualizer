// Run with Electron on Windows: electron tools/wallpaper-frame-smoke.cjs
const {app,BrowserWindow}=require('electron');
const k=require('koffi');
app.disableHardwareAcceleration();
app.whenReady().then(()=>{
  if(process.platform!=='win32'){console.log('SKIP: native wallpaper client-area check is Windows-only.');app.quit();return;}
  const u=k.load('user32.dll');k.struct('DvFrameSmokeRect',{L:'int32_t',T:'int32_t',R:'int32_t',B:'int32_t'});
  const rect=u.func('bool __stdcall GetClientRect(intptr_t h,_Out_ DvFrameSmokeRect *r)'),get=u.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t h,int i)'),set=u.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t h,int i,intptr_t v)');
  const attach=u.func('intptr_t __stdcall SetParent(intptr_t h,intptr_t p)'),parent=u.func('intptr_t __stdcall GetAncestor(intptr_t h,uint flags)'),pos=u.func('int __stdcall SetWindowPos(intptr_t h,intptr_t after,int x,int y,int w,int hgt,uint flags)');
  const host=new BrowserWindow({show:false,frame:false,width:500,height:400});let child;
  try{
    const p=host.getNativeWindowHandle().readBigUInt64LE(0),results=[];
    for(const thickFrame of [true,false]){
      child=new BrowserWindow({show:false,frame:false,thickFrame,hasShadow:false,roundedCorners:false,resizable:false,movable:false,width:300,height:200});
      const h=child.getNativeWindowHandle().readBigUInt64LE(0);
      set(h,-16,(BigInt(get(h,-16))&~0x80000000n)|0x40000000n);attach(h,p);
      if(BigInt(parent(h,1))!==p)throw Error('Native test window was not parented');
      if(!pos(h,0n,0,0,300,200,0x0034))throw Error('Native test positioning failed');
      const r={L:0,T:0,R:0,B:0};rect(h,r);results.push({thickFrame,width:r.R-r.L,height:r.B-r.T});
      if(!thickFrame&&(r.R-r.L!==300||r.B-r.T!==200))throw Error('Frameless wallpaper lost client pixels after SetParent');
      child.destroy();child=null;
    }
    console.log('PASS: borderless child retains the complete client area after desktop-style reparenting.',results);
  }catch(error){console.error(error);process.exitCode=1;}
  finally{child?.destroy();host.destroy();app.quit();}
});
