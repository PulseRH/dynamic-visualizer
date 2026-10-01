import { sampleImageToCloud } from './sampler.js';
self.onmessage = ({ data: { bitmap, depth, count, gapFill } }) => {
  try {
    const cloud = sampleImageToCloud(bitmap, depth, count, gapFill);
    self.postMessage({ cloud }, [cloud.positions.buffer, cloud.colors.buffer, cloud.rands.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
  }
};
