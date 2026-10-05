'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, screen, dialog, nativeImage } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-wayland-test-'));
app.setPath('appData', profile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
require('../electron/main.cjs');
const watchdog = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  let preview;
  try {
    await wait(1500);
    preview = BrowserWindow.getAllWindows()[0];
    assert.ok(preview);
    const imagePath = path.join(profile, 'Uploaded wallpaper # ? %.png');
    const pixels = Buffer.alloc(128 * 96 * 4);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = x * 2; pixels[offset + 1] = y * 2;
      pixels[offset + 2] = (x + y) % 256; pixels[offset + 3] = 255;
    }
    fs.writeFileSync(imagePath, nativeImage.createFromBitmap(pixels, { width: 128, height: 96 }).toPNG());
    const originalDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] });
    try {
      await preview.webContents.executeJavaScript('document.getElementById("uploadImage").onclick()');
    } finally { dialog.showOpenDialog = originalDialog; }
    const imageUrl = await preview.webContents.executeJavaScript('JSON.parse(localStorage.getItem("dv.settings.v1")).imageUrl');
    assert.ok(imageUrl.includes('Uploaded%20wallpaper%20%23%20%3F%20%25.png'));
    const uploaded = await preview.webContents.executeJavaScript(`(async () => { const r = await fetch(${JSON.stringify(imageUrl)}); const bitmap = await createImageBitmap(await r.blob()); return { ok:r.ok, width:bitmap.width, height:bitmap.height }; })()`);
    assert.deepEqual(uploaded, { ok: true, width: 128, height: 96 });
    await wait(250);
    assert.ok((await preview.webContents.executeJavaScript('window.dv.recentImages()')).length > 0);
    console.log('PASS: Upload button imports and remembers an image with spaces, #, ? and % in its filename.');
    const cancelled = await preview.webContents.executeJavaScript('(async () => { const pending = window.dv.enableWallpaper(); await window.dv.disableWallpaper(); return await pending; })()');
    assert.equal(cancelled.ok, false);
    assert.equal(BrowserWindow.getAllWindows().filter(win => win.waylandWallpaper).length, 0);
    const result = await preview.webContents.executeJavaScript('window.dv.enableWallpaper()');
    assert.equal(result.ok, true, result.error);
    await wait(3500);
    const wallpapers = BrowserWindow.getAllWindows().filter(win => win.waylandWallpaper);
    assert.equal(wallpapers.length, screen.getAllDisplays().length);
    for (const win of wallpapers) {
      const state = win.waylandWallpaper.getState();
      assert.ok(state.submittedFrameCount > 2, JSON.stringify(state));
      assert.ok(!state.error && !state.renderError);
      assert.equal(await win.webContents.executeJavaScript('document.hidden'), false);
      const image = await win.webContents.capturePage();
      const pixels = image.toBitmap();
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4096) colors.add(pixels.readUInt32LE(i));
      assert.ok(colors.size > 8, 'The point cloud must render varied colors, rather than a blank surface.');
      console.log(JSON.stringify({ output: state.output, frames: state.frameCount, sampledColors: colors.size }));
    }
    preview.hide();
    const before = wallpapers.map(win => win.waylandWallpaper.getState().frameCount);
    await wait(1000);
    assert.ok(wallpapers.every((win, i) => win.waylandWallpaper.getState().frameCount > before[i]));
    assert.equal((await preview.webContents.executeJavaScript('window.dv.disableWallpaper()')).ok, true);
    assert.ok(wallpapers.every(win => win.isDestroyed()));
    console.log('PASS: real Three.js clouds render on all outputs, keep animating with preview hidden, and stop cleanly.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    app.exit(process.exitCode || 0);
  }
});
