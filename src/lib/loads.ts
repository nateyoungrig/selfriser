import type { Rig } from '../model/types'
import { shapeFunctions } from './surface'

export interface LoadOverrides {
  memberPlf?: Record<string, number>
  areaPsf?: Record<string, number>
  pointLbs?: Record<string, number>
  /** Per tower id, lb. Wins over everything else, then each tower's own loadLb. */
  towerLb?: Record<string, number>
  /** undefined = use the rig's band, null = band off. */
  loadBandKips?: [number, number] | null
}

export interface LoadReport {
  /** Static load each tower carries with the roof level, lb. */
  towerLb: number[]
  /** Raw estimate before band fit / overrides, lb. */
  estimatedLb: number[]
  totalLb: number
}

const STEP_FT = 2.5

/** Break every distributed load into point loads so one routine handles them all. */
export function discretizeLoads(rig: Rig, o: LoadOverrides = {}): { x: number; y: number; lbs: number }[] {
  const out: { x: number; y: number; lbs: number }[] = []
  for (const m of rig.members) {
    const plf = o.memberPlf?.[m.kind] ?? rig.memberPlf[m.kind] ?? 0
    const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])
    const n = Math.max(1, Math.round(len / STEP_FT))
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      out.push({ x: m.a[0] + (m.b[0] - m.a[0]) * t, y: m.a[1] + (m.b[1] - m.a[1]) * t, lbs: (plf * len) / n })
    }
  }
  for (const a of rig.areaLoads) {
    const psf = o.areaPsf?.[a.id] ?? a.psf
    const nx = Math.max(1, Math.round(Math.abs(a.x1 - a.x0) / (2 * STEP_FT)))
    const ny = Math.max(1, Math.round(Math.abs(a.y1 - a.y0) / (2 * STEP_FT)))
    const cell = (Math.abs(a.x1 - a.x0) / nx) * (Math.abs(a.y1 - a.y0) / ny)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        out.push({ x: a.x0 + ((a.x1 - a.x0) * (i + 0.5)) / nx, y: a.y0 + ((a.y1 - a.y0) * (j + 0.5)) / ny, lbs: psf * cell })
  }
  for (const p of rig.pointLoads) out.push({ x: p.x, y: p.y, lbs: o.pointLbs?.[p.id] ?? p.lbs })
  return out
}

export function towerLoads(rig: Rig, o: LoadOverrides = {}): LoadReport {
  const estimatedLb = rig.towers.map(() => 0)
  for (const p of discretizeLoads(rig, o)) {
    const phi = shapeFunctions(rig.towers, p.x, p.y)
    phi.forEach((f, i) => (estimatedLb[i] += f * p.lbs))
  }

  let towerLb = [...estimatedLb]
  const band = o.loadBandKips === undefined ? rig.loadBandKips : o.loadBandKips
  if (band) {
    // Keep the estimated *pattern* (who is heavy, who is light) but pin it to the known range.
    const lo = Math.min(...estimatedLb), hi = Math.max(...estimatedLb)
    const [bandLo, bandHi] = [band[0] * 1000, band[1] * 1000]
    towerLb = estimatedLb.map((v) => (hi - lo < 1e-6 ? (bandLo + bandHi) / 2 : bandLo + ((v - lo) / (hi - lo)) * (bandHi - bandLo)))
  }
  rig.towers.forEach((t, i) => {
    const forced = o.towerLb?.[t.id] ?? t.loadLb
    if (forced !== undefined && Number.isFinite(forced)) towerLb[i] = forced
  })
  return { towerLb, estimatedLb, totalLb: towerLb.reduce((s, v) => s + v, 0) }
}

/**
 * Load actually on each line right now. A tower riding above its neighbors carries more of the
 * roof (the truss runs act like springs between towers); one riding low sheds load.
 */
export function coupledLoads(rig: Rig, staticLb: number[], heightsIn: number[]): number[] {
  const index = new Map(rig.towers.map((t, i) => [t.id, i]))
  const sum = rig.towers.map(() => 0)
  const count = rig.towers.map(() => 0)
  for (const [a, b] of rig.adjacency) {
    const ia = index.get(a)!, ib = index.get(b)!
    sum[ia] += heightsIn[ib]; count[ia]++
    sum[ib] += heightsIn[ia]; count[ib]++
  }
  const shift = rig.towers.map((_, i) => (count[i] ? rig.couplingLbPerIn * (heightsIn[i] - sum[i] / count[i]) : 0))
  const meanShift = shift.reduce((s, v) => s + v, 0) / shift.length
  // A slack line carries nothing; it can't push.
  return staticLb.map((w, i) => Math.max(0, w + shift[i] - meanShift))
}
