import { sampleImageToCloud } from './sampler.js';
self.onmessage = ({ data: { bitmap, depth, count, gapFill, mapping } }) => {
  try {
    const cloud = sampleImageToCloud(bitmap, depth, count, gapFill,mapping);
    const buffers=[cloud.positions.buffer,cloud.colors.buffer,cloud.rands.buffer];
    for(const key of ['fillStarts','fillEnds','fillFractions','fillThickness','fillForeground'])if(cloud[key])buffers.push(cloud[key].buffer);
    buffers.push(cloud.depthHistogram.buffer);
    if(cloud.surfaceMotion)buffers.push(cloud.surfaceMotion.data.buffer);
    if(cloud.reconstruction)for(const array of Object.values(cloud.reconstruction))buffers.push(array.buffer);
    self.postMessage({ cloud }, buffers);
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
  }
};
