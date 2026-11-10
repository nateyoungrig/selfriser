import type { Rig } from '../model/types'

export type Status = 'ok' | 'warn' | 'stop'

export interface PairDiff {
  a: string
  b: string
  /** height(b) - height(a), inches. */
  diffIn: number
  spanFt: number
  status: Status
}

export interface LevelReport {
  meanIn: number
  minIn: number
  maxIn: number
  /** Highest minus lowest tower. */
  spreadIn: number
  /** Per tower, height minus mean. */
  devIn: number[]
  /** Per tower, height minus the least-squares plane through all towers (twist / local tweak). */
  planeDevIn: number[]
  /** Slope of the best-fit plane, inches per foot. */
  planeSlope: { x: number; y: number }
  pairs: PairDiff[]
  worstPair: PairDiff | null
  /** Per tower: worst status among its adjacent pairs. */
  towerStatus: Status[]
  status: Status
}

export function statusFor(absIn: number, tol: { warnIn: number; stopIn: number }): Status {
  return absIn >= tol.stopIn ? 'stop' : absIn >= tol.warnIn ? 'warn' : 'ok'
}

const RANK: Record<Status, number> = { ok: 0, warn: 1, stop: 2 }
export const worse = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)

/** Least-squares plane z = c0 + cx*x + cy*y. Falls back to a flat plane when towers are collinear. */
export function fitPlane(points: { x: number; y: number; z: number }[]): { c0: number; cx: number; cy: number } {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const mz = points.reduce((s, p) => s + p.z, 0) / n
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz
  }
  const det = sxx * syy - sxy * sxy
  let cx = 0, cy = 0
  if (Math.abs(det) > 1e-9 * Math.max(1, sxx * syy)) {
    cx = (sxz * syy - syz * sxy) / det
    cy = (syz * sxx - sxz * sxy) / det
  } else if (sxx > 1e-9) cx = sxz / sxx
  else if (syy > 1e-9) cy = syz / syy
  return { c0: mz - cx * mx - cy * my, cx, cy }
}

/**
 * Level picture for the heights on screen. known marks towers that have a height at all (a laser
 * reading or a tape); the rest sit at the average, out of every pair, so one missing laser never
 * reads as a tower on the deck.
 */
export function analyzeLevel(rig: Rig, heightsIn: number[], tol = rig.tolerance, known?: boolean[]): LevelReport {
  const n = rig.towers.length
  const has = (i: number) => !known || known[i]
  const idx = rig.towers.map((_, i) => i).filter(has)
  const vals = idx.map((i) => heightsIn[i])
  const meanIn = vals.length ? vals.reduce((s, h) => s + h, 0) / vals.length : 0
  const minIn = vals.length ? Math.min(...vals) : 0
  const maxIn = vals.length ? Math.max(...vals) : 0
  const plane = idx.length ? fitPlane(idx.map((i) => ({ x: rig.towers[i].x, y: rig.towers[i].y, z: heightsIn[i] }))) : { c0: 0, cx: 0, cy: 0 }
  const index = new Map(rig.towers.map((t, i) => [t.id, i]))

  const towerStatus: Status[] = Array(n).fill('ok')
  const pairs: PairDiff[] = []
  for (const [a, b] of rig.adjacency) {
    const ia = index.get(a), ib = index.get(b)
    if (ia === undefined || ib === undefined || !has(ia) || !has(ib)) continue
    const ta = rig.towers[ia], tb = rig.towers[ib]
    const diffIn = heightsIn[ib] - heightsIn[ia]
    const status = statusFor(Math.abs(diffIn), tol)
    towerStatus[ia] = worse(towerStatus[ia], status)
    towerStatus[ib] = worse(towerStatus[ib], status)
    pairs.push({ a, b, diffIn, spanFt: Math.hypot(tb.x - ta.x, tb.y - ta.y), status })
  }
  const worstPair = pairs.reduce<PairDiff | null>((w, p) => (!w || Math.abs(p.diffIn) > Math.abs(w.diffIn) ? p : w), null)

  return {
    meanIn, minIn, maxIn,
    spreadIn: maxIn - minIn,
    devIn: heightsIn.map((h, i) => (has(i) ? h - meanIn : 0)),
    planeDevIn: rig.towers.map((t, i) => (has(i) ? heightsIn[i] - (plane.c0 + plane.cx * t.x + plane.cy * t.y) : 0)),
    planeSlope: { x: plane.cx, y: plane.cy },
    pairs, worstPair, towerStatus,
    status: towerStatus.reduce<Status>(worse, 'ok'),
  }
}

export type LevelTarget = 'median' | 'high' | 'mean' | 'low'

/** Inches each tower needs to travel (+up / -down) to bring the roof level at the chosen target. Unknown towers stay put. */
export function corrections(heightsIn: number[], target: LevelTarget, known?: boolean[]): number[] {
  const vals = heightsIn.filter((_, i) => !known || known[i])
  if (!vals.length) return heightsIn.map(() => 0)
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const goal =
    // The median moves the fewest winches the least: one stray tower comes back to the pack.
    target === 'median' ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
    : target === 'high' ? sorted[sorted.length - 1]
    : target === 'low' ? sorted[0]
    : vals.reduce((s, h) => s + h, 0) / vals.length
  return heightsIn.map((h, i) => (!known || known[i] ? goal - h : 0))
}
