// Retain fractional frame time so a 40 fps cap can alternate display ticks
// on a 60 Hz screen instead of rounding down to 30 fps.
export function advanceFrameClock(now, previous, interval) {
  if (interval <= 0) return now;
  const elapsed = now - previous;
  if (elapsed < interval - 0.75) return null;
  return previous + Math.max(1, Math.floor((elapsed + 0.75) / interval)) * interval;
}
