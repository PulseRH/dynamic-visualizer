import { sampleImageToCloud } from './sampler.js';
self.onmessage = ({ data: { bitmap, depth, count } }) => {
  try {
    const cloud = sampleImageToCloud(bitmap, depth, count);
    self.postMessage({ cloud }, [cloud.positions.buffer, cloud.colors.buffer, cloud.rands.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
  }
};
