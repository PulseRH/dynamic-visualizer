// Standalone harness for the auto-game-mode fullscreen detection logic that
// lives in electron/main.cjs (isFullscreenAppForeground). Run with plain node:
//   node tools/fullscreen-detect-harness.cjs [seconds]
// Polls once per second and prints each reading so a real fullscreen window
// can be opened (or spawned via tools/fullscreen-flash.ps1) to verify.
'use strict';
const path = require('path');
const koffi = require(path.join(__dirname, '..', 'node_modules', 'koffi'));

const user32 = koffi.load('user32.dll');
koffi.struct('DvRect', { L: 'int32_t', T: 'int32_t', R: 'int32_t', B: 'int32_t' });
koffi.struct('DvMonitorInfo', { cbSize: 'uint32_t', rcMonitor: 'DvRect', rcWork: 'DvRect', dwFlags: 'uint32_t' });

const w = {
  GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
  IsIconic: user32.func('bool __stdcall IsIconic(intptr_t h)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t h, void *pid)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t h, void *buf, int maxCount)'),
  MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t h, uint flags)'),
  GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t hmon, void *mi)'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t h, _Out_ DvRect *r)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t h, int i)'),
};

const dwm = koffi.load('dwmapi.dll');
const dwmGet = dwm.func('int32 __stdcall DwmGetWindowAttribute(intptr_t h, uint attr, void *val, uint cb)');

const SHELL_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
]);

// mirrors isFullscreenAppForeground() in electron/main.cjs
function detect() {
  const hwnd = w.GetForegroundWindow();
  if (!hwnd) return { fs: false, why: 'no foreground window' };

  const pid = Buffer.alloc(4);
  w.GetWindowThreadProcessId(hwnd, pid);
  if (pid.readUInt32LE(0) === process.pid) return { fs: false, why: 'own process' };
  if (w.IsIconic(hwnd)) return { fs: false, why: 'minimized' };

  const clsBuf = Buffer.alloc(512);
  w.GetClassNameW(hwnd, clsBuf, 256);
  const cls = clsBuf.toString('utf16le').split('\0')[0];
  if (SHELL_CLASSES.has(cls)) return { fs: false, why: `shell class ${cls}` };

  const cloaked = Buffer.alloc(4);
  const isCloaked = dwmGet(hwnd, 14, cloaked, 4) === 0 && cloaked.readUInt32LE(0) !== 0;
  if (isCloaked) return { fs: false, why: `cloaked ${cls}` };

  const ex = w.GetWindowLongPtrW(hwnd, -20);
  if ((typeof ex === 'bigint' ? ex : BigInt(Math.round(Number(ex)))) & 0x80n) {
    return { fs: false, why: `toolwindow ${cls}` };
  }

  const r = { L: 0, T: 0, R: 0, B: 0 };
  if (!w.GetWindowRect(hwnd, r)) return { fs: false, why: 'no rect' };
  const hmon = w.MonitorFromWindow(hwnd, 2);
  if (!hmon) return { fs: false, why: 'no monitor' };
  const mi = Buffer.alloc(40);
  mi.writeUInt32LE(40, 0);
  if (!w.GetMonitorInfoW(hmon, mi)) return { fs: false, why: 'no monitorinfo' };
  const m = { L: mi.readInt32LE(4), T: mi.readInt32LE(8), R: mi.readInt32LE(12), B: mi.readInt32LE(16) };
  const fs = Math.abs(r.L - m.L) <= 1 && Math.abs(r.T - m.T) <= 1 &&
             Math.abs(r.R - m.R) <= 1 && Math.abs(r.B - m.B) <= 1;
  return {
    fs,
    why: `cls=${cls} pid=${pid.readUInt32LE(0)} win=(${r.L},${r.T})-(${r.R},${r.B}) mon=(${m.L},${m.T})-(${m.R},${m.B})`,
  };
}

const secs = Number(process.argv[2] || 6);

// ---- `flash` mode: spawn a CHILD process with a borderless window covering
// the monitor (the child is a separate process, so the own-process exclusion
// doesn't hide it), force it to the foreground via AttachThreadInput, and
// verify detect() flips to true while it is up and false after it closes.
if (process.argv[2] === 'flash') {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [__filename, 'probe-win'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const results = [];
  const poll = () => { const d = detect(); results.push(d.fs); console.log(`fullscreen=${d.fs}  ${d.why}`); };

  setTimeout(() => { // give the child time to create + foreground the window
    poll();
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - t0 < 2400) { poll(); return; }
      clearInterval(timer);
      child.kill(); // kill the child: its window dies with the process
      setTimeout(() => {
        poll();
        // a real app can legitimately steal focus mid-test — at least one
        // true reading while up + false after close proves the detection
        const up = results.slice(0, -1);
        const ok = up.some(Boolean) && !results[results.length - 1];
        console.log(`\nverdict: while probe up = [${up.join(',')}], after close = ${results[results.length - 1]} -> ${ok ? 'PASS' : 'FAIL'}`);
        process.exit(ok ? 0 : 1);
      }, 800);
    }, 400);
  }, 1200);
  return;
}

// ---- `probe-win` mode: show a monitor-sized borderless window until stdin
// closes (or 15s), then destroy it.
if (process.argv[2] === 'probe-win') {
  koffi.struct('WndClassW', {
    style: 'uint32_t', lpfnWndProc: 'void *', cbClsExtra: 'int32_t', cbWndExtra: 'int32_t',
    hInstance: 'void *', hIcon: 'void *', hCursor: 'void *', hbrBackground: 'void *',
    lpszMenuName: 'void *', lpszClassName: 'void *',
  });
  const kernel32 = koffi.load('kernel32.dll');
  const n = {
    GetModuleHandleW: kernel32.func('intptr_t __stdcall GetModuleHandleW(str16 name)'),
    GetProcAddress: kernel32.func('intptr_t __stdcall GetProcAddress(intptr_t mod, str name)'),
    RegisterClassW: user32.func('uint16 __stdcall RegisterClassW(_In_ WndClassW *wc)'),
    CreateWindowExW: user32.func('intptr_t __stdcall CreateWindowExW(uint ex, str16 cls, str16 title, uint style, int x, int y, int w, int h, intptr_t parent, intptr_t menu, intptr_t inst, void *param)'),
    DestroyWindow: user32.func('bool __stdcall DestroyWindow(intptr_t h)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t h, int cmd)'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t h)'),
    GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
    AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32 a, uint32 b, bool attach)'),
    GetDesktopWindow: user32.func('intptr_t __stdcall GetDesktopWindow()'),
  };

  const clsName = 'DvFullscreenProbe';
  const clsBuf = Buffer.from(clsName + '\0', 'utf16le');
  const defProc = n.GetProcAddress(n.GetModuleHandleW('user32.dll'), 'DefWindowProcW');
  const wc = {
    style: 0, lpfnWndProc: defProc, cbClsExtra: 0, cbWndExtra: 0,
    hInstance: n.GetModuleHandleW(null), hIcon: null, hCursor: null,
    hbrBackground: 1n /* (HBRUSH)(COLOR_BACKGROUND+1): paint black, not white */,
    lpszMenuName: null, lpszClassName: clsBuf,
  };
  const atom = n.RegisterClassW(wc);
  if (!atom) { console.log('RegisterClassW failed'); process.exit(1); }
  // size from GetMonitorInfoW — the same API/space the detector reads
  // (GetSystemMetrics is DPI-virtualized and can disagree in plain node.exe)
  const deskMon = w.MonitorFromWindow(n.GetDesktopWindow(), 1 /* MONITOR_DEFAULTTOPRIMARY */);
  const deskMi = Buffer.alloc(40);
  deskMi.writeUInt32LE(40, 0);
  if (!w.GetMonitorInfoW(deskMon, deskMi)) { console.log('GetMonitorInfoW failed'); process.exit(1); }
  const mL = deskMi.readInt32LE(4), mT = deskMi.readInt32LE(8);
  const mW = deskMi.readInt32LE(12) - mL, mH = deskMi.readInt32LE(16) - mT;
  const hwnd = n.CreateWindowExW(0, clsName, 'probe', 0x80000000 /* WS_POPUP */,
    mL, mT, mW, mH, 0n, 0n, 0n, null);
  if (!hwnd) { console.log('CreateWindowExW failed'); process.exit(1); }
  n.ShowWindow(hwnd, 5 /* SW_SHOW */);
  // steal focus: attach our input queue to the current foreground thread
  const focusSteal = () => {
    const fg = w.GetForegroundWindow();
    const fgPid = Buffer.alloc(4);
    const fgThread = w.GetWindowThreadProcessId(fg, fgPid);
    const attached = n.AttachThreadInput(fgThread, n.GetCurrentThreadId(), true);
    n.SetForegroundWindow(hwnd);
    if (attached) n.AttachThreadInput(fgThread, n.GetCurrentThreadId(), false);
  };
  focusSteal();
  const hold = setInterval(focusSteal, 400); // keep re-asserting while up

  const done = () => { clearInterval(hold); try { n.DestroyWindow(hwnd); } catch {} process.exit(0); };
  process.stdin.on('end', done);
  setTimeout(done, 15000);
  return;
}

console.log(`polling foreground window for ${secs}s...`);
const t0 = Date.now();
let n = 0;
const timer = setInterval(() => {
  const { fs, why } = detect();
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  fullscreen=${fs}  ${why}`);
  if (++n >= secs * 2) { clearInterval(timer); process.exit(0); }
}, 500);
