const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../electron/main.cjs'),'utf8');
const create=source.slice(source.indexOf('function createWindow('),source.indexOf('\nconst gotLock'));
const sent=[];let query;
class Window {
  constructor(opts){this.visible=opts.show;this.minimized=false;this.events={};this.webContents={send:(channel,value)=>sent.push([channel,value])};}
  on(name,fn){this.events[name]=fn;}
  loadURL(){} isVisible(){return this.visible;} isMinimized(){return this.minimized;} isDestroyed(){return false;}
}
const c={mainWindow:null,BrowserWindow:Window,path:require('node:path'),__dirname:'electron',readConfig:()=>({}),ipcMain:{handle:(_channel,fn)=>{query=fn;}}};
Window.fromWebContents=sender=>sender===c.mainWindow.webContents ? c.mainWindow : null;
vm.createContext(c);vm.runInContext(create,c);vm.runInContext('createWindow({show:false})',c);
const start=source.indexOf("ipcMain.handle('window:visible'");vm.runInContext(source.slice(start,source.indexOf('\n});',start)+4),c);
const w=c.mainWindow,event={sender:w.webContents};assert.equal(query(event),false);
w.visible=true;w.events.show();assert.equal(query(event),true);
w.minimized=true;w.events.minimize();assert.equal(query(event),false,'minimized window may still report isVisible');
w.minimized=false;w.events.restore();assert.equal(query(event),true);
w.visible=false;w.events.hide();assert.equal(query(event),false);
assert.deepEqual(sent,[['window:visibility',true],['window:visibility',false],['window:visibility',true],['window:visibility',false]]);
assert.equal(query({sender:{}}),false);
console.log('Native show/hide/minimize/restore report correct preview visibility; tray startup and unknown senders are hidden.');
