import * as THREE from '../vendor/three.module.js';

// Solve once for the largest safe camera travel within the configured margin.
// A tilted perspective camera can expose corners even with extra zoom.
export function parallaxCoverageScale(camera, z, imageAspect, maxX, maxY) {
  if (maxX === 0 && maxY === 0) return 1;
  const view = camera.clone();
  const ray = new THREE.Vector3();
  const fits = (scale) => {
    for (const x of [-maxX, 0, maxX]) for (const y of [-maxY, 0, maxY]) {
      view.position.set(x * scale, y * scale, z);
      view.lookAt(0, 0, 0.1);
      view.updateMatrixWorld();
      for (const nx of [-1, 1]) for (const ny of [-1, 1]) {
        ray.set(nx, ny, 0.5).unproject(view).sub(view.position);
        if (ray.z >= -0.000001) return false;
        const t = -z / ray.z;
        const px = view.position.x + ray.x * t;
        const py = view.position.y + ray.y * t;
        if (Math.abs(px) > imageAspect / 2 + 0.000001 || Math.abs(py) > 0.500001) return false;
      }
    }
    return true;
  };
  if (fits(1)) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 14; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low * 0.99; // leave a small margin for floating point/viewport edges
}
