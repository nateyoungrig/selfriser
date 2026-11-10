import type { Rig, RoofMember, Tower } from '../types'
import { gridAdjacency } from '../geometry'

// A made-up full-size roof to show the app with: twelve winch towers on round numbers, not any real
// stage. Swap in your own by importing a drawing (Stage designs → FROM A DRAWING) or editing this one.
// Everything here is a plausible starting guess to be corrected under Lab → Sim settings.

// Six tower lines 40' apart across a 240' roof, stage right -> stage left.
const ROOF_X0 = 0
const ROOF_X1 = 240
const TOWER_X = [20, 60, 100, 140, 180, 220]
// Two tower rows 40' apart; the roof runs 6' past the upstage row and cantilevers 26' downstage.
const US_Y = 0
const DS_Y = 40
const ROOF_Y0 = -6
const ROOF_Y1 = DS_Y + 26

// Winches are numbered the way crews call them: 1-6 downstage, 7-12 upstage, SR -> SL.
const towers: Tower[] = [
  ...TOWER_X.map((x, i) => tower(`DS${i + 1}`, `${i + 1}`, x, DS_Y)),
  ...TOWER_X.map((x, i) => tower(`US${i + 1}`, `${i + 7}`, x, US_Y)),
]

function tower(id: string, label: string, x: number, y: number): Tower {
  // Distro upstage center; the feeder follows the truss out to each winch.
  const feederFt = Math.round(75 + Math.abs(x - ROOF_X1 / 2) + (y - US_Y))
  return { id, label, linkId: Number(label), x, y, feederFt, ropeOnDrumAtZeroFt: 15 }
}

const members: RoofMember[] = [
  { id: 'main-us', kind: 'main', a: [ROOF_X0, US_Y], b: [ROOF_X1, US_Y] },
  { id: 'main-ds', kind: 'main', a: [ROOF_X0, DS_Y], b: [ROOF_X1, DS_Y] },
  ...[ROOF_X0 + 2, ...TOWER_X, ROOF_X1 - 2].map((x, i): RoofMember => ({ id: `cross-${i + 1}`, kind: 'cross', a: [x, ROOF_Y0], b: [x, ROOF_Y1] })),
]

export const demoRoof: Rig = {
  id: 'demo-roof',
  name: 'Demo roof - 12 towers',
  short: 'DEMO',
  source: 'Made-up example (round numbers, not a real stage)',
  lift: 'winch',
  towers,
  adjacency: gridAdjacency(towers),
  members,
  // Box truss runs including sleeve blocks, braces and pins.
  memberPlf: { main: 70, cross: 55 },
  areaLoads: [
    { id: 'roof', label: 'Roof build-up + skins', x0: TOWER_X[1], y0: ROOF_Y0, x1: TOWER_X[4], y1: ROOF_Y1, psf: 3 },
    { id: 'spanners', label: 'Spanner + motor sub-grid', x0: TOWER_X[0], y0: US_Y, x1: TOWER_X[5], y1: ROOF_Y1, psf: 1.5 },
  ],
  pointLoads: [
    // PA hung off the downstage corners.
    { id: 'pa-sr', label: 'SR PA', x: ROOF_X0, y: ROOF_Y1, lbs: 4000 },
    { id: 'pa-sl', label: 'SL PA', x: ROOF_X1, y: ROOF_Y1, lbs: 4000 },
  ],
  // No winch should start above 85% of its rating (4 ton x 2 parts = 16 kips), so the band tops out at 13.5.
  loadBandKips: [8, 13.5],
  couplingLbPerIn: 300,
  winch: {
    // A 4-ton pulley winch per tower on two parts of rope.
    kind: 'winch',
    lineFpmNoLoad: 18,
    partsOfLine: 2,
    ratedLinePullLb: 8000,
    ratedSlip: 0.04,
    mechEfficiency: 0.85,
    ratedVolts: 480,
    fullLoadAmps: 11,
    drumDiaIn: 12,
    drumWidthIn: 16,
    ropeDiaIn: 0.625,
  },
  power: { supplyVolts: 480, feederOhmsPerKft: 1.24 },
  towerHeightFt: 70,
  maxTrimFt: 62,
  bumpIn: 1,
  // Watch at 4", stop at 8" between neighbouring towers.
  tolerance: { warnIn: 4, stopIn: 8 },
}
