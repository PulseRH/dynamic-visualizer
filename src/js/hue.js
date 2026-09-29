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
