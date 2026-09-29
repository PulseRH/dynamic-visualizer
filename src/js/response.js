// Shared by the motion renderer and its settings graph.
export function movementResponse(loudness, quiet = 0.6, slope = 1) {
  const x = Math.max(0, Math.min(1, Number.isFinite(loudness) ? loudness : 0));
  const floor = Math.max(0, Math.min(1, quiet));
  return floor + (1 - floor) * Math.pow(x, Math.max(0.25, Math.min(4, slope)));
}
