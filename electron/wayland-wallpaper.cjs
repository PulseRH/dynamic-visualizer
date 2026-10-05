'use strict';

// An X11 Electron process may still run inside a Wayland session. Its native
// handles must continue to use the existing X11 backend.
function usesNativeWayland(platform = process.platform, env = process.env, argv = process.argv) {
  if (platform !== 'linux') return false;
  const index = argv.findIndex(arg => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='));
  const ozone = index < 0 ? undefined : argv[index].split('=')[1] || argv[index + 1];
  if (ozone === 'x11') return false;
  if (ozone === 'wayland') return true;
  return !!env.WAYLAND_DISPLAY;
}

async function createWaylandWallpaper({ BrowserWindow, display, preload, title, onFailure }) {
  // Chromium combines monitor make/model and wl_output.name in its label.
  // The final component is the connector; never infer it from array order.
  const output = display.label?.split(' - ').at(-1)?.trim();
  if (!output) throw new Error('Wayland did not supply this monitor’s output name.');
  const { createLayerShellOverlay } = await import('./vendor/wayland-wallpaper/transport.mjs');
  const options = {
    placement: { type: 'output', output, anchor: 'fill' },
    namespace: 'dynamic-visualizer-wallpaper',
    initializationTimeoutMs: 5000,
  };
  let surface = await createLayerShellOverlay(options);
  let win;
  try {
    const state = surface.getState();
    win = new BrowserWindow({
      width: state.width, height: state.height,
      frame: false, show: false, focusable: false, skipTaskbar: true,
      backgroundColor: '#000000', title,
      webPreferences: {
        preload, contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false,
        // Linux shared textures currently fail on some GPU drivers before
        // Electron emits paint. Bitmap transport keeps WebGL GPU accelerated.
        offscreen: { useSharedTexture: process.env.DV_WAYLAND_SHARED_TEXTURE === '1' },
      },
    });
    win.webContents.setFrameRate(30);
    surface.attachOffscreenWindow(win);
  } catch (error) {
    surface.close();
    if (win && !win.isDestroyed()) win.destroy();
    throw error;
  }

  let destroyed = false;
  let paused = false;
  let generation = 0;
  let monitor;
  const closeSurface = () => {
    const old = surface;
    surface = null;
    old?.close();
  };
  const fail = error => {
    if (destroyed) return;
    onFailure?.(error);
    if (!win.isDestroyed()) win.destroy();
  };
  win.on('closed', () => {
    destroyed = true;
    generation++;
    clearInterval(monitor);
    closeSurface();
  });
  monitor = setInterval(() => {
    if (!surface) return;
    try {
      const state = surface.getState();
      if (state.closed || state.compositorClosed || state.error) {
        fail(new Error(state.error || 'Wayland wallpaper surface closed.'));
      }
    } catch (error) { fail(error); }
  }, 1000);
  monitor.unref();

  // BrowserWindow.hide() does not unmap a separately owned layer surface.
  // Closing the surface releases all GPU leases; resume creates a fresh one.
  win.waylandWallpaper = {
    output,
    getState: () => surface?.getState() || { paused, closed: destroyed },
    async setPaused(value) {
      if (destroyed || paused === value) return;
      paused = value;
      const request = ++generation;
      if (value) {
        closeSurface();
        win.webContents.stopPainting();
        return;
      }
      let next;
      try {
        next = await createLayerShellOverlay(options);
        if (destroyed || request !== generation) { next.close(); return; }
        surface = next;
        surface.attachOffscreenWindow(win);
        win.webContents.startPainting();
        win.webContents.invalidate();
      } catch (error) {
        if (next && next !== surface) next.close();
        if (!destroyed && request === generation) fail(error);
      }
    },
  };
  return win;
}

module.exports = { usesNativeWayland, createWaylandWallpaper };
