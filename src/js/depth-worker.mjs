// Depth-Anything inference worker. Runs in its own process-like scope and is
// terminated after each estimate so ONNX runtime memory is released instead
// of lingering in the renderer.

let ortPromise = null;
const MODEL_CACHE = 'dv-model-cache-v1';

async function getOrt() {
  if (!ortPromise) {
    ortPromise = import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs');
    ortPromise.catch(() => { ortPromise = null; });
  }
  return ortPromise;
}

async function fetchModelCached(url) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.blob();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`model download failed (${resp.status})`);
  await cache.put(url, resp.clone());
  return resp.blob();
}

self.onmessage = async (e) => {
  const { bitmap, modelUrl, S } = e.data;
  try {
    const ort = await getOrt();

    // preprocess: NCHW, ImageNet-normalized
    const canvas = new OffscreenCanvas(S, S);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, S, S);
    const pixels = ctx.getImageData(0, 0, S, S).data;
    const input = new Float32Array(3 * S * S);
    for (let i = 0, p = 0; i < S * S; i++, p += 4) {
      input[i] = (pixels[p] / 255 - 0.485) / 0.229;
      input[S * S + i] = (pixels[p + 1] / 255 - 0.456) / 0.224;
      input[2 * S * S + i] = (pixels[p + 2] / 255 - 0.406) / 0.225;
    }

    const blob = await fetchModelCached(modelUrl);
    const modelBuf = await blob.arrayBuffer();
    let session;
    try {
      session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
    } catch {
      session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
    const results = await session.run(feeds);
    const out = results[session.outputNames[0]];
    const dims = out.dims;
    const ow = dims[dims.length - 1], oh = dims[dims.length - 2];

    const grid = new Float32Array(ow * oh);
    grid.set(Float32Array.from(out.data));
    try { await session.release(); } catch {}

    self.postMessage({ ok: true, grid, ow, oh }, [grid.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
