export const PURPLE_ACCENT = [151, 101, 214];

// Pick a dominant coloured hue from a tiny image sample. Neutral pixels do
// not dilute the accent. A subdued shade keeps the matching hue without
// turning every control into a bright pastel highlight.
export function imageAccent(pixels) {
  const buckets = new Float64Array(12 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    const chroma = high - low;
    if (pixels[i + 3] < 128 || high < 32 || chroma / high < 0.18) continue;
    let hue = high === r ? (g - b) / chroma
      : high === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
    hue = (hue * 60 + 360) % 360;
    const offset = (Math.round(hue / 30) % 12) * 4;
    const weight = (chroma / high) ** 2 * Math.min(1, high / 96);
    buckets[offset] += weight;
    buckets[offset + 1] += r * weight;
    buckets[offset + 2] += g * weight;
    buckets[offset + 3] += b * weight;
  }
  let strongest = 0;
  for (let i = 4; i < buckets.length; i += 4) {
    if (buckets[i] > buckets[strongest]) strongest = i;
  }
  if (!buckets[strongest]) return [...PURPLE_ACCENT];
  const rgb = [1, 2, 3].map(i => buckets[strongest + i] / buckets[strongest]);
  const low = Math.min(...rgb), chroma = Math.max(...rgb) - low;
  return rgb.map(value => Math.round(255 * (0.32 + (value - low) / chroma * 0.48)));
}
