import type { Rect, StageDesign, Tower, WinchSpec } from './types'
import { autoMembers, autoRoof, gridAdjacency, lineTolerance } from './geometry'

// Starting values for a design that comes from a drawing. Only the plan comes off the paper: lifter
// specs, unit weights and feeder runs are the same ASSUMED starting guesses the examples use, to be
// corrected under Lab → Sim settings once real numbers are known. The field view needs none of them.

export type LifterPreset = 'chain' | 'winch'

export const LIFTERS: Record<LifterPreset, { label: string; lift: 'motor' | 'winch'; winch: WinchSpec; ropeOnDrumAtZeroFt: number }> = {
  // 2-ton chain motor, one part of chain, 16 fpm class.
  chain: {
    label: '2-ton chain motors',
    lift: 'motor',
    winch: { kind: 'hoist', lineFpmNoLoad: 16, partsOfLine: 1, ratedLinePullLb: 4000, ratedSlip: 0.04, mechEfficiency: 0.85, ratedVolts: 480, fullLoadAmps: 3.7, drumDiaIn: 0, drumWidthIn: 0, ropeDiaIn: 0 },
    ropeOnDrumAtZeroFt: 0,
  },
  // 4-ton pulley winch on two parts of rope.
  winch: {
    label: '4-ton pulley winches',
    lift: 'winch',
    winch: { kind: 'winch', lineFpmNoLoad: 18, partsOfLine: 2, ratedLinePullLb: 8000, ratedSlip: 0.04, mechEfficiency: 0.85, ratedVolts: 480, fullLoadAmps: 11, drumDiaIn: 12, drumWidthIn: 16, ropeDiaIn: 0.625 },
    ropeOnDrumAtZeroFt: 15,
  },
}

export const presetOf = (d: Pick<StageDesign, 'winch'>): LifterPreset => (d.winch.kind === 'hoist' ? 'chain' : 'winch')

/** ASSUMED: build-up, skins and spanners at 1.5 psf over the whole outline. */
const AUTO_ROOF_LOAD = 'roof-auto'

let counter = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export function blankDesign(name = 'New stage', preset: LifterPreset = 'chain', now = Date.now()): StageDesign {
  const p = LIFTERS[preset]
  return {
    id: newId('stage'),
    name,
    short: name.toUpperCase().slice(0, 16),
    source: 'Typed in',
    lift: p.lift,
    towers: [],
    adjacency: [],
    members: [],
    memberPlf: { main: 55, cross: 55 },
    areaLoads: [],
    pointLoads: [],
    loadBandKips: null,
    couplingLbPerIn: 300,
    winch: { ...p.winch },
    power: { supplyVolts: 480, feederOhmsPerKft: 1.24 },
    towerHeightFt: 60,
    maxTrimFt: 50,
    bumpIn: 1,
    tolerance: { warnIn: 4, stopIn: 8 },
    roof: { x0: 0, y0: 0, x1: 0, y1: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

/** Switch lifter type: swaps the spec and the per-tower rope, keeps everything measured. */
export function withLifter(d: StageDesign, preset: LifterPreset): StageDesign {
  const p = LIFTERS[preset]
  return { ...d, lift: p.lift, winch: { ...p.winch }, towers: d.towers.map((t) => ({ ...t, ropeOnDrumAtZeroFt: p.ropeOnDrumAtZeroFt })) }
}

export function newTower(d: StageDesign, x: number, y: number): Tower {
  const used = new Set(d.towers.map((t) => t.linkId))
  let n = 1
  while (used.has(n)) n++
  let k = d.towers.length + 1
  while (d.towers.some((t) => t.id === `T${k}`)) k++
  return { id: `T${k}`, label: String(n), linkId: n, x, y, feederFt: 0, ropeOnDrumAtZeroFt: LIFTERS[presetOf(d)].ropeOnDrumAtZeroFt }
}

/**
 * Everything that follows from the plan once towers and roof are placed: neighbour pairs, feeder
 * runs (ASSUMED: distro upstage center, cable along the deck), the roof build-up load over the outline.
 * Hand-drawn truss runs are kept; with none, runs go through every row and column.
 */
export function finishPlan(d: StageDesign, opts: { members?: 'keep' | 'auto' } = {}): StageDesign {
  const towers = d.towers
  const roof: Rect = d.roof.x1 > d.roof.x0 && d.roof.y1 > d.roof.y0 ? d.roof : autoRoof(towers)
  const cx = (roof.x0 + roof.x1) / 2
  const members = opts.members === 'auto' || !d.members.length ? autoMembers(towers, roof) : d.members
  // The build-up load over the outline follows the outline, unless the design has its own loads.
  const auto = { id: AUTO_ROOF_LOAD, label: 'Roof build-up + skins', ...roof, psf: 1.5 }
  return {
    ...d,
    roof,
    members,
    towers: towers.map((t) => (t.feederFt > 0 ? t : { ...t, feederFt: Math.round(75 + Math.abs(t.x - cx) + Math.max(0, t.y - roof.y0)) })),
    adjacency: gridAdjacency(towers, lineTolerance(towers)),
    areaLoads: !d.areaLoads.length ? [auto] : d.areaLoads.map((a) => (a.id === AUTO_ROOF_LOAD ? { ...a, ...roof } : a)),
    updatedAt: Date.now(),
  }
}
