// Fine control when a small number of regions is visually noticeable, while
// keeping the previous four-band steps and every saved value from 8 to 128.
export const BAND_CHOICES = Object.freeze([
  ...Array.from({ length: 14 }, (_, i) => 6 + i * 2), // 6..32
  ...Array.from({ length: 24 }, (_, i) => 36 + i * 4), // 36..128
]);

export function bandChoiceIndex(value) {
  let closest = 0;
  for (let i = 1; i < BAND_CHOICES.length; i++) {
    if (Math.abs(BAND_CHOICES[i] - value) < Math.abs(BAND_CHOICES[closest] - value)) closest = i;
  }
  return closest;
}
