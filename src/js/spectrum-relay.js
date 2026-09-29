// Reuse the wallpaper spectrum buffer until the producer changes band count.
// A fixed 64-band buffer silently discarded the upper half at 128 bands.
export function copySpectrumBands(receiver, bands) {
  if (receiver.bands.length !== bands.length) {
    receiver.bands = new Float32Array(bands.length);
  }
  receiver.bands.set(bands);
}
