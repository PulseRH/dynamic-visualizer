const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Cache spatial/depth bounds by audio band only when the cloud or mapping
// changes. Each frame projects eight conservative corners per occupied band,
// including motion envelopes, so unsampled points cannot poke past the edges.
export class DynamicFraming {
  constructor(cloud) {
    this.cloud = cloud;

    this.positions = new Float64Array(256 * 8 * 3);
    this.centerX = 0; this.centerY = 0; this.zoom = null;
    this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  update(camera, baseZ, u, data, dt) {
    const points = this.positions;
    if (!this.cloud.count) return;
    const n = u.uBandCount.value, map = u.uBandMap.value, invert = u.uInvert.value;
    const key = `${n}/${map}/${invert}`;
    if (this.bandKey !== key) {
      this.bandKey = key;
      this.bandBounds = Array.from({ length: n }, () => [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
      const p = this.cloud.positions;
      for (let i = 0; i < p.length; i += 3) {
        const bx = p[i] / this.cloud.aspect + .5, by = p[i + 1] + .5;
        let bt = map < .5 ? p[i + 2] : map < 1.5 ? clamp(Math.hypot(bx - .5, by - .5) * 1.25, 0, 1) : map < 2.5 ? 1 - by : bx;
        if (invert > .5) bt = 1 - bt;
        const b = this.bandBounds[clamp(Math.floor(bt * n), 0, n - 1)];
        for (let axis = 0; axis < 3; axis++) { b[axis * 2] = Math.min(b[axis * 2], p[i + axis]); b[axis * 2 + 1] = Math.max(b[axis * 2 + 1], p[i + axis]); }
      }
    }
    let maxZ = -Infinity, extentX = 0, extentY = 0;
    let length = 0;
    const l = u.uLayers.value, e = u.uExtraLayers.value;
    const total = l.x + l.y + l.z + l.w + e.z;
    const style = .65 * total / Math.max(1, total);
    for (let band = 0; band < n; band++) {
      const b = this.bandBounds[band];
      if (!Number.isFinite(b[0])) continue;
      const amp = data[band * 4] / 255, drive = amp * u.uIntensity.value * u.uDyn.value;
      const layerDrive = amp * Math.min(u.uIntensity.value * u.uDyn.value, 1.5);
      const radius = Math.hypot(Math.max(Math.abs(b[0]), Math.abs(b[1])), Math.max(Math.abs(b[2]), Math.abs(b[3])));
      const xy = radius * (e.x * layerDrive * .112 * (1 + e.y * layerDrive * .2) + e.y * layerDrive * .2)
        + drive * u.uXYMove.value * .006 + e.w * e.w * amp * layerDrive * .045 + u.uCursor.value.z * .011;
      const direct = 1 + (amp * 2 - 1.8) * u.uCentered.value;
      const range = (.35 + .65 * b[5]) * (1 - u.uEqualDepthMovement.value) + u.uEqualDepthMovement.value;
      const move = drive * u.uZMove.value * .11 * range;
      const zlo = b[4] * u.uDepthScale.value + Math.min(0, direct - style) * move;
      const zhi = b[5] * u.uDepthScale.value + Math.max(0, direct + style) * move + u.uCursor.value.z * .1;
      maxZ = Math.max(maxZ, zhi);
      extentX = Math.max(extentX, Math.abs(b[0]) + xy, Math.abs(b[1]) + xy);
      extentY = Math.max(extentY, Math.abs(b[2]) + xy, Math.abs(b[3]) + xy);
      for (let corner = 0; corner < 8; corner++) {
        points[length++] = corner & 1 ? b[1] + xy : b[0] - xy;
        points[length++] = corner & 2 ? b[3] + xy : b[2] - xy;
        points[length++] = corner & 4 ? zhi : zlo;
      }
    }
    // Ensure nearer layers remain in front of the camera even at strong depth.
    const exposure = Math.abs(camera.position.x) * (extentX + Math.abs(camera.position.x))
      + Math.abs(camera.position.y) * (extentY + Math.abs(camera.position.y));
    camera.position.z = Math.max(baseZ, maxZ + 0.4 + Math.sqrt(exposure));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, Math.min(0.1, maxZ));
    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < length; i += 3) {
      const x = points[i], y = points[i + 1], z = points[i + 2];
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const sx = p[0] * vx / -vz, sy = p[5] * vy / -vz;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    this.bounds.minX = minX; this.bounds.maxX = maxX;
    this.bounds.minY = minY; this.bounds.maxY = maxY;
    const follow = 1 - Math.exp(-Math.max(0, dt) / 0.18);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (this.zoom === null) { this.centerX = cx; this.centerY = cy; }
    else { this.centerX += (cx - this.centerX) * follow; this.centerY += (cy - this.centerY) * follow; }
    const width = Math.max(Math.abs(minX - this.centerX), Math.abs(maxX - this.centerX));
    const height = Math.max(Math.abs(minY - this.centerY), Math.abs(maxY - this.centerY));
    const target = 0.95 / Math.max(width, height, 0.001);
    // Expand immediately when needed to retain edges; ease back in gently.
    this.zoom = this.zoom === null || target < this.zoom ? target : this.zoom + (target - this.zoom) * follow;
    camera.zoom = this.zoom;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = this.centerX * this.zoom;
    camera.projectionMatrix.elements[9] = this.centerY * this.zoom;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}
