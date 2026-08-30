// App bootstrap + render loop. Owns the image → depth → cloud pipeline and
// the performance policy:
//   • FPS cap (default 30 — plenty for ambient waves, halves GPU energy)
//   • adaptive pixel-ratio when frame time runs over budget
//   • full sleep when music is silent and the window is hidden

import { VisualScene } from './scene.js';
import { AudioEngine } from './audio.js';
import { sampleImageToCloud, makeProceduralImage } from './sampler.js';
import { estimateDepth, DEFAULT_ONNX_MODEL } from './depth.js';
import { UI } from './ui.js';
import { bridge, platform } from './bridge.js';
import { get, set, getAll, onChange } from './settings.js';

const canvas = document.getElementById('gl');
const scene = new VisualScene(canvas);
const audio = new AudioEngine();

let currentImage = null;      // canvas or ImageBitmap currently visualized
let currentImageUrl = null;   // for the thumbnail
let rebuildToken = 0;
let sleeping = false;
let qualityTimer = 0;
let statTimer = 0;
let frameEMA = 16;
let quietSince = 0;

const ui = new UI({
  onImagePicked: (source) => handleImagePick(source),
  onAudioMode: (mode, opts) => switchAudio(mode, opts),
  onDepthChanged: () => rebuildCloud(),
  onWallpaperToggle: () => toggleWallpaper(),
  pickAudioFile: async () => {
    const picked = await bridge.chooseAudioFile();
    return picked;
  },
});

ui.setAbout(`Dynamic Visualizer · ${platform} · Electron/WebGL2`);

// --------------------------------------------------------------- image flow

async function fetchBitmap(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`image load failed (${resp.status})`);
  const blob = await resp.blob();
  return createImageBitmap(blob);
}

async function loadFromUrl(url) {
  const bitmap = await fetchBitmap(url);
  setMainImage(bitmap, url);
}

function setMainImage(imageLike, urlForThumb) {
  currentImage = imageLike;
  currentImageUrl = urlForThumb;
  ui.setThumb(urlForThumb || '');
  rebuildCloud();
}

async function handleImagePick({ kind, file }) {
  try {
    if (kind === 'wallpaper') {
      const res = await bridge.getWallpaper();
      if (res.ok) {
        set({ imageUrl: null }); // follow the OS wallpaper
        await loadFromUrl(res.url);
        ui.toast('Loaded your desktop wallpaper');
      } else {
        ui.toast('Could not detect the wallpaper — upload an image instead', 'err');
      }
    } else if (kind === 'upload') {
      const picked = await bridge.chooseImage();
      if (picked) {
        set({ imageUrl: picked.url });
        await loadFromUrl(picked.url);
      }
    } else if (kind === 'blob') {
      const url = URL.createObjectURL(file);
      const bitmap = await createImageBitmap(file);
      set({ imageUrl: null });
      setMainImage(bitmap, url);
    }
  } catch (err) {
    console.error(err);
    ui.toast(`Image error: ${err.message}`, 'err');
  }
}

async function loadInitialImage() {
  // 1. persisted explicit image (works if it's an app:// URL; blob URLs die)
  const saved = get('imageUrl');
  if (saved && !saved.startsWith('blob:')) {
    try { await loadFromUrl(saved); return; } catch {}
  }
  // 2. OS wallpaper
  try {
    const res = await bridge.getWallpaper();
    if (res.ok) { await loadFromUrl(res.url); return; }
  } catch {}
  // 3. procedural fallback
  setMainImage(makeProceduralImage(), null);
  ui.toast('No wallpaper detected — showing a built-in scene. Upload any image!');
}

// ------------------------------------------------------------- cloud rebuild

async function rebuildCloud() {
  if (!currentImage) return;
  const token = ++rebuildToken;
  const depthMode = get('depthMode');

  let depth = null;
  if (depthMode !== 'flat') {
    if (depthMode === 'onnx') ui.toast('Running AI depth model…', '', 8000);
    try {
      depth = await estimateDepth(currentImage, depthMode, DEFAULT_ONNX_MODEL, (s) => {
        if (depthMode === 'onnx') ui.toast(`Depth: ${s}`, '', 2500);
      });
      if (depthMode === 'onnx') ui.toast('AI depth ready', '', 2000);
    } catch (err) {
      console.warn('depth failed', err);
      ui.toast(`AI depth unavailable (${err.message}) — using heuristic`, 'err', 5000);
      depth = await estimateDepth(currentImage, 'auto', DEFAULT_ONNX_MODEL);
    }
  }
  if (token !== rebuildToken) return; // superseded

  const cloud = sampleImageToCloud(currentImage, depth, get('pointCount'));
  scene.setCloud(cloud);
  scene.setBackdrop(currentImage, 'dim');
  scene.applySettings(getAll());
}

// ------------------------------------------------------- wallpaper mode

const isWallpaperWindow = new URLSearchParams(location.search).get('wallpaper') === '1';
if (isWallpaperWindow) {
  document.body.classList.add('wallpaper');
  // wallpaper windows are click-through: the main process feeds us the global
  // cursor so the wallpaper still parallaxes with the mouse
  bridge.onCursor(({ nx, ny }) => scene.setExternalPointer(nx, ny));
}

async function toggleWallpaper() {
  if (isWallpaperWindow) return;
  const active = await bridge.isWallpaperActive();
  try {
    if (active) {
      await bridge.disableWallpaper();
      ui.setWallpaperActive(false);
      ui.toast('Wallpaper mode stopped');
    } else {
      await bridge.enableWallpaper();
      ui.setWallpaperActive(true);
      ui.toast('Wallpaper mode on — look at your desktop! Exit via the tray icon or here.', '', 6000);
    }
  } catch (err) {
    console.warn(err);
    ui.toast(`Wallpaper mode: ${err.message}`, 'err', 6000);
  }
}

bridge.onWallpaperState((on) => ui.setWallpaperActive(on));

// ------------------------------------------------------------- audio flow

async function switchAudio(mode, opts = {}) {
  try {
    await audio.setMode(mode, opts);
    ui.setAudioStatus(audio.status, mode === 'none' ? '' : 'live');
  } catch (err) {
    console.warn('audio error', err);
    ui.setAudioStatus(audio.status, 'err');
    ui.toast(`Audio: ${err.message}`, 'err', 5000);
    if (mode !== 'demo') {
      set({ audioSource: 'demo' });
      await audio.setMode('demo');
      ui.setAudioStatus(audio.status, 'live');
    }
  }
}

// ------------------------------------------------------------------ the loop

// point-count / depth-mode changes rebuild the cloud (debounced); every other
// setting (glow, intensity, modes, …) applies live to the scene
let lastCount = get('pointCount');
let lastDepthMode = get('depthMode');
let lastBands = get('bands');
let countTimer = null;
onChange((all, patch) => {
  scene.applySettings(all);
  if (get('bands') !== lastBands) {
    lastBands = get('bands');
    audio.setBandCount(lastBands); // recreate the analyzer, no rebuild needed
  }
  if (get('pointCount') !== lastCount || get('depthMode') !== lastDepthMode) {
    lastCount = get('pointCount');
    lastDepthMode = get('depthMode');
    clearTimeout(countTimer);
    countTimer = setTimeout(() => rebuildCloud(), 350);
  }
});

let lastRender = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) return;

  const cap = get('fpsCap');
  const interval = cap > 0 ? 1000 / cap : 0;
  if (now - lastRender < interval - 0.75) return;
  const spaced = Math.max(0, now - lastRender);
  lastRender = now;

  const analyzer = audio.frame(spaced, now);

  // idle sleep: freeze rendering entirely when nothing plays
  if (get('idleSleep') && audio.mode !== 'demo') {
    if (analyzer.energy < 0.008) {
      if (!sleeping) {
        quietSince = now;
        sleeping = true;
      } else if (now - quietSince > 4000 && analyzer.beat === 0) {
        return; // skip render; rAF still runs (near-zero cost) and watches for audio
      }
    } else {
      sleeping = false;
    }
  } else {
    sleeping = false;
  }

  scene.render(analyzer, get('parallax'));
  ui.setLevel(analyzer.level);

  // adaptive quality: keep frame time inside the budget by stepping resolution
  frameEMA = frameEMA * 0.92 + spaced * 0.08;
  qualityTimer += spaced;
  if (get('autoQuality') && qualityTimer > 2500) {
    qualityTimer = 0;
    const budget = cap > 0 ? 1000 / cap : 16.7;
    if (frameEMA > budget * 1.35 && scene.quality > 0.55) scene.setQuality(scene.quality - 0.15);
    else if (frameEMA < budget * 0.6 && scene.quality < 1) scene.setQuality(Math.min(1, scene.quality + 0.1));
  }

  statTimer += spaced;
  if (statTimer > 500) {
    statTimer = 0;
    ui.setStats(`${Math.round(1000 / Math.max(frameEMA, 0.1))} fps · ${(scene.points ? scene.points.geometry.attributes.position.count / 1000 : 0).toFixed(0)}k pts${scene.quality < 1 ? ` · q${scene.quality.toFixed(2)}` : ''}`);
    if (audio.mode !== 'none' && !audio.error) ui.setAudioStatus(audio.status, analyzer.energy > 0.02 ? 'live' : 'warn');
  }
}

// --------------------------------------------------------------------- boot

window.__dv = { audio, scene, get, set, loadUrl: (u) => loadFromUrl(u), rebuild: () => rebuildCloud() }; // debug/testing handle
(async function boot() {
  audio.setBandCount(get('bands'));
  try {
    await loadInitialImage();
  } catch (err) {
    console.error(err);
    currentImage = makeProceduralImage();
    setMainImage(currentImage, null);
  }
  await switchAudio(get('audioSource'), { fileUrl: get('audioFileUrl') });
  requestAnimationFrame(loop);
})();
