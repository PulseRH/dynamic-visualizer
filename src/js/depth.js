// Depth estimation: converts an image into a low-res "nearness" grid (0..1,
// 1 = close to viewer) used to lift the point cloud into layered waves.
//
//  heuristic : instant, zero-dependency luminance/saturation/position prior.
//  onnx      : Depth-Anything-V2-small (fast AI option).
//  onnx-base : Depth-Anything-V2-base (more detailed, slower AI option).
//  Both models are downloaded on first use and cached in the Cache API.
import {depthTuningKey} from './depth-refine.js';

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
const predictionCache = new WeakMap(); // bitmap -> Map<modelUrl, raw prediction>
const imageIds = new WeakMap();
export const depthImageIdentity = bitmap => imageIds.get(bitmap);
const DEPTH_CACHE = 'dv-depth-results-v2';
const PREDICTION_CACHE = 'dv-depth-predictions-v1';

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
  return `https://dynamic-visualizer.invalid/depth-results/edge-v2/${imageId}-${modelId}.bin`;
}

async function readDepthResult(key,cacheName=DEPTH_CACHE,maxSize=512,minSize=32) {
  if (!key) return null;
  try {
    const hit = await (await caches.open(cacheName)).match(key);
    if (!hit) return null;
    const w = Number(hit.headers.get('grid-width')), h = Number(hit.headers.get('grid-height'));
    const buffer = await hit.arrayBuffer();
    if (!Number.isInteger(w) || w < minSize || w > maxSize || !Number.isInteger(h) || h < minSize || h > maxSize || buffer.byteLength !== w * h * 4) return null;
    const data=new Float32Array(buffer);if(!data.every(Number.isFinite))return null;
    return { data, w, h };
  } catch { return null; }
}

let saveQueue = Promise.resolve();
function saveDepthResult(key, result,cacheName=DEPTH_CACHE) {
  if (!key) return Promise.resolve();
  return saveQueue = saveQueue.then(async () => {
    const cache = await caches.open(cacheName);
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
export async function onnxDepth(bitmap, modelUrl = DEFAULT_ONNX_MODEL, onStatus = () => {}, signal,tuning={}) {
  // AI inference runs in a short-lived module worker so its ONNX runtime
  // memory is released after each estimate, especially for the Base model.
  let prediction=predictionCache.get(bitmap)?.get(modelUrl),rawKey=null;
  try{rawKey=(await diskKey(bitmap,modelUrl))?.replace('/depth-results/edge-v2/','/depth-predictions/v1/');}catch{}
  prediction ||= await readDepthResult(rawKey,PREDICTION_CACHE,2048,1);
  if(signal?.aborted)throw new DOMException('Depth estimate cancelled','AbortError');
  if(prediction){
    let models=predictionCache.get(bitmap);
    if(!models){models=new Map();predictionCache.set(bitmap,models);}models.set(modelUrl,prediction);
  }
  onStatus(prediction ? 'tuning saved AI depth…':'running AI model…');
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
      worker.postMessage({ bitmap, modelUrl, S: 518,prediction,tuning });
    });
    if(result.prediction){
      let models=predictionCache.get(bitmap);
      if(!models){models=new Map();predictionCache.set(bitmap,models);}models.set(modelUrl,result.prediction);
      // Finish this small save before terminating; it must survive reopening.
      await saveDepthResult(rawKey,result.prediction,PREDICTION_CACHE);
    }
    onStatus('depth edges prepared');
    return {data:result.data,w:result.w,h:result.h};
  } finally {
    worker.terminate();
  }
}
/** cache-aware entry point */
export async function estimateDepth(bitmap, mode, modelUrl, onStatus = () => {}, signal,tuning={}) {
  if (mode === 'flat') return null;
  const selectedModel = modelUrl || depthModelUrl(mode);
  const signature=depthTuningKey(mode,tuning);
  const key = `${mode}:${selectedModel || ''}:${signature}`;
  let imageCache = resultCache.get(bitmap);
  if (imageCache?.has(key)) return imageCache.get(key);
  let result;
  if (selectedModel) {
    let key = null;
    try { key = await diskKey(bitmap, selectedModel); } catch {}
    // Keep the default compatible with already-installed edge-v2 results.
    if(key&&signature!=='1.00:1.00')key=key.replace('.bin',`-${signature.replace(':','-')}.bin`);
    result = await readDepthResult(key);
    if (signal?.aborted) throw new DOMException('Depth estimate cancelled', 'AbortError');
    if (result) onStatus('using saved depth…');
    else {
      result = await onnxDepth(bitmap, selectedModel, onStatus, signal,tuning);
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
  // Dragging controls must not retain an unlimited collection of large grids.
  while(imageCache.size>6)imageCache.delete(imageCache.keys().next().value);
  return result;
}
