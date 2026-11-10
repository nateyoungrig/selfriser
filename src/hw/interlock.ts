import type { Rig } from '../model/types'

export interface Trip {
  a: string
  b: string
  diffIn: number
}

/** Growth past the run's starting differential that counts as "getting worse", inches. */
const GROWTH_IN = 1 / 16

/**
 * Master-run interlock for a live model: stop when two neighbouring towers that both have a
 * working laser, at least one of them moving, reach the stop tolerance and the gap has grown since
 * the run began. Running to fix an out-of-level roof (the gap shrinking) is always allowed.
 */
/**
 * Monitor-only alarm: any neighbouring pair, both with a live laser, at the stop tolerance. Nothing
 * here can stop the hoists, so there is no "getting worse" test: the crew needs to hear it.
 */
export function alarmPair(rig: Rig, heightsIn: number[], live: boolean[]): Trip | null {
  const index = new Map(rig.towers.map((t, i) => [t.id, i]))
  let worst: Trip | null = null
  for (const [a, b] of rig.adjacency) {
    const ia = index.get(a)!, ib = index.get(b)!
    if (!live[ia] || !live[ib]) continue
    const diff = heightsIn[ib] - heightsIn[ia]
    if (Math.abs(diff) < rig.tolerance.stopIn) continue
    if (!worst || Math.abs(diff) > Math.abs(worst.diffIn)) worst = { a, b, diffIn: diff }
  }
  return worst
}

export function interlockTrip(rig: Rig, heightsIn: number[], startIn: number[], live: boolean[], moving: boolean[]): Trip | null {
  const index = new Map(rig.towers.map((t, i) => [t.id, i]))
  let worst: Trip | null = null
  for (const [a, b] of rig.adjacency) {
    const ia = index.get(a)!, ib = index.get(b)!
    if (!live[ia] || !live[ib] || !(moving[ia] || moving[ib])) continue
    const diff = heightsIn[ib] - heightsIn[ia]
    const before = startIn[ib] - startIn[ia]
    if (Math.abs(diff) < rig.tolerance.stopIn || Math.abs(diff) <= Math.abs(before) + GROWTH_IN) continue
    if (!worst || Math.abs(diff) > Math.abs(worst.diffIn)) worst = { a, b, diffIn: diff }
  }
  return worst
}
