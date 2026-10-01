'use strict';
const { app, BrowserWindow, ipcMain, dialog, session, protocol, net, screen, Tray, Menu, nativeImage, powerSaveBlocker, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream');

const PROJECT_ROOT = path.join(__dirname, '..');

// Dev builds run with their own profile so the installed build can run at
// the same time (both would otherwise claim the same single-instance lock
// and user data). First dev launch copies the installed profile's settings,
// storage and model cache — minus wallpaper mode, so the two don't fight
// over the desktop.
if (!app.isPackaged) {
  const devData = path.join(app.getPath('appData'), 'dynamic-visualizer-dev');
  const instData = path.join(app.getPath('appData'), 'Dynamic Visualizer');
  if (!fs.existsSync(devData) && fs.existsSync(instData)) {
    try {
      fs.cpSync(instData, devData, {
        recursive: true,
        filter: (s) => !/(GPUCache|Code Cache|ShaderCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|logs)$/.test(s),
      });
      const cfgPath = path.join(devData, 'config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        cfg.wallpaperMode = false;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      }
      console.log('[dev profile] copied installed profile ->', devData);
    } catch (err) {
      console.log('[dev profile] migration failed:', err.message);
    }
  }
  app.setPath('userData', devData);
}
const SERVE_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.mjs', '.cjs', '.json', '.txt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.wasm', '.onnx',
]);

// ---------------------------------------------------------------------------
// app:// protocol — lets the renderer fetch local files (images, wasm, models)
// with a real origin instead of file:// quirks.
//   app://<relative/path>        -> resolved against the project root
//   app://abs/<encoded/abs/path> -> an absolute path (e.g. a user's wallpaper)
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      let filePath;
      if (rel.startsWith('abs/')) {
        filePath = path.resolve(rel.slice(4));
      } else {
        filePath = path.resolve(PROJECT_ROOT, rel);
      }
      const ext = path.extname(filePath).toLowerCase();
      if (!SERVE_EXTENSIONS.has(ext)) {
        return new Response('Forbidden extension', { status: 403 });
      }
      return net.fetch('file://' + filePath.split(path.sep).join('/'));
    } catch (err) {
      return new Response('Bad request: ' + err.message, { status: 400 });
    }
  });
}

// ---------------------------------------------------------------------------
// Wallpaper detection (best-effort, per desktop environment)
// ---------------------------------------------------------------------------
function run(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch {} resolve(out || null); } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
    child.on('close', () => { if (!done) { done = true; clearTimeout(timer); resolve(out || null); } });
  });
}

function firstFile(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      const p = c.startsWith('file://') ? require('url').fileURLToPath(c) : c;
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

async function getWallpaperPath() {
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      const reg = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper']);
      if (reg) {
        const m = reg.match(/WallPaper\s+REG_SZ\s+(.*)/);
        if (m) {
          const p = m[1].trim();
          const transcodes = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
          const found = firstFile(p, path.join(path.dirname(p), 'TranscodedWallpaper'), transcodes);
          if (found) return found;
        }
      }
      return null;
    }

    if (plat === 'linux') {
      // GNOME / Cinnamon / MATE via gsettings
      const gsets = [
        ['org.gnome.desktop.background', 'picture-uri'],
        ['org.gnome.desktop.background', 'picture-uri-dark'],
        ['org.cinnamon.desktop.background', 'picture-uri'],
        ['org.mate.desktop.background', 'picture-filename'],
      ];
      for (const [schema, key] of gsets) {
        const out = await run('gsettings', ['get', schema, key]);
        if (out) {
          const val = out.trim().replace(/^'|'$/g, '');
          if (val && !val.includes('@as')) {
            const found = firstFile(val);
            if (found) return found;
          }
        }
      }
      // KDE Plasma: parse plasma config for the wallpaper Image=
      const kdeCfg = path.join(process.env.HOME || '', '.config', 'plasma-org.kde.plasma.desktop-appletsrc');
      try {
        const txt = fs.readFileSync(kdeCfg, 'utf8');
        const matches = [...txt.matchAll(/^Image=(.+)$/gm)].map((m) => m[1].trim());
        for (let i = matches.length - 1; i >= 0; i--) {
          const found = firstFile(matches[i].replace(/file:\/\/\/?/, '/'));
          if (found) return found;
        }
      } catch {}
      // XFCE
      const xf = await run('xfconf-query', ['-c', 'xfce4-desktop', '-l', '-v']);
      if (xf) {
        for (const line of xf.split('\n')) {
          const m = line.match(/\s(\/.+?\.(?:png|jpe?g|webp|bmp))\s*$/i);
          if (m) {
            const found = firstFile(m[1].trim());
            if (found) return found;
          }
        }
      }
      return null;
    }

    if (plat === 'darwin') {
      const out = await run('osascript', ['-e', 'tell application "System Events" to get picture of every desktop']);
      if (out) return firstFile(out.trim().split(',')[0].trim());
      return null;
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Linux system-audio capture: PulseAudio monitor source (works on PipeWire
// through pipewire-pulse). Streams s16le PCM chunks to the renderer.
// ---------------------------------------------------------------------------
let pulseProc = null;
let pulseSeq = 0;

async function startPulseCapture(win) {
  stopPulseCapture();
  const id = ++pulseSeq;

  // Prefer an explicit *.monitor source if we can find one.
  let device = null;
  const sources = await run('pactl', ['list', 'short', 'sources'], 3000);
  if (sources) {
    const lines = sources.split('\n').map((l) => l.split('\t'));
    const monitors = lines.filter((c) => c.length > 1 && /\.monitor\b/.test(c[1]));
    // The monitor of the default sink usually comes last; take the running one.
    const running = monitors.find((c) => c[c.length - 1] === 'RUNNING') || monitors[monitors.length - 1];
    if (running) device = running[1];
  }

  const args = ['--format=s16le', '--rate=44100', '--channels=2', '--raw', '--latency-msec=50'];
  if (device) args.push('--device=' + device);
  try {
    pulseProc = spawn('parec', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, error: 'Could not start parec. Install PulseAudio utils (or PipeWire\u2019s pulse compat): ' + err.message };
  }
  const proc = pulseProc;
  proc.stdout.on('data', (buf) => {
    if (!proc.killed && id === pulseSeq && win && !win.isDestroyed()) {
      win.webContents.send('capture:pcm', new Uint8Array(buf));
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('error', (err) => {
    if (id === pulseSeq) win && win.webContents.send('capture:error', String(err.message || err));
  });
  proc.on('close', () => { if (pulseProc === proc) pulseProc = null; });
  return { ok: true, device: device || 'default' };
}

function stopPulseCapture() {
  pulseSeq++;
  if (pulseProc) {
    try { pulseProc.kill(); } catch {}
    pulseProc = null;
  }
}

// ---------------------------------------------------------------------------
// Window & IPC
// ---------------------------------------------------------------------------
let mainWindow = null;
let previewBounds = null;

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    show,
    width: readConfig().settingsOnly ? 400 : 1280,
    height: 800,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#000000',
    title: 'Dynamic Visualizer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // keep analyzing (and feeding the wallpaper windows) while minimized
      backgroundThrottling: false,
    },
  });
  mainWindow.loadURL('app://bundle/src/index.html');
  const preview = mainWindow;
  const sendVisibility = () => {
    if (!preview.isDestroyed()) preview.webContents.send('window:visibility', preview.isVisible() && !preview.isMinimized());
  };
  for (const event of ['show', 'hide', 'minimize', 'restore']) preview.on(event, sendVisibility);
  // Closing the preview while wallpaper mode is running hides it to the tray
  // instead of quitting — the wallpaper (and its audio analysis) keep playing.
  mainWindow.on('close', (e) => {
    if (wallpaperActive && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows' occlusion tracker pauses rAF for covered/minimized windows —
  // fatal for a wallpaper app whose windows live behind the desktop.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerAppProtocol();
    // surface renderer errors (shader compiles, exceptions) in the main log
    app.on('web-contents-created', (_e, wc) => {
      wc.on('console-message', (e) => {
        if (e.level >= 2) console.log('[renderer]', e.message);
      });
    });
    // Allow microphone / loopback capture without prompts.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'audioCapture');
    });
    ensureTray();
    registerGameHotkey(); // Ctrl+Alt+D hides the wallpaper for gaming
    // restore wallpaper mode if it was left on, and honor tray-start
    const cfg = readConfig();
    // auto game mode defaults on: any fullscreen app hides the wallpaper
    if (cfg.autoGameMode === undefined) { cfg.autoGameMode = true; writeConfig(cfg); }
    if (cfg.autoGameMode) startAutoGameWatcher();
    // login launches pass --hidden: start in the tray regardless of startInTray
    // The preview owns audio capture and depth analysis even when its UI is
    // hidden. Create it before restoring wallpaper mode so tray/login startup
    // has a spectrum producer without requiring the user to open the window.
    createWindow({ show: !cfg.startInTray && !process.argv.includes('--hidden') });
    if (cfg.wallpaperMode) await enableWallpaperMode();
  });

  // With wallpaper mode active, closing the preview only hides it — the
  // wallpaper keeps playing and the app stays in the tray. Without wallpaper
  // mode there is nothing to keep running, so closing quits.
  // tray app: closing the last window never quits — Quit lives in the tray
  app.on('window-all-closed', () => {});
  app.on('activate', () => { if (!mainWindow) createWindow(); });
  app.on('before-quit', () => {
    if (globalShortcut) globalShortcut.unregisterAll();
    app.isQuitting = true;
    stopCursorBroadcast();
    stopPulseCapture();
    if (tray) { tray.destroy(); tray = null; }
  });
}

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  electron: process.versions.electron,
}));
ipcMain.handle('window:visible', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
});

ipcMain.handle('wallpaper:get', async () => {
  const p = await getWallpaperPath();
  if (!p) return { ok: false, path: null };
  return { ok: true, path: p, url: 'app://abs/' + encodePath(p) };
});

function encodePath(p) {
  // Keep slashes literal so the URL pathname can be split back into a path.
  return p.split(path.sep === '\\' ? /[\\/]/ : /\//).map(encodeURIComponent).join('/');
}

// Persist a dropped/pasted image (data URL) into userData so every window —
// including wallpaper windows, now and after restarts — can load it.
ipcMain.handle('image:saveDataUrl', async (_e, dataUrl) => {
  try {
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(String(dataUrl));
    if (!match) return null;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const dir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `image-${Date.now()}.${ext}`);
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    return { path: file, url: 'app://abs/' + encodePath(file) };
  } catch (err) {
    return null;
  }
});

const { RecentImages } = require('./recent-images.cjs');
let recentImages;
function imageHistory() {
  return recentImages ||= new RecentImages(path.join(app.getPath('userData'), 'recent-wallpapers'), p => 'app://abs/' + encodePath(p));
}
ipcMain.handle('images:recent', () => imageHistory().list());
ipcMain.handle('images:remember', async (event, url, thumb) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return [];
  if (typeof thumb !== 'string' || thumb.length > 100000 || !thumb.startsWith('data:image/jpeg;base64,')) return [];
  const parsed = new URL(url);
  if (parsed.protocol !== 'app:' || parsed.hostname !== 'abs') return [];
  const source = path.resolve(decodeURIComponent(parsed.pathname).replace(/^\//, ''));
  return imageHistory().add(source, thumb);
});
ipcMain.handle('window:settingsOnly', (event, enabled, expand) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof enabled !== 'boolean') return;
  const cfg = readConfig();
  if (cfg.settingsOnly === enabled) {
    if (!enabled && expand === true) mainWindow.setSize(1280, 800);
    return;
  }
  cfg.settingsOnly = enabled; writeConfig(cfg);
  if (enabled) {
    previewBounds = mainWindow.getBounds();
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(400, Math.max(480, Math.min(previewBounds.height, screen.getDisplayMatching(previewBounds).workArea.height)));
  } else if (previewBounds) mainWindow.setBounds(previewBounds);
  else mainWindow.setSize(1280, 800);
});

ipcMain.handle('image:choose', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  return { path: p, url: 'app://abs/' + encodePath(p) };
});

ipcMain.handle('audio:chooseFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an audio file',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  return { path: p, url: 'app://abs/' + encodePath(p) };
});

ipcMain.handle('capture:startPulse', async () => startPulseCapture(mainWindow));
ipcMain.handle('capture:stopPulse', () => { stopPulseCapture(); return { ok: true }; });

// ---------------------------------------------------------------------------
// Wallpaper mode: a fullscreen, click-through window that lives behind the
// desktop icons so the visualizer behaves like the OS wallpaper.
//   Windows: parent the window to the WorkerW layer (Progman 0x052C trick)
//   Linux/X11: best-effort _NET_WM_WINDOW_TYPE_DESKTOP via xprop + wmctrl
// ---------------------------------------------------------------------------
let wallpaperWins = [];
let cursorTimer = null;

/** Feed the global cursor position to wallpaper windows so the wallpaper
 *  subtly parallaxes with the mouse (they're click-through, so they get no
 *  pointer events of their own). Normalized per window to -1..1. */
function startCursorBroadcast() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!wallpaperWins.length) return;
    const pt = screen.getCursorScreenPoint();
    for (const win of wallpaperWins) {
      if (win.isDestroyed()) continue;
      try {
        const b = win.getBounds();
        const nx = Math.max(-1, Math.min(1, ((pt.x - b.x) / b.width) * 2 - 1));
        const ny = Math.max(-1, Math.min(1, ((pt.y - b.y) / b.height) * 2 - 1));
        win.webContents.send('cursor', { nx, ny });
      } catch { /* window tearing down between the check and the send */ }
    }
  }, 33);
}

function stopCursorBroadcast() {
  if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
}
let tray = null;
let psBlockerId = null;
let wallpaperActive = false;

function virtualBounds() {
  const displays = screen.getAllDisplays();
  const acc = displays.reduce((a, d) => ({
    x: Math.min(a.x, d.bounds.x),
    y: Math.min(a.y, d.bounds.y),
    r: Math.max(a.r, d.bounds.x + d.bounds.width),
    b: Math.max(a.b, d.bounds.y + d.bounds.height),
  }), { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity });
  return { x: acc.x, y: acc.y, width: acc.r - acc.x, height: acc.b - acc.y };
}

/** Renders a small filled-circle PNG so the tray needs no bundled asset. */
function makeTrayIcon() {
  const S = 32;
  const raw = Buffer.alloc(S * (1 + S * 4));
  const cx = (S - 1) / 2, cy = (S - 1) / 2, radius = S * 0.38;
  for (let y = 0; y < S; y++) {
    const rowStart = y * (1 + S * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = d <= radius ? 255 : d <= radius + 1.2 ? Math.round(255 * (radius + 1.2 - d) / 1.2) : 0;
      const o = rowStart + 1 + x * 4;
      raw[o] = 110; raw[o + 1] = 168; raw[o + 2] = 255; raw[o + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function ensureTray() {
  if (tray) { refreshTrayMenu(); return; }
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Dynamic Visualizer');
  tray.on('click', () => showPreview());
  refreshTrayMenu();
}

// ----------------------------------------------------------------- config
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function writeConfig(cfg) { try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch {} }

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const LOGIN_VALUE = 'Dynamic Visualizer';
function setLoginItem(enable) {
  if (process.platform !== 'win32') {
    try { app.setLoginItemSettings({ openAtLogin: !!enable }); } catch {}
    return;
  }
  // Electron's setLoginItemSettings silently drops the registry write when
  // path/args are passed, and its plain call can't launch the app in dev —
  // manage the Run key directly. Dev needs the app dir as electron.exe's
  // first argument; packaged builds launch their own exe.
  const cmd = `"${process.execPath}"${app.isPackaged ? '' : ` "${PROJECT_ROOT}"`} --hidden`;
  const regArgs = enable
    ? ['add', RUN_KEY, '/v', LOGIN_VALUE, '/t', 'REG_SZ', '/d', cmd, '/f']
    : ['delete', RUN_KEY, '/v', LOGIN_VALUE, '/f'];
  run('reg', regArgs, 4000);
}

let gameMode = false;
function setGameMode(on) {
  console.log('[gamemode]', on ? 'ON' : 'off');
  gameMode = on;
  for (const win of wallpaperWins) {
    if (win.isDestroyed()) continue;
    if (on) win.hide(); else win.showInactive();
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('gamemode', on);
  }
  refreshTrayMenu();
}

function registerGameHotkey() {
  try { globalShortcut.register('CommandOrControl+Alt+D', () => setGameMode(!gameMode)); } catch {}
}
ipcMain.handle('gamemode:state', () => gameMode);

// ---------------------------------------------------------- auto game mode
// While enabled, watch the foreground window: when a normal app covers an
// entire monitor (borderless or exclusive fullscreen), enter game mode; when
// it leaves, bring the wallpaper back. The manual hotkey still works — the
// watcher only reacts to *changes* in fullscreen state, it never fights a
// manual toggle until the fullscreen state itself changes.

const SHELL_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
]);

let dwmIsCloaked = undefined;
function dwmWindowCloaked(hwnd) {
  if (dwmIsCloaked === undefined) {
    try {
      const dwm = koffi.load('dwmapi.dll');
      const fn = dwm.func('int32 __stdcall DwmGetWindowAttribute(intptr_t h, uint attr, void *val, uint cb)');
      dwmIsCloaked = (h) => {
        try {
          const val = Buffer.alloc(4);
          return fn(h, 14 /* DWMWA_CLOAKED */, val, 4) === 0 && val.readUInt32LE(0) !== 0;
        } catch { return false; }
      };
    } catch { dwmIsCloaked = null; }
  }
  return dwmIsCloaked ? dwmIsCloaked(hwnd) : false;
}

/** True when the foreground window is a real app covering an entire monitor.
 *  Excludes our own windows, the desktop/shell and cloaked UWP hosts. */
function isFullscreenAppForeground() {
  if (process.platform !== 'win32') return false;
  const w = getWin32();
  const hwnd = w.GetForegroundWindow();
  if (!hwnd) return false;

  const pid = Buffer.alloc(4);
  w.GetWindowThreadProcessId(hwnd, pid);
  if (pid.readUInt32LE(0) === process.pid) return false; // our preview/wallpaper windows
  if (w.IsIconic(hwnd)) return false;

  const clsBuf = Buffer.alloc(512);
  w.GetClassNameW(hwnd, clsBuf, 256);
  if (SHELL_CLASSES.has(clsBuf.toString('utf16le').split('\0')[0])) return false;

  // suspended UWP apps keep a cloaked window in the foreground
  if (dwmWindowCloaked(hwnd)) return false;

  // small overlay/tool windows never count, even at monitor size
  const WS_EX_TOOLWINDOW = 0x00000080n;
  const ex = w.GetWindowLongPtrW(hwnd, -20 /* GWL_EXSTYLE */);
  if ((typeof ex === 'bigint' ? ex : BigInt(Math.round(Number(ex)))) & WS_EX_TOOLWINDOW) return false;

  const r = { L: 0, T: 0, R: 0, B: 0 };
  if (!w.GetWindowRect(hwnd, r)) return false;
  const hmon = w.MonitorFromWindow(hwnd, 2 /* MONITOR_DEFAULTTONEAREST */);
  if (!hmon) return false;
  // MONITORINFO layout: cbSize, rcMonitor (4×int32), rcWork (4×int32), dwFlags
  const mi = Buffer.alloc(40);
  mi.writeUInt32LE(40, 0);
  if (!w.GetMonitorInfoW(hmon, mi)) return false;
  const mL = mi.readInt32LE(4), mT = mi.readInt32LE(8), mR = mi.readInt32LE(12), mB = mi.readInt32LE(16);
  // 1px tolerance absorbs rounding on scaled displays
  return Math.abs(r.L - mL) <= 1 && Math.abs(r.T - mT) <= 1 &&
         Math.abs(r.R - mR) <= 1 && Math.abs(r.B - mB) <= 1;
}

let autoGameTimer = null;
let autoPrevFullscreen = null; // last raw reading — act only on changes

function startAutoGameWatcher() {
  if (autoGameTimer || process.platform !== 'win32' || !koffi) return;
  autoPrevFullscreen = null;
  autoGameTimer = setInterval(() => {
    let fs = false;
    try { fs = isFullscreenAppForeground(); } catch {}
    if (autoPrevFullscreen !== null && fs !== autoPrevFullscreen) setGameMode(fs);
    autoPrevFullscreen = fs;
  }, 1000);
}

function stopAutoGameWatcher() {
  if (autoGameTimer) { clearInterval(autoGameTimer); autoGameTimer = null; }
  autoPrevFullscreen = null;
}

function setAutoGameEnabled(on) {
  const cfg = readConfig();
  cfg.autoGameMode = !!on;
  writeConfig(cfg);
  if (cfg.autoGameMode) startAutoGameWatcher(); else stopAutoGameWatcher();
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Dynamic Visualizer', click: () => showPreview() },
    {
      label: wallpaperActive ? 'Stop wallpaper mode' : 'Start wallpaper mode',
      click: () => (wallpaperActive ? disableWallpaperMode() : enableWallpaperMode()),
    },
    { label: gameMode ? 'Resume visualiser' : 'Pause visualiser (hide wallpaper)', click: () => setGameMode(!gameMode) },
    { label: 'Auto pause for fullscreen apps', type: 'checkbox', checked: !!readConfig().autoGameMode, click: () => setAutoGameEnabled(!readConfig().autoGameMode) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function showPreview() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function broadcastWallpaperState() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('wallpaperMode:changed', wallpaperActive);
  }
}


async function runX11DesktopHints(xid) {
  // best-effort: mark as desktop-type window on EWMH-compliant WMs (X11 only)
  const steps = [
    ['wmctrl', ['-i', '-r', String(xid), '-b', 'add,below']],
    ['wmctrl', ['-i', '-r', String(xid), '-b', 'add,sticky']],
    ['xprop', ['-id', String(xid), '-f', '_NET_WM_WINDOW_TYPE', '32a', '-set', '_NET_WM_WINDOW_TYPE', '_NET_WM_WINDOW_TYPE_DESKTOP']],
  ];
  for (const [cmd, args] of steps) await run(cmd, args, 3000);
  return true;
}

// Windows-only native calls for wallpaper mode. Done in-process (koffi) so we
// may change the window style (popup -> child) of our own window — calling
// SetParent cross-process on an Electron window is refused (ERROR 87).
let koffi = null;
try { koffi = require('koffi'); } catch {}

// One-time native binding setup (koffi keeps a global type registry, so the
// struct must only be declared once per process).
let win32 = null;
function getWin32() {
  if (win32) return win32;
  if (!koffi) throw new Error('koffi unavailable — cannot enter wallpaper mode');
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('DvRect', { L: 'int32_t', T: 'int32_t', R: 'int32_t', B: 'int32_t' });
  win32 = {
    user32,
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
    FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)'),
    SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t h, uint msg, intptr_t wp, intptr_t lp, uint flags, uint timeout, void *result)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t h, int i)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t h, int i, intptr_t v)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t h, _Out_ DvRect *r)'),
    GetClientRect: user32.func('bool __stdcall GetClientRect(intptr_t h, _Out_ DvRect *r)'),
    // auto game mode: fullscreen detection
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t h)'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t h, void *pid)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t h, void *buf, int maxCount)'),
    MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t h, uint flags)'),
    // MONITORINFO goes through a raw Buffer: koffi zeroes _Out_ structs, and
    // GetMonitorInfoW rejects them because cbSize must be set by the caller
    GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t hmon, void *mi)'),
    // NB: SetParent returns the previous parent HWND (NULL on failure or when
    // there was none) — it is NOT a bool. Success is verified via GetAncestor.
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t h, uint flags)'),
    SetWindowPos: user32.func('int __stdcall SetWindowPos(intptr_t h, intptr_t after, int x, int y, int cx, int cy, uint flags)'),
    GetWindowDpiAwarenessContext: user32.func('intptr_t __stdcall GetWindowDpiAwarenessContext(intptr_t h)'),
    SetThreadDpiAwarenessContext: user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t ctx)'),
  };
  return win32;
}

async function win32ParentToWorkerW(hwnd, displayBounds) {
  const {
    FindWindowW, FindWindowExW, SendMessageTimeoutW,
    GetWindowLongPtrW, SetWindowLongPtrW, GetWindowRect, GetClientRect,
    SetParent, GetAncestor, SetWindowPos,
    GetWindowDpiAwarenessContext, SetThreadDpiAwarenessContext,
  } = getWin32();
  const SMTO_ABORTIFHUNG = 0x0002;

  // Ask Progman to spawn the wallpaper WorkerW layer (behind the desktop icons)
  const progman = FindWindowW('Progman', null);
  if (!progman) throw new Error('Progman window not found');
  // Explorer may take the entire timeout: never block the app's main thread.
  await new Promise((resolve, reject) => SendMessageTimeoutW.async(
    progman, 0x052C, 0n, 0n, SMTO_ABORTIFHUNG, 1000, Buffer.alloc(8),
    (err, result) => err ? reject(err) : resolve(result)));

  // Locate the desktop-icon layer (SHELLDLL_DefView). Classic builds: it lives
  // in a WorkerW and 0x052C spawns a second WorkerW for the wallpaper. Some
  // 24H2+ builds never spawn it — then we parent into Progman itself as a
  // sibling placed just below the icon layer.
  let workerWithIcons = 0n;
  let iconDefView = 0n;
  let worker = 0n;
  for (;;) {
    worker = FindWindowExW(0n, worker, 'WorkerW', null);
    if (!worker) break;
    const dv = FindWindowExW(worker, 0n, 'SHELLDLL_DefView', null);
    if (dv) { workerWithIcons = worker; iconDefView = dv; break; }
  }

  let parent = 0n;
  let insertAfter = 0n;
  if (workerWithIcons) {
    const wallpaperLayer = FindWindowExW(0n, workerWithIcons, 'WorkerW', null);
    if (wallpaperLayer) {
      parent = wallpaperLayer;             // classic: dedicated layer
    } else {
      parent = workerWithIcons;            // same layer, directly below icons
      insertAfter = iconDefView;
    }
  } else {
    const dv = FindWindowExW(progman, 0n, 'SHELLDLL_DefView', null);
    if (!dv) throw new Error('could not locate the desktop icon layer');
    parent = progman;
    insertAfter = dv;
  }

  const GWL_STYLE = -16;
  const WS_POPUP = 0x80000000n;
  const WS_CHILD = 0x40000000n;
  const toBig = (v) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v))));
  const style = toBig(GetWindowLongPtrW(hwnd, GWL_STYLE));
  SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt.asIntN(64, (style & ~WS_POPUP) | WS_CHILD));

  // try thread DPI contexts: the desktop layer's own, then the usual constants
  const attempts = [GetWindowDpiAwarenessContext(parent), -2n, -3n, -4n];
  const prevCtx = SetThreadDpiAwarenessContext(toBig(attempts[0]));
  let parented = false;
  let lastCtx = prevCtx;
  try {
    for (const ctx of attempts) {
      if (!ctx) continue;
      lastCtx = SetThreadDpiAwarenessContext(toBig(ctx));
      SetParent(hwnd, parent);
      if (toBig(GetAncestor(hwnd, 1 /* GA_PARENT */)) === toBig(parent)) { parented = true; break; }
    }
  } finally {
    SetThreadDpiAwarenessContext(lastCtx);
    SetThreadDpiAwarenessContext(prevCtx);
  }

  if (!parented) {
    // reparenting refused — revert the style change
    SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt.asIntN(64, style));
    throw new Error('SetParent refused by the system');
  }

  // Position the child to exactly cover this display. The parent (Explorer's
  // desktop layer) is system-DPI-aware while we are per-monitor-aware, so its
  // client coordinates are scaled: convert via the physical/client ratio.
  const pr = { L: 0, T: 0, R: 0, B: 0 };
  const cr = { L: 0, T: 0, R: 0, B: 0 };
  GetWindowRect(parent, pr);
  GetClientRect(parent, cr);
  const sx = (pr.R - pr.L) / Math.max(1, cr.R - cr.L);
  const sy = (pr.B - pr.T) / Math.max(1, cr.B - cr.T);
  const cx = Math.round((displayBounds.x - pr.L) / sx);
  const cy = Math.round((displayBounds.y - pr.T) / sy);
  const cw = Math.round(displayBounds.width / sx);
  const ch = Math.round(displayBounds.height / sy);

  if (insertAfter) {
    // sibling mode: sit directly below the icon layer in z-order
    SetWindowPos(hwnd, insertAfter, cx, cy, cw, ch, 0x0010); // NOACTIVATE
  } else {
    SetWindowPos(hwnd, 0n, cx, cy, cw, ch, 0x0014); // NOZORDER | NOACTIVATE
  }
  const fr = { L: 0, T: 0, R: 0, B: 0 };
  GetWindowRect(hwnd, fr);
  console.log(`[wallpaper] parented hwnd=0x${toBig(hwnd).toString(16)} parent=0x${toBig(parent).toString(16)} ` +
    `parentRect=(${pr.L},${pr.T})-(${pr.R},${pr.B}) client=(${cr.R - cr.L}x${cr.B - cr.T}) scale=(${sx.toFixed(2)},${sy.toFixed(2)}) ` +
    `display=(${displayBounds.x},${displayBounds.y} ${displayBounds.width}x${displayBounds.height}) finalRect=(${fr.L},${fr.T})-(${fr.R},${fr.B})`);
  return true;
}

function win32DesktopPlacement(hwnd, displayBounds) {
  // As a child of the desktop layer, coordinates are relative to the layer's
  // client origin = the virtual-screen origin (SM_X/YVIRTUALSCREEN).
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int i)');
  const vx = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
  const vy = GetSystemMetrics(77); // SM_YVIRTUALSCREEN
  SetWindowPos(hwnd, 0n, displayBounds.x - vx, displayBounds.y - vy,
    displayBounds.width, displayBounds.height, 0x0014); // NOZORDER | NOACTIVATE
}

let enablePromise = null;
function enableWallpaperMode() {
  if (wallpaperWins.length) return Promise.resolve({ ok: true });
  if (enablePromise) return enablePromise; // a click while enabling just waits
  enablePromise = doEnableWallpaperMode().finally(() => { enablePromise = null; });
  return enablePromise;
}

async function doEnableWallpaperMode() {
  const created = [];
  try {
    // main-monitor-only: the other displays keep the OS wallpaper — every
    // animated window costs render time AND a DWM recomposition per frame
    const displays = readConfig().wallpaperPrimaryOnly
      ? [screen.getPrimaryDisplay()]
      : screen.getAllDisplays();
    for (const display of displays) {
      const b = display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, hasShadow: false, roundedCorners: false,
        skipTaskbar: true, resizable: false, movable: false,
        show: false, backgroundColor: '#000000',
        title: 'Dynamic Visualizer — Wallpaper',
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,   // keep animating behind the icons
        },
      });
      created.push(win);
      win.setIgnoreMouseEvents(true); // clicks pass through: it *is* the desktop
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.loadURL('app://bundle/src/index.html?wallpaper=1' + (created.length === 0 ? '&primary=1' : ''));
      });
      // show first — SetParent on a hidden window can be refused by win32
      win.showInactive();

      if (process.platform === 'win32') {
        const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
        await win32ParentToWorkerW(hwnd, b);
      } else if (process.platform === 'linux') {
        const xid = win.getNativeWindowHandle().readUInt32LE(0);
        await runX11DesktopHints(xid);
      }
      if (gameMode) win.hide();

      win.on('closed', () => {
        console.log('[wallpaper] window closed');
        wallpaperWins = wallpaperWins.filter((w) => w !== win && !w.isDestroyed());
        if (wallpaperActive && wallpaperWins.length === 0) {
          // closed from outside (e.g. taskkill of the window)
          wallpaperActive = false;
          if (psBlockerId !== null) { powerSaveBlocker.stop(psBlockerId); psBlockerId = null; }
          stopCursorBroadcast();
          refreshTrayMenu();
          broadcastWallpaperState();
        }
      });
    }

    wallpaperWins = created;
    wallpaperActive = true;
    const cfg = readConfig(); cfg.wallpaperMode = true; writeConfig(cfg);
    psBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    ensureTray();
    startCursorBroadcast();
    broadcastWallpaperState();
    return { ok: true };
  } catch (err) {
    for (const win of created) {
      if (!win.isDestroyed()) win.destroy();
    }
    wallpaperWins = [];
    return { ok: false, error: err.message || String(err) };
  }
}

function disableWallpaperMode() {
  // Mark the stop before destroying windows: their synchronous closed events
  // must not treat an intentional stop as an unexpected last-window closure.
  wallpaperActive = false;
  const stopped = wallpaperWins;
  wallpaperWins = [];
  for (const win of stopped) {
    if (!win.isDestroyed()) win.destroy();
  }
  const cfg = readConfig(); cfg.wallpaperMode = false; writeConfig(cfg);
  stopCursorBroadcast();
  if (psBlockerId !== null) { powerSaveBlocker.stop(psBlockerId); psBlockerId = null; }
  refreshTrayMenu();
  broadcastWallpaperState();
}

ipcMain.handle('wallpaperMode:enable', () => enableWallpaperMode());
ipcMain.handle('wallpaperMode:disable', () => { disableWallpaperMode(); return { ok: true }; });
ipcMain.handle('wallpaperMode:state', () => wallpaperActive);

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_e, patch) => {
    console.log('[config] set', JSON.stringify(patch));
    const cfg = { ...readConfig(), ...patch };
    writeConfig(cfg);
    if (typeof patch.launchAtStartup === 'boolean') setLoginItem(patch.launchAtStartup);
    if (typeof patch.autoGameMode === 'boolean') setAutoGameEnabled(patch.autoGameMode);
    // the wallpaper layout depends on this setting — rebuild it live
    if (typeof patch.wallpaperPrimaryOnly === 'boolean' && wallpaperActive) {
      disableWallpaperMode();
      enableWallpaperMode();
    }
    return cfg;
  });

// The preview window is the single audio capture source; its analysis is
// relayed to every wallpaper window (secondary loopback captures come back
// silent on Windows, so per-window capture is not viable).
ipcMain.on('spectrum', (event, bands, energy, loud) => {
  if (!wallpaperWins.length) return;
  for (const win of wallpaperWins) {
    if (!win.isDestroyed() && win.webContents !== event.sender) {
      win.webContents.send('spectrum', bands, energy, loud);
    }
  }
});

// Same idea for depth grids: the preview runs the (heavy) depth estimate once
// and every wallpaper window reuses the result instead of loading its own
// AI runtime.
ipcMain.on('depthgrid', (event, payload) => {
  if (!wallpaperWins.length) return;
  for (const win of wallpaperWins) {
    if (!win.isDestroyed() && win.webContents !== event.sender) {
      win.webContents.send('depthgrid', payload);
    }
  }
});

// A wallpaper window asks for the current depth grid when it spins up (it
// boots after the preview already estimated, so the original broadcast
// missed it). Forward the ask to the preview — the only window running the
// AI model — which replies with a fresh 'depthgrid'.
ipcMain.on('depthgrid:request', (event) => {
  const sender = event.sender;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== sender && !wallpaperWins.includes(win)) {
      win.webContents.send('depthgrid:send');
    }
  }
});
