import { sampleImageToCloud } from './sampler.js';

export async function buildCloud(image, depth, count) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return sampleImageToCloud(image, depth, count);
  }
  const bitmap = await createImageBitmap(image);
  const worker = new Worker(new URL('./sampler-worker.mjs', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.cloud);
      worker.onerror = e => reject(new Error(e.message || 'Particle sampling failed'));
      worker.postMessage({ bitmap, depth, count }, [bitmap]);
    });
  } finally {
    worker.terminate();
    bitmap.close();
  }
}
