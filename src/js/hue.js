// Encode each possible 8-bit band level as a signed hue rotation. The lookup
// is rebuilt when the slider moves, not for every band on every frame.
export function buildHueLookup(degrees) {
  const lookup = new Uint8Array(256 * 2);
  const radiansPerLevel = Math.max(-180, Math.min(180, degrees)) * Math.PI / (180 * 255);
  for (let level = 0; level < 256; level++) {
    const angle = level * radiansPerLevel;
    lookup[level * 2] = Math.round((Math.cos(angle) + 1) * 127.5);
    lookup[level * 2 + 1] = Math.round((Math.sin(angle) + 1) * 127.5);
  }
  return lookup;
}

// A slow per-band baseline lets colour react to new accents, then return to
// the wallpaper's original colours during sustained notes. Subtracting the
// frame's mean accent keeps a broadband hit from recolouring every point.
export class HueAccentTracker {
  constructor(count) {
    this.baseline = new Float32Array(count);
    this.accents = new Float32Array(count);
    this.levels = new Uint8Array(count);
    this.pendingReset = true;
  }

  update(bands, count, dt, focus = 1) {
    if (this.pendingReset) {
      for (let i = 0; i < count; i++) this.baseline[i] = bands[i] || 0;
      this.pendingReset = false;
    }
    const follow = 1 - Math.exp(-Math.max(0, dt) / 1.2);
    let mean = 0;
    for (let i = 0; i < count; i++) {
      const level = Math.max(0, Math.min(1, bands[i] || 0));
      const accent = Math.max(0, level - this.baseline[i]) * 4;
      this.baseline[i] += (level - this.baseline[i]) * follow;
      this.accents[i] = accent;
      mean += accent;
    }
    const gate = count ? mean / count * Math.max(0, Math.min(1, focus)) : 0;
    for (let i = 0; i < count; i++) {
      this.levels[i] = Math.round(255 * Math.min(1, Math.max(0, this.accents[i] - gate) * 2));
    }
    return this.levels;
  }
}
