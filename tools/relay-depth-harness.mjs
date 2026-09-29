import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};

const { copySpectrumBands } = await load('../src/js/spectrum-relay.js');
const receiver = { bands: new Float32Array(64) };
for (const count of [64, 128, 32]) {
  const incoming = Float32Array.from({ length: count }, (_, i) => i / count);
  copySpectrumBands(receiver, incoming);
  assert.equal(receiver.bands.length, count);
  assert.deepEqual(receiver.bands, incoming);
  const buffer = receiver.bands;
  copySpectrumBands(receiver, incoming);
  assert.equal(receiver.bands, buffer, 'unchanged counts should reuse the buffer');
}

let activeBitmap;
globalThis.document = {
  createElement() {
    const canvas = {
      width: 0, height: 0,
      getContext() {
        return {
          drawImage(bitmap) { activeBitmap = bitmap; },
          getImageData() {
            const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
            for (let y = 0; y < canvas.height; y++) {
              for (let x = 0; x < canvas.width; x++) {
                const value = activeBitmap.axis === 'x'
                  ? Math.round(255 * x / canvas.width)
                  : Math.round(255 * y / canvas.height);
                const offset = (y * canvas.width + x) * 4;
                data[offset] = data[offset + 1] = data[offset + 2] = value;
                data[offset + 3] = 255;
              }
            }
            return { data };
          },
        };
      },
    };
    return canvas;
  },
};

const { estimateDepth, depthModelUrl, DEFAULT_ONNX_MODEL, BASE_ONNX_MODEL } = await load('../src/js/depth.js');
assert.equal(depthModelUrl('onnx'), DEFAULT_ONNX_MODEL);
assert.equal(depthModelUrl('onnx-base'), BASE_ONNX_MODEL);
assert.notEqual(BASE_ONNX_MODEL, DEFAULT_ONNX_MODEL);
assert.equal(depthModelUrl('auto'), null);
assert.equal(depthModelUrl('flat'), null);
const first = { width: 1920, height: 1080, axis: 'x' };
const second = { width: 1920, height: 1080, axis: 'y' };
const depthA = await estimateDepth(first, 'auto');
const depthB = await estimateDepth(second, 'auto');
assert.notEqual(depthA, depthB, 'different images at the same resolution need distinct depth maps');
assert.notDeepEqual(depthA.data, depthB.data);
assert.equal(await estimateDepth(first, 'auto'), depthA, 'rebuilding the same image should reuse its depth map');

console.log('Wallpaper relay handles changing band counts; depth cache follows image identity; AI modes select separate models.');
