import type { Status } from '../lib/level'

export const STATUS_COLOR: Record<Status, string> = { ok: '#22c55e', warn: '#facc15', stop: '#ef4444' }

// Contour scale centered on average: blue = low, green = on average, red = high.
// Half scale lands on the warn colors, full scale on the stop tolerance.
const STOPS: [number, [number, number, number]][] = [
  [-1, [37, 99, 235]],
  [-0.5, [34, 211, 238]],
  [0, [34, 197, 94]],
  [0.5, [250, 204, 21]],
  [1, [239, 68, 68]],
]

export function deviationColor(devIn: number, fullScaleIn: number): string {
  const t = Math.max(-1, Math.min(1, devIn / fullScaleIn))
  let k = 0
  while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++
  const [t0, c0] = STOPS[k], [t1, c1] = STOPS[k + 1]
  const f = (t - t0) / (t1 - t0)
  const ch = (n: number) => Math.round(c0[n] + (c1[n] - c0[n]) * f)
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}

export const LEGEND_GRADIENT = `linear-gradient(to top, ${STOPS.map(([t, c]) => `rgb(${c.join(',')}) ${(t + 1) * 50}%`).join(', ')})`

/** Tower load versus its level-roof share: blue = shed load, grey = normal, orange/red = picked load up. */
export function loadColor(overPct: number, fullScalePct = 30): string {
  const t = Math.max(-1, Math.min(1, overPct / fullScalePct))
  const from = [107, 119, 134]
  const to = t >= 0 ? [239, 68, 68] : [59, 130, 246]
  const k = Math.abs(t)
  return `rgb(${from.map((c, n) => Math.round(c + (to[n] - c) * k)).join(', ')})`
}

export const signedPct = (v: number) => `${v >= 0.5 ? '+' : v <= -0.5 ? '-' : ''}${Math.abs(Math.round(v))}%`

/** Field: tower columns say where their height comes from. */
export const SOURCE_COLOR = { live: '#7dd3fc', stale: '#64748b', tape: '#c4b5fd', none: '#334155' } as const
