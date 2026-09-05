// Central settings store with persistence. Everything the UI touches lives here.
const DEFAULTS = {
  imageUrl: null,          // explicit image (blob or app:// URL); null = try wallpaper, then procedural
  depthMode: 'auto',       // 'auto' (heuristic) | 'onnx' | 'flat'
  depthScale: 0.35,
  pointCount: 160000,
  pointSize: 1.0,
  glow: 1.1,
  boost: 1.0,
  waveMode: 'ripple',      // 'wave' | 'ripple' | 'bands' | 'drift'
  bandMap: 'radial',       // which region reacts to which bands: 'depth' | 'radial' | 'vertical' | 'horizontal'
  intensity: 1.0,
  depthMove: 1.0,          // Z motion multiplier (toward/away from viewer)
  xyMove: 1.0,             // lateral motion multiplier (x/y shimmer + swell)
  bands: 64,               // number of frequency bands = number of regions
  invertBands: false,      // flip band direction: bass toward viewer / far side
  overscan: 1.0,           // extra zoom so parallax never reveals edges
  overscanAuto: true,      // overscan follows the parallax setting
  hideBackdrop: false,     // black background while particles are on screen
  flybyExit: false,        // idle exit: points rush the camera instead of a clean fade
  cursorRipple: true,      // particles swell around the mouse cursor
  sensGain: 1.0,           // input gain: how strongly sound drives everything
  sensFloor: 0.0,          // noise floor: below this level, no movement
  sensCurve: 1.5,          // response gamma: higher = quiet sounds move less
  speedVol: 1.0,           // how much volume speeds up the motion (0 = fixed)
  parallax: 0.8,
  musicParallax: 0,        // camera sway driven by the music itself (0 = off)
  audioSource: 'demo',     // 'system' | 'mic' | 'file' | 'demo'
  audioFileUrl: null,
  fpsCap: 30,              // 30 | 24 | 60 | 0 (uncapped)
  autoQuality: true,
  idleSleep: true,
};

const KEY = 'dv.settings.v1';

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return { ...DEFAULTS, ...saved };
}

const settings = load();
const listeners = new Set();

export function get(key) { return settings[key]; }
export function getAll() { return { ...settings }; }

export function set(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (settings[k] !== v) { settings[k] = v; changed = true; }
  }
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
    for (const fn of listeners) fn(settings, patch);
  }
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Multi-window sync: the wallpaper window mirrors settings changed in the
// preview window (storage event, plus a poll as a safety net).
function resync() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const patch = {};
  for (const [k, v] of Object.entries(saved)) {
    if (settings[k] !== v) { settings[k] = v; patch[k] = v; }
  }
  if (Object.keys(patch).length) for (const fn of listeners) fn(settings, patch);
}
window.addEventListener('storage', (e) => { if (e.key === KEY) resync(); });
setInterval(resync, 2000);
