// Central settings store with persistence. Everything the UI touches lives here.
export const DEFAULTS = {
  imageUrl: null,          // explicit image (blob or app:// URL); null = try wallpaper, then procedural
  depthMode: 'auto',       // 'auto' | 'onnx' (small) | 'onnx-base' | 'flat'
  depthScale: 0.35,
  depthShape: 0,           // compress background spacing, expand foreground spacing
  gapFill: 0,              // bounded same-surface infill, generated during cloud rebuild
  gapFillDensity: 12,      // samples along each bridge row
  gapFillRows: 3,
  gapFillSpread: .8,       // total row width in original point spacings
  gapFillBrightness: .35,  // independent additive fill brightness
  gapFillOnlyOpen: true,   // hide extra seam density when neighbours sit together
  gapFillAdaptive: 1,      // 0 constant fill -> 1 strict matching to opening width
  gapFillDepthLimit: .06,  // maximum nearness difference allowed across a bridge
  depthShading: 0,         // dim distant surfaces while retaining foreground highlights
  pointCount: 160000,
  pointSize: 1.0,
  glow: 1.1,
  boost: 1.0,              // Light pulse: extra per-band brightness (saved key retained)
  lightFollowMotion: false, // shape extra audio light with active spatial layers
  sizePulse: 1.0,          // independent per-band point growth; 1 = up to 90% larger
  vibrancyPulse: 0,        // per-band saturation lift, preserving source luminance
  motionWave: 0,
  motionRipple: 0,
  motionBands: 0,
  motionDrift: 0,
  motionSwirl: 0,
  swirlRangeVersion: 1,   // maximum reduced to the original 28% strength
  motionBreathe: 0,
  motionSweep: 0,
  motionBandShake: 0,     // coherent XY translation for each mapped audio band
  preserveBoostColor: true, // soften extra audio light while retaining the original base glow
  matchImageAccent: true,   // UI accent sampled once when the image changes; off = purple
  hueReaction: 0,          // signed maximum per-band colour rotation in degrees
  hueCycle: 0,             // audio-driven per-band hue oscillation in both directions
  hueFocus: 1,             // 0 = broad colour accents, 1 = only standout band changes
  waveMode: 'ripple',      // legacy single-style setting, retained for migration
  motionMix: 0,           // legacy single-style amount, retained for migration
  bandMap: 'radial',       // which region reacts to which bands: 'depth' | 'radial' | 'vertical' | 'horizontal'
  bandDistribution: 0,    // depth split: negative packs more bands toward the back
  wallpaperCycle: false,
  wallpaperCycleMinutes: 5,
  wallpaperCrossfade: 2,  // seconds; snapshot blend avoids rendering two clouds
  intensity: 1.0,
  depthMove: 1.0,          // Z motion multiplier (toward/away from viewer)
  xyMove: 1.0,             // lateral motion multiplier (x/y shimmer + swell)
  bands: 64,               // number of frequency bands = number of regions
  invertBands: false,      // flip band direction: bass toward viewer / far side
  overscan: 1.0,           // legacy manual crop, superseded by screen coverage
  overscanAuto: true,      // legacy auto-crop flag
  keepScreenCovered: true, // saved key: dynamically fill the screen
  fillStrength: .6,       // relaxed framing allows small edge glimpses
  framingSmoothing: .6,   // smooth framing corrections in both directions
  hideBackdrop: false,     // black background while particles are on screen
  flybyExit: false,        // idle exit: points rush the camera instead of a clean fade
  cursorRipple: true,      // particles swell around the mouse cursor
  sensGain: 1.0,           // input gain: how strongly sound drives everything
  sensFloor: 0.0,          // noise floor: below this level, no movement
  sensCurve: 1.5,          // response gamma: higher = quiet sounds move less
  eqCurve: 0,              // equal-loudness weighting: motion follows hearing (0 = off, 4 = max)
  tiltEQ: 0,               // spectral tilt: -1 bass-reactive, +1 highs-reactive
  highBoost: 0,            // extra high-frequency response after normalization; lows stay put
  tiltPivot: 0.5,          // where the tilt crosses zero (0 bass end, 1 highs end)
  stickyIn: 0.5,           // band attack: 0 = jump instantly, 1 = reluctant
  stickyOut: 0.5,          // band release: 0 = drop instantly, 1 = long hold
  speedVol: 1.0,           // how much volume speeds up the motion (0 = fixed)
  motionSpeed: 1.0,        // base tempo of wave/shimmer motion (0 = music-driven only)
  parallax: 0.8,
  musicParallax: 0,        // camera sway driven by the music itself (0 = off)
  audioCurvature: 0,      // signed audio-driven bowl curvature; no static depth needed
  occludedBackground: false, // cached AI hidden background, behind depth edges
  reconstructionBrightness: .7,
  reconstructionSideOcclusion: false, // filled side shells also hide reconstructed background
  reconstructionPointLimit: 40000,
  reconstructionWidth: 1,
  gapFillForegroundLimit: false, // automatic shell estimate near foreground outlines
  aiFillThickness: true, // cached SegFormer masks guide Auto thickness; no per-frame model
  gapFillPointLimit: 180000, // ordinary seam points, independently capped; zero disables
  surfaceCohesion: .75,    // shared audio motion on confident AI wall surfaces; geometry stays original
  smartDepthBands: false, // snap audio cuts toward valleys in the image depth distribution
  gapFillThicknessBias: 1, // multiplier of the local estimate, not a gap percentage
  gapFillManualLimit: false, // optional uniform percentage cap, alongside Auto thickness
  gapFillThickness: .6,    // retained foreground side span when manual limiting is on
  pinWallpaperSelector: false, // keep image selection visible while scrolling settings
  curvatureSource: 'input', // 'input' or original slower 'bands' response
  dollyZoom: 0,           // audio camera approach with compensating field of view
  quietMovement: 0.6,      // minimum audio motion multiplier, before the silence fade
  energyResponse: 1,       // loudness response exponent: gentle < 1, dramatic > 1
  loudReference: 0.25,      // fixed RMS reference; explicit calibration replaces it
  centeredMotion: false,   // audio mode: quiet bands pull back, loud push forward
  equalDepthMovement: false, // remove the near-layer bias from audio depth displacement
  previewPaused: false,    // freeze the preview window (wallpaper keeps running)
  easeInShape: 0,         // envelope tension: negative quick start, zero linear, positive slow start
  easeOutShape: 0,
  easeInStyle: 'envelope',
  easeOutStyle: 'envelope',
  easeInSlope: .5,
  easeOutSlope: .5,
  easeInPosition: .5,
  easeOutPosition: .5,
  easeInBezier: [.2,.35,.6,1],
  easeOutBezier: [.2,.35,.6,1],
  settingsOnly: false,    // compact controls with no preview rendering
  previewFullQuality: false, // don't throttle the preview while wallpaper mode is on
  audioSource: 'demo',     // 'system' | 'mic' | 'file' | 'demo'
  audioFileUrl: null,
  fpsCap: 30,              // 24 | 30 | 40 | 60 | 0 (uncapped)
  autoQuality: true,
  idleSleep: true,
};

const KEY = 'dv.settings.v1';

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return { ...DEFAULTS, ...migrateSaved(saved) };
}

function migrateSaved(saved) {
  const migrated = { ...migrateMotion(saved) };
  delete migrated.wallFillPointLimit;
  if(typeof migrated.gapFillAdaptive==='boolean')migrated.gapFillAdaptive=Number(migrated.gapFillAdaptive);
  if(Number.isFinite(migrated.gapFillAdaptive))migrated.gapFillAdaptive=Math.max(0,Math.min(1,migrated.gapFillAdaptive));
  if (migrated.swirlRangeVersion !== 1) {
    if (Number.isFinite(migrated.motionSwirl)) {
      migrated.motionSwirl = Math.max(0, Math.min(1, migrated.motionSwirl / 0.28));
    }
    migrated.swirlRangeVersion = 1;
  }
  // Carry the old single-style amount into its layer once. Explicit layer
  // settings, including all-zero layers, must never revive the old style.
  const layers = ['motionWave', 'motionRipple', 'motionBands', 'motionDrift',
    'motionSwirl', 'motionBreathe', 'motionSweep', 'motionBandShake'];
  if (!layers.some((key) => migrated[key] !== undefined)) {
    const key = { wave: 'motionWave', ripple: 'motionRipple', bands: 'motionBands', drift: 'motionDrift' }[migrated.waveMode];
    if (key) migrated[key] = Math.max(0, Math.min(1, migrated.motionMix || 0));
  }
  if (migrated.sizePulse !== undefined || !Number.isFinite(migrated.boost)) return migrated;
  // The original boost also grew points, capped at boost=1. Carry that
  // amount over once; later Light pulse edits leave Size pulse independent.
  return { ...migrated, sizePulse: Math.max(0, Math.min(1, migrated.boost)) };
}

function migrateMotion(saved) {
  // Preserve the look of settings saved before Audio and styles could mix.
  if (saved.motionMix !== undefined) return saved;
  if (saved.waveMode === 'audio') return { ...saved, waveMode: 'ripple', motionMix: 0 };
  if (saved.waveMode) return { ...saved, motionMix: 1 };
  return saved;
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
  try { saved = migrateSaved(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const patch = {};
  for (const [k, v] of Object.entries(saved)) {
    if (settings[k] !== v) { settings[k] = v; patch[k] = v; }
  }
  if (Object.keys(patch).length) for (const fn of listeners) fn(settings, patch);
}
window.addEventListener('storage', (e) => { if (e.key === KEY) resync(); });
setInterval(resync, 2000);
