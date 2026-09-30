import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three.module.js';
import { parallaxCoverageScale } from '../src/js/screen-cover.js';

for (const screenAspect of [9 / 16, 4 / 3, 16 / 9, 21 / 9]) {
  for (const imageAspect of [9 / 16, 4 / 3, 16 / 9, 21 / 9]) {
    for (const [parallax, music, drift] of [[0, 0, 0], [0.8, 0, 0], [1, 0.5, 1], [2, 1, 1]]) {
      const camera = new THREE.PerspectiveCamera(50, screenAspect, 0.05, 40);
      const tangent = Math.tan(25 * Math.PI / 180);
      const zoom = 1 + (parallax + music) * 0.15;
      const z = Math.min(0.5 / tangent, imageAspect / 2 / (tangent * screenAspect)) / zoom;
      const dx = parallax * 0.06 * (1 + 0.6 * drift) + music * 0.075;
      const dy = parallax * 0.06 * (1 + 0.4 * drift) + music * 0.075 * 1.4;
      const scale = parallaxCoverageScale(camera, z, imageAspect, dx, dy);
      assert.ok(scale > 0 && scale <= 1);
      // Sample the interior as well as the extremes: actual pointer/music
      // positions can land anywhere inside these travel limits.
      for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
        camera.position.set(ix / 4 * dx * scale, iy / 4 * dy * scale, z);
        camera.lookAt(0, 0, 0.1);
        camera.updateMatrixWorld();
        for (const nx of [-1, 1]) for (const ny of [-1, 1]) {
          const ray = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position);
          assert.ok(ray.z < 0);
          const t = -z / ray.z;
          assert.ok(Math.abs(camera.position.x + ray.x * t) <= imageAspect / 2 + 0.00001);
          assert.ok(Math.abs(camera.position.y + ray.y * t) <= 0.50001);
        }
      }
    }
  }
}
console.log('Screen coverage holds throughout cursor/music travel on portrait, standard and ultrawide viewports.');
