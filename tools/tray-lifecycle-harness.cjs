const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../electron/main.cjs'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let broadcasts = 0, refreshed = 0, stopped = 0;
const cfg = { wallpaperMode: true };
const context = {
  wallpaperActive: true, wallpaperWins: [], wallpaperGeneration: 0, psBlockerId: 1, tray: {},
  readConfig: () => cfg, writeConfig: () => {},
  stopCursorBroadcast: () => stopped++, refreshTrayMenu: () => refreshed++,
  broadcastWallpaperState: () => broadcasts++,
  powerSaveBlocker: { stop: () => {} },
};
context.wallpaperWins = [{ isDestroyed: () => false, destroy: () => {
  assert.equal(context.wallpaperActive, false, 'closed event must see an intentional stop');
  assert.equal(context.wallpaperWins.length, 0);
} }];
vm.createContext(context);
vm.runInContext(section('function disableWallpaperMode()', "ipcMain.handle('wallpaperMode:enable'"), context);
vm.runInContext('disableWallpaperMode()', context);
assert.ok(context.tray, 'stopping wallpaper retains the tray');
assert.equal(cfg.wallpaperMode, false);
assert.equal(broadcasts, 1); assert.equal(refreshed, 1); assert.equal(stopped, 1);
console.log('Stop wallpaper clears windows, retains tray, saves state and broadcasts once.');
