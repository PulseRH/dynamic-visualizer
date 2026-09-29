// Decide whether audio should wake the particles BEFORE normalized bands can
// exaggerate a tiny signal. Thresholds are fractions of calibrated loudness.
export class AudioActivity {
  constructor() {
    this.active = false;
    this.pendingMs = 0;
  }

  update(loud, energy, dtMs) {
    const valid = Number.isFinite(loud) && Number.isFinite(energy);
    const threshold = this.active ? 0.005 : 0.01;
    if (!valid || loud < threshold || energy < 0.01) {
      this.active = false;
      this.pendingMs = 0;
    } else if (!this.active) {
      this.pendingMs += Math.max(0, Math.min(50, dtMs));
      if (this.pendingMs >= 90) this.active = true;
    }
    return this.active;
  }
}
