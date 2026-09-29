'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../electron/main.cjs'), 'utf8');
const startup = source.slice(source.indexOf('    // restore wallpaper mode'), source.indexOf('\n  });', source.indexOf('    // restore wallpaper mode')));
const create = source.slice(source.indexOf('function createWindow('), source.indexOf('\nconst gotLock'));

(async () => {
  for (const startInTray of [false, true]) {
    for (const hiddenFlag of [false, true]) {
      for (const wallpaperMode of [false, true]) {
        const events = [];
        const context = {
          mainWindow: null, wallpaperActive: wallpaperMode,
          path: require('node:path'), __dirname: 'electron',
          readConfig: () => ({ startInTray, wallpaperMode, autoGameMode: false }),
          process: { argv: hiddenFlag ? ['app', '--hidden'] : ['app'] },
          enableWallpaperMode: async () => {
            assert.ok(context.mainWindow, 'audio host must exist before wallpaper starts');
            events.push('wallpaper');
          },
          BrowserWindow: class {
            constructor(options) { this.options = options; events.push('host'); }
            loadURL(url) { this.url = url; }
            on() {}
          },
        };
        vm.createContext(context);
        vm.runInContext(create, context);
        await vm.runInContext(`(async () => { ${startup} })()`, context);
        assert.equal(context.mainWindow.options.show, !startInTray && !hiddenFlag);
        assert.equal(context.mainWindow.options.webPreferences.backgroundThrottling, false);
        assert.equal(context.mainWindow.url, 'app://bundle/src/index.html');
        assert.deepEqual(events, wallpaperMode ? ['host', 'wallpaper'] : ['host']);
      }
    }
  }
  console.log('All 8 startup combinations passed: audio host created, visibility respected, wallpaper started afterward.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
