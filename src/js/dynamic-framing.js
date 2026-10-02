import { animatedSample, shapedDepth } from './framing-motion.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Select the outermost point in each narrow border strip once per image.
// Only these boundary points are animated/projected on the CPU each frame.
export class DynamicFraming {
  constructor(cloud) {
    const strips = 256, indices = new Int32Array(strips * 4).fill(-1);
    const p = cloud.positions;
    this.maxNear = 0;
    for (let i = 0; i < cloud.count; i++) {
      const j = i * 3, x = p[j], y = p[j + 1];
      this.maxNear = Math.max(this.maxNear, p[j + 2]);
      const row = clamp(Math.floor((y + .5) * strips), 0, strips - 1);
      const col = clamp(Math.floor((x / cloud.aspect + .5) * strips), 0, strips - 1);
      for (let side = 0; side < 4; side++) {
        const slot = side * strips + (side < 2 ? row : col), old = indices[slot];
        const axis = side < 2 ? 0 : 1;
        if (old < 0 || (side % 2 === 0 ? p[j + axis] < p[old * 3 + axis] : p[j + axis] > p[old * 3 + axis])) indices[slot] = i;
      }
    }
    this.samples = new Float32Array(indices.length * 4);
    this.valid = new Uint8Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] < 0) continue;
      const j = indices[i] * 3;
      this.samples.set([p[j], p[j + 1], p[j + 2], cloud.rands[indices[i]]], i * 4);
      this.valid[i] = 1;
    }
    this.aspect = cloud.aspect;
    this.positions = new Float64Array(indices.length * 3);
    this.centerX = 0; this.centerY = 0; this.zoom = null;
    this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  update(camera, baseZ, u, data, dt, strength=1, smoothing=0) {
    strength=clamp(strength,0,1); smoothing=clamp(smoothing,0,1);
    const strict=strength===1 && smoothing===0;
    const samples = this.samples, points = this.positions;
    let peak = 0;
    for (let b = 0; b < u.uBandCount.value; b++) peak = Math.max(peak, data[b * 4] / 255);
    // Keep every depth layer in front of the camera; zoom restores screen size.
    const maxZ = shapedDepth(this.maxNear,u.uDepthShape?.value ?? 0) * u.uDepthScale.value
      + peak * u.uIntensity.value * u.uDyn.value * u.uZMove.value * .11 * 1.85 + u.uCursor.value.z * .1
      + Math.max(0,u.uCurvature?.value ?? 0)*.5;
    const exposure = Math.abs(camera.position.x) * (this.aspect / 2 + Math.abs(camera.position.x))
      + Math.abs(camera.position.y) * (.5 + Math.abs(camera.position.y));
    camera.position.z = Math.max(baseZ, maxZ + .4 + Math.sqrt(exposure));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, .1);
    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
    // Inner edge limits keep sloping or uneven-depth borders outside the screen.
    let left = -Infinity, right = Infinity, bottom = -Infinity, top = Infinity;
    for (let i = 0; i < this.valid.length; i++) {
      if (!this.valid[i]) continue;
      const j = i * 3, s = i * 4;
      animatedSample(samples[s], samples[s + 1], samples[s + 2], samples[s + 3], u, data, points, j);
      const x = points[j], y = points[j + 1], z = points[j + 2];
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const sx = p[0] * vx / -vz, sy = p[5] * vy / -vz;
      const side = i >> 8;
      if (side === 0) left = Math.max(left, sx);
      else if (side === 1) right = Math.min(right, sx);
      else if (side === 2) bottom = Math.max(bottom, sy);
      else top = Math.min(top, sy);
    }
    if (!(right > left && top > bottom)) return;
    this.bounds.minX = left; this.bounds.maxX = right;
    this.bounds.minY = bottom; this.bounds.maxY = top;
    const follow = 1 - Math.exp(-Math.max(0, dt) / (.25+1.75*smoothing*smoothing));
    const cx = (left + right) / 2, cy = (bottom + top) / 2;
    if (this.zoom === null) { this.centerX = cx; this.centerY = cy; }
    else { this.centerX += (cx - this.centerX) * follow; this.centerY += (cy - this.centerY) * follow; }
    if(strict) {
      this.centerX = clamp(this.centerX, left + (right - left) * .1, right - (right - left) * .1);
      this.centerY = clamp(this.centerY, bottom + (top - bottom) * .1, top - (top - bottom) * .1);
    }
    // Soft framing measures the ideal centre, rather than zooming harder to
    // compensate for a centre that is still catching up after a sudden beat.
    const room = strict ? Math.min(this.centerX-left,right-this.centerX,this.centerY-bottom,top-this.centerY)
      : Math.min((right-left)/2,(top-bottom)/2);
    const target = 1.025 / Math.max(room, .001);
    // Cover immediately when an edge approaches; ease out as space returns.
    if(strict) {
      this.zoom = this.zoom === null || target > this.zoom ? target : this.zoom + (target - this.zoom) * follow;
      this.softScale=null;
    } else {
      // Compensate for safety camera distance immediately, then ease only the
      // framing correction. Safety moves must not look like extra audio zoom.
      const distanceScale=camera.position.z/baseZ;
      const targetScale=1+strength*(target/distanceScale-1);
      if(this.zoom===null) this.softScale=targetScale;
      else if(this.softScale==null) this.softScale=this.zoom/distanceScale;
      this.softScale+=(targetScale-this.softScale)*follow;
      this.zoom=this.softScale*distanceScale;
    }
    camera.zoom = this.zoom;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = this.centerX * this.zoom * strength;
    camera.projectionMatrix.elements[9] = this.centerY * this.zoom * strength;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}
