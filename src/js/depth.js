// Depth estimation: converts an image into a low-res "nearness" grid (0..1,
// 1 = close to viewer) used to lift the point cloud into layered waves.
//
//  heuristic : instant, zero-dependency luminance/saturation/position prior.
//  onnx      : Depth-Anything-V2-small (fast AI option).
//  onnx-base : Depth-Anything-V2-base (more detailed, slower AI option).
//  Both models are downloaded on first use and cached in the Cache API.

export const DEPTH_GRID_W = 256;

export const DEFAULT_ONNX_MODEL =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx';
export const BASE_ONNX_MODEL =
  'https://huggingface.co/onnx-community/depth-anything-v2-base/resolve/main/onnx/model_fp16.onnx';

export function depthModelUrl(mode) {
  return mode === 'onnx-base' ? BASE_ONNX_MODEL : mode === 'onnx' ? DEFAULT_ONNX_MODEL : null;
}

// Cache per image object: different wallpapers often share the same resolution.
// Weak keys let old images and their depth grids be reclaimed after a switch.
const resultCache = new WeakMap(); // bitmap -> Map<mode:modelUrl, {data,w,h}>
const imageIds = new WeakMap();
const DEPTH_CACHE = 'dv-depth-results-v1';

// Content identity also handles a wallpaper file overwritten at the same path.
export async function identifyDepthImage(bitmap, blob) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    imageIds.set(bitmap, Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''));
  } catch { /* Caching is optional; estimation still works without it. */ }
}

async function diskKey(bitmap, modelUrl) {
  const imageId = imageIds.get(bitmap);
  if (!imageId || !modelUrl) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(modelUrl));
  const modelId = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  // Cache API accepts HTTP(S) keys only, even on Electron's app:// origin.
  // This is a storage key; it is never fetched or sent over the network.
  return `https://dynamic-visualizer.invalid/depth-results/${imageId}-${modelId}.bin`;
}

async function readDepthResult(key) {
  if (!key) return null;
  try {
    const hit = await (await caches.open(DEPTH_CACHE)).match(key);
    if (!hit) return null;
    const w = Number(hit.headers.get('grid-width')), h = Number(hit.headers.get('grid-height'));
    const buffer = await hit.arrayBuffer();
    if (w !== DEPTH_GRID_W || !Number.isInteger(h) || h < 32 || buffer.byteLength !== w * h * 4) return null;
    return { data: new Float32Array(buffer), w, h };
  } catch { return null; }
}

let saveQueue = Promise.resolve();
function saveDepthResult(key, result) {
  if (!key) return;
  saveQueue = saveQueue.then(async () => {
    const cache = await caches.open(DEPTH_CACHE);
    await cache.put(key, new Response(result.data, { headers: {
      'grid-width': String(result.w), 'grid-height': String(result.h),
    } }));
    // Small completed grids only; cap storage independently of model downloads.
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - 8))) await cache.delete(old);
  }).catch(() => {});
}

// ------------------------------------------------------------------ heuristic

export function heuristicDepth(bitmap) {
  const aspect = bitmap.height / bitmap.width;
  const w = DEPTH_GRID_W;
  const h = Math.max(32, Math.round(DEPTH_GRID_W * aspect));
  const { data } = drawScaled(bitmap, w, h);

  const near = new Float32Array(w * h);
  const cx = w / 2, cy = h / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx > 0.001 ? (mx - mn) / mx : 0;
      const bottomBias = y / (h - 1);                        // ground near, sky far
      const centerBias = 1 - Math.hypot(x - cx, y - cy) / maxD; // subject near center
      near[y * w + x] =
        0.32 * bottomBias +
        0.28 * lum +
        0.26 * sat +
        0.14 * centerBias;
    }
  }
  blurGrid(near, w, h, 2);
  blurGrid(near, w, h, 2);
  normalizePercentile(near, 0.02, 0.98);
  return { data: near, w, h };
}

function drawScaled(bitmap, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function blurGrid(grid, w, h, radius) {
  const tmp = new Float32Array(grid.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        sum += grid[y * w + xx]; n++;
      }
      tmp[y * w + x] = sum / n;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        sum += tmp[yy * w + x]; n++;
      }
      grid[y * w + x] = sum / n;
    }
  }
}

function normalizePercentile(grid, loP, hiP) {
  const sorted = Float32Array.from(grid).sort();
  const lo = sorted[Math.floor(sorted.length * loP)];
  const hi = sorted[Math.floor(sorted.length * hiP)];
  const span = Math.max(1e-5, hi - lo);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.min(1, Math.max(0, (grid[i] - lo) / span));
  }
}

// ----------------------------------------------------------------------- onnx

/** Returns {data,w,h} nearness grid from Depth-Anything. Throws on failure. */
export async function onnxDepth(bitmap, modelUrl = DEFAULT_ONNX_MODEL, onStatus = () => {}, signal) {
  // AI inference runs in a short-lived module worker so its ONNX runtime
  // memory is released after each estimate, especially for the Base model.
  onStatus('running AI model…');
  const worker = new Worker(new URL('./depth-worker.mjs', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Depth estimate cancelled', 'AbortError'));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (e) => {
        signal?.removeEventListener('abort', abort);
        e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        signal?.removeEventListener('abort', abort);
        reject(new Error(e.message || 'worker error'));
      };
      worker.postMessage({ bitmap, modelUrl, S: 518 });
    });
    onStatus('resampling depth grid…');
    // resample the full-resolution disparity onto our shared grid size
    const aspect = bitmap.height / bitmap.width;
    const w = DEPTH_GRID_W;
    const h = Math.max(32, Math.round(DEPTH_GRID_W * aspect));
    const near = new Float32Array(w * h);
    const ow = result.ow, oh = result.oh, disp = result.grid;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(oh - 1, Math.floor(((y + 0.5) / h) * oh));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(ow - 1, Math.floor(((x + 0.5) / w) * ow));
        near[y * w + x] = disp[sy * ow + sx];
      }
    }
    normalizePercentile(near, 0.02, 0.98);
    blurGrid(near, w, h, 1);
    return { data: near, w, h };
  } finally {
    worker.terminate();
  }
}
/** cache-aware entry point */
export async function estimateDepth(bitmap, mode, modelUrl, onStatus = () => {}, signal) {
  if (mode === 'flat') return null;
  const selectedModel = modelUrl || depthModelUrl(mode);
  const key = `${mode}:${selectedModel || ''}`;
  let imageCache = resultCache.get(bitmap);
  if (imageCache?.has(key)) return imageCache.get(key);
  let result;
  if (selectedModel) {
    let key = null;
    try { key = await diskKey(bitmap, selectedModel); } catch {}
    result = await readDepthResult(key);
    if (signal?.aborted) throw new DOMException('Depth estimate cancelled', 'AbortError');
    if (result) onStatus('using saved depth…');
    else {
      result = await onnxDepth(bitmap, selectedModel, onStatus, signal);
      if (!signal?.aborted) saveDepthResult(key, result);
    }
  } else {
    result = heuristicDepth(bitmap);
  }
  if (!imageCache) {
    imageCache = new Map();
    resultCache.set(bitmap, imageCache);
  }
  imageCache.set(key, result);
  return result;
}
