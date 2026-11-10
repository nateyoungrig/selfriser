import type { Rig } from '../model/types'
import { analyzeLevel } from './level'
import { coupledLoads } from './loads'
import { winchSpeed, type Direction, type WinchReadout } from './winch'

export interface SimModel {
  rig: Rig
  /** Level-roof load per tower, lb. */
  staticLb: number[]
  /** Per-tower learned speed factor. */
  calibration: number[]
}

export function readouts(model: SimModel, heightsIn: number[], dir: Direction): WinchReadout[] {
  const { rig } = model
  const loads = coupledLoads(rig, model.staticLb, heightsIn)
  return rig.towers.map((t, i) =>
    winchSpeed(rig.winch, rig.power, {
      towerLoadLb: loads[i],
      heightIn: heightsIn[i],
      feederFt: t.feederFt,
      ropeOnDrumAtZeroFt: t.ropeOnDrumAtZeroFt,
      partsOfLine: t.partsOfLine ?? rig.winch.partsOfLine,
      motors: t.motors ?? 1,
      calibration: model.calibration[i] ?? 1,
    }, dir),
  )
}

/** Position of a winch's selector switch. */
export type Switch = 1 | 0 | -1

export const allSwitches = (n: number, s: Switch): Switch[] => Array(n).fill(s)
const expand = (n: number, dirs: Direction | Switch[]): Switch[] => (typeof dirs === 'number' ? allSwitches(n, dirs) : dirs)

/**
 * Advance the winches together for dtSec, like holding GO: each winch runs in its own switch
 * direction, and a winch switched OFF sits on its brake.
 */
export function step(model: SimModel, heightsIn: number[], dirs: Direction | Switch[], dtSec: number): number[] {
  const sw = expand(heightsIn.length, dirs)
  const maxIn = model.rig.maxTrimFt * 12
  const up = sw.includes(1) ? readouts(model, heightsIn, 1) : null
  const down = sw.includes(-1) ? readouts(model, heightsIn, -1) : null
  return heightsIn.map((h, i) => {
    const d = sw[i]
    if (!d) return h
    const r = (d === 1 ? up : down)![i]
    return Math.min(maxIn, Math.max(0, h + d * ((r.roofFpm * 12) / 60) * dtSec))
  })
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
const DT = 0.5
/** Average distance the running winches have moved. */
const travelled = (from: number[], to: number[], sw: Switch[]) => {
  const moving = to.map((v, i) => (sw[i] ? Math.abs(v - from[i]) : null)).filter((v): v is number => v !== null)
  return moving.length ? mean(moving) : 0
}

/** Run until the running winches have averaged travelIn of movement (or everything hits a limit). */
export function runTravel(model: SimModel, heightsIn: number[], dirs: Direction | Switch[], travelIn: number): { heightsIn: number[]; seconds: number } {
  const sw = expand(heightsIn.length, dirs)
  if (!sw.some(Boolean)) return { heightsIn, seconds: 0 }
  // Fine steps for a 1" bump, coarse ones for a 10 ft run.
  const dt = Math.min(DT, Math.max(0.05, travelIn / 40))
  let h = heightsIn
  let seconds = 0
  while (travelled(heightsIn, h, sw) < travelIn && seconds < 3600) {
    const next = step(model, h, sw, dt)
    if (next.every((v, i) => v === h[i])) break
    h = next
    seconds += dt
  }
  return { heightsIn: h, seconds }
}

export interface Forecast {
  /** Average travel from here until the worst adjacent pair crosses each threshold; null = never before the limit. */
  warnAfterIn: number | null
  stopAfterIn: number | null
}

export function forecast(model: SimModel, heightsIn: number[], dirs: Direction | Switch[], tol = model.rig.tolerance): Forecast {
  const sw = expand(heightsIn.length, dirs)
  const out: Forecast = { warnAfterIn: null, stopAfterIn: null }
  if (!sw.some(Boolean)) return out
  let h = heightsIn
  for (let seconds = 0; seconds < 3600; seconds += DT) {
    const worst = Math.abs(analyzeLevel(model.rig, h, tol).worstPair?.diffIn ?? 0)
    const gone = travelled(heightsIn, h, sw)
    if (out.warnAfterIn === null && worst >= tol.warnIn) out.warnAfterIn = gone
    if (worst >= tol.stopIn) { out.stopAfterIn = gone; break }
    const next = step(model, h, sw, DT)
    if (next.every((v, i) => v === h[i])) break
    h = next
  }
  return out
}

/**
 * Learn per-winch speed factors from a stop: compare how far each tower really travelled with how
 * far the sim said it would. Only *relative* differences are learned - the overall ratio mostly
 * reflects how long the sim paddle was held versus the real one.
 */
export function calibrate(
  calibration: number[],
  baselineIn: number[],
  predictedIn: number[],
  measuredIn: (number | null)[],
  gain = 0.7,
  minTravelIn = 12,
): number[] {
  const ratios = measuredIn.map((m, i) => {
    const predicted = predictedIn[i] - baselineIn[i]
    if (m === null || Math.abs(predicted) < minTravelIn) return null
    const ratio = (m - baselineIn[i]) / predicted
    return ratio > 0.5 && ratio < 1.5 ? ratio : null
  })
  const used = ratios.filter((r): r is number => r !== null)
  if (used.length < 2) return calibration
  const norm = mean(used)
  return calibration.map((c, i) => {
    const r = ratios[i]
    if (r === null) return c
    return Math.min(1.15, Math.max(0.85, c * (1 + gain * (r / norm - 1))))
  })
}

/**
 * Learn per-tower speed factors from a recorded real lift: laser heights over time, every tower
 * reading. Over each step where the whole roof moved one way together (a run on the paddle, not a
 * bump), every tower's travel is compared with the travel the model expects for it at those
 * heights. Only relative speed is learned. Null when the recording holds less than minTravelIn of
 * runs to learn from.
 */
export function learnFromSamples(model: SimModel, samples: (number | null)[][], minTravelIn = 12): number[] | null {
  const n = model.rig.towers.length
  const base = { ...model, calibration: model.rig.towers.map(() => 1) }
  const measured = Array(n).fill(0), expected = Array(n).fill(0)
  let travel = 0
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1], b = samples[k]
    if (a.length !== n || b.length !== n || a.some((v) => v === null) || b.some((v) => v === null)) continue
    const d = b.map((v, i) => v! - a[i]!)
    const m = mean(d)
    // Idle, or a bump / mixed directions: nothing to say about how the towers track each other.
    if (Math.abs(m) < 0.25 || d.some((x) => x * Math.sign(m) < 0.25 * Math.abs(m))) continue
    const dir: Direction = m > 0 ? 1 : -1
    const fpm = readouts(base, a as number[], dir).map((r) => r.roofFpm)
    const mf = mean(fpm)
    d.forEach((x, i) => { measured[i] += Math.abs(x); expected[i] += (Math.abs(m) * fpm[i]) / mf })
    travel += Math.abs(m)
  }
  if (travel < minTravelIn) return null
  const ratio = measured.map((v, i) => v / expected[i])
  const norm = mean(ratio)
  return ratio.map((r) => Math.min(1.15, Math.max(0.85, r / norm)))
}
