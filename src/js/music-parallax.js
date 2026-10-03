// Rotate only the audio displacement, retaining its length and leaving pointer
// parallax alone. The direction pauses in silence and when the effect is off.
export class MusicParallaxDirection {
  phase = 0;
  x = 0;
  y = 0;
  update(dt, active, x, y) {
    if (active) this.phase = (this.phase + Math.max(0, dt) * .15) % (Math.PI * 2);
    if (x === 0 && y === 0) { this.x = this.y = 0; return; }
    const cos = Math.cos(this.phase), sin = Math.sin(this.phase);
    this.x = x * cos - y * sin;
    this.y = x * sin + y * cos;
  }
}
