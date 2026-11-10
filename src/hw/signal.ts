// Link quality without any radio support: towers report at a known idle rate (5 a second), so the
// share of those reports that actually arrive says how healthy the radio link is. Moving towers on
// the model report faster; that just reads as 100%.

export const EXPECTED_HZ = 5
export const WINDOW_MS = 5000

/** Keep only arrivals inside the window. Mutates and returns the array. */
export function prune(arrivals: number[], now: number, windowMs = WINDOW_MS): number[] {
  while (arrivals.length && now - arrivals[0] > windowMs) arrivals.shift()
  return arrivals
}

/**
 * Percent of expected reports received over the last window (0-100). firstSeen shortens the window
 * for a tower that only just appeared, so it doesn't start out looking weak.
 */
export function linkQuality(arrivals: number[], now: number, firstSeen: number, windowMs = WINDOW_MS, hz = EXPECTED_HZ): number {
  const span = Math.min(windowMs, now - firstSeen)
  if (span < 1000) return arrivals.length ? 100 : 0
  const got = arrivals.filter((t) => now - t <= windowMs).length
  return Math.min(100, Math.round((got / ((span / 1000) * hz)) * 100))
}
