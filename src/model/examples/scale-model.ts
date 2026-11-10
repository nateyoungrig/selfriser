import type { Rig, RoofMember, Tower } from '../types'
import { gridAdjacency } from '../geometry'

// The tabletop scale model (Lab): a wooden frame on four legs, each lifted by a small gearmotor spooling
// line over a pulley at the top of its leg, with a laser under every sleeve and a controller per
// tower (hardware/README.md). A four-tower box like a small full-size roof, so everything learned on it carries over.
// Dimensions are the model's own, in feet like every other rig; change them to what you build.
// Anything marked ASSUMED is a starting guess to be corrected under Lab → Sim settings once the model runs.

const IN = 1 / 12

// Leg centers 24" x 18"; the frame is 1x2 pine with 1" overhang past each leg.
const SR_X = 0
const SL_X = 24 * IN
const US_Y = 0
const DS_Y = 18 * IN
const ROOF_X0 = SR_X - IN
const ROOF_X1 = SL_X + IN
const ROOF_Y0 = US_Y - IN
const ROOF_Y1 = DS_Y + IN
const MID_X = (SR_X + SL_X) / 2

// Numbered like a full-size roof: 1-2 downstage SR -> SL, 3-4 upstage. The tower number is also what
// each controller is set to ("tower 1" on its console).
const towers: Tower[] = [
  tower('DS1', '1', SR_X, DS_Y), tower('DS2', '2', SL_X, DS_Y),
  tower('US1', '3', SR_X, US_Y), tower('US2', '4', SL_X, US_Y),
]

function tower(id: string, label: string, x: number, y: number): Tower {
  // ASSUMED: the 5 V bus runs up the middle, about 18" of 24 AWG to each driver; 2 ft of line
  // already on the spool with the frame on the deck.
  return { id, label, linkId: Number(label), x, y, feederFt: 1.5, ropeOnDrumAtZeroFt: 2 }
}

const members: RoofMember[] = [
  { id: 'frame-us', kind: 'frame', a: [ROOF_X0, US_Y], b: [ROOF_X1, US_Y] },
  { id: 'frame-ds', kind: 'frame', a: [ROOF_X0, DS_Y], b: [ROOF_X1, DS_Y] },
  { id: 'frame-sr', kind: 'frame', a: [SR_X, ROOF_Y0], b: [SR_X, ROOF_Y1] },
  { id: 'frame-c', kind: 'frame', a: [MID_X, ROOF_Y0], b: [MID_X, ROOF_Y1] },
  { id: 'frame-sl', kind: 'frame', a: [SL_X, ROOF_Y0], b: [SL_X, ROOF_Y1] },
]

export const scaleModel: Rig = {
  id: 'scale-model',
  name: 'Scale model - 4 towers',
  short: 'SCALE MODEL',
  source: 'hardware/README.md (tabletop build)',
  lift: 'motor',
  towers,
  adjacency: gridAdjacency(towers, 0.05),
  members,
  // 1x2 pine is about 0.2 lb/ft.
  memberPlf: { frame: 0.2 },
  areaLoads: [
    // ASSUMED: a hardboard or foam-board deck skin, about 0.3 psf.
    { id: 'skin', label: 'Roof skin', x0: ROOF_X0, y0: ROOF_Y0, x1: ROOF_X1, y1: ROOF_Y1, psf: 0.3 },
  ],
  pointLoads: [
    // Hang washers or fishing weights here to feel the PA corner lag. 0 until you do.
    { id: 'pa-sr', label: 'SR corner weight', x: SR_X, y: ROOF_Y1, lbs: 0 },
    { id: 'pa-sl', label: 'SL corner weight', x: SL_X, y: ROOF_Y1, lbs: 0 },
  ],
  loadBandKips: null,
  // ASSUMED: a light wood frame twists easily; a corner riding 1" high picks up about half a pound.
  couplingLbPerIn: 0.5,
  winch: {
    // N20 worm-gear motor, 6 V, ~30 rpm, driving a 3/4" spool of 0.5 mm braided line: the spool
    // stacks layers like a real winch drum. Speed, slip and pull ASSUMED from typical datasheets;
    // time a full-height run and set the line speed from it.
    kind: 'winch',
    lineFpmNoLoad: 6,
    partsOfLine: 1,
    ratedLinePullLb: 2,
    // A small brushed motor slows a lot more under load than a 3-phase winch.
    ratedSlip: 0.2,
    // Worm gears are inefficient, which is also why they hold the load with the power off.
    mechEfficiency: 0.4,
    ratedVolts: 6,
    fullLoadAmps: 0.25,
    drumDiaIn: 0.75,
    drumWidthIn: 0.4,
    ropeDiaIn: 0.02,
  },
  // One 5 V supply for the whole model (6 V motors run a little slow on it); 24 AWG is about 26 ohm per 1000 ft.
  power: { supplyVolts: 5, feederOhmsPerKft: 26 },
  towerHeightFt: 3,
  maxTrimFt: 30 * IN,
  bumpIn: 0.125,
  // Scaled from the full-size 3" / 6" by roughly 1:24, the frame against a 50' x 40' four-tower roof.
  tolerance: { warnIn: 0.25, stopIn: 0.5 },
  displayDenom: 8,
  hardwareControl: true,
}
