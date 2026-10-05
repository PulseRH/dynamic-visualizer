'use strict';
// Run from a real layer-shell Wayland session: electron tools/wayland-wallpaper-smoke.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { createWaylandWallpaper } = require('../electron/wayland-wallpaper.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const wins = [];
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    for (const display of screen.getAllDisplays()) {
      const win = await createWaylandWallpaper({
        BrowserWindow, display,
        preload: path.join(__dirname, '../electron/preload.cjs'),
        title: 'Wayland wallpaper smoke test',
        onFailure: error => { throw error; },
      });
      wins.push(win);
      await win.loadURL('data:text/html,' + encodeURIComponent(`
        <style>body{margin:0;background:#061220}canvas{width:100vw;height:100vh}</style>
        <canvas></canvas><script>
        const c=document.querySelector('canvas');c.width=innerWidth;c.height=innerHeight;
        const ctx=c.getContext('2d');let x=0;
        setInterval(()=>{ctx.fillStyle='#061220';ctx.fillRect(0,0,c.width,c.height);
        ctx.fillStyle='#6ea8ff';ctx.fillRect((x+=20)%c.width,0,100,c.height);},34);
        </script>`));
    }
    await wait(2500);
    for (const win of wins) {
      const state = win.waylandWallpaper.getState();
      console.log(JSON.stringify(state));
      assert.equal(state.mapped, true);
      assert.ok(state.frameCount > 2, 'Animated frames must reach the compositor.');
      assert.ok(!state.error && !state.renderError);
      assert.equal(state.output, win.waylandWallpaper.output);
    }
    await Promise.all(wins.map(win => win.waylandWallpaper.setPaused(true)));
    assert.ok(wins.every(win => win.waylandWallpaper.getState().paused));
    await Promise.all(wins.map(win => win.waylandWallpaper.setPaused(false)));
    await wait(1500);
    assert.ok(wins.every(win => win.waylandWallpaper.getState().frameCount > 2));
    console.log('PASS: all outputs render; pause unmaps; resume renders; close releases surfaces.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const win of wins) if (!win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  }
});
