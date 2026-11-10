// A stage design is pure data: everything the app knows about one roof system. Designs are user data
// now (imported from a drawing, typed in, or one of the shipped examples) and live on the device.
// Plan coordinates are in feet: x runs stage right -> stage left, y runs upstage -> downstage.
// Heights are always carried in inches everywhere else in the app.

export interface WinchSpec {
  /** Rope on a drum (line speed climbs a step per layer) or chain through a hoist (constant). */
  kind: 'winch' | 'hoist'
  /** Line (or chain) speed at synchronous (no-load) motor speed on the first drum layer, ft/min. */
  lineFpmNoLoad: number
  /** Parts of line supporting the roof at each tower (2 for a pulley winch or double-reeve block). A tower can override. */
  partsOfLine: number
  /** Rated line pull, lb. */
  ratedLinePullLb: number
  /** Motor slip at rated load and rated voltage (0.04 = 4%). */
  ratedSlip: number
  /** Gear train + sheave efficiency. Hoisting torque ~ load/eff, lowering ~ load*eff. */
  mechEfficiency: number
  ratedVolts: number
  /** Motor full-load amps at rated voltage. */
  fullLoadAmps: number
  drumDiaIn: number
  drumWidthIn: number
  ropeDiaIn: number
}

export interface PowerSpec {
  /** Line-to-line voltage at the distro under load. */
  supplyVolts: number
  /** Feeder conductor resistance, ohms per 1000 ft (e.g. #10 Cu = 1.24, #8 = 0.78, #6 = 0.49). */
  feederOhmsPerKft: number
}

export interface Tower {
  id: string
  label: string
  /** The number set on this tower's laser controller ("tower 3" on its console). */
  linkId: number
  x: number
  y: number
  /** One-way cable run from distro to this winch, ft. */
  feederFt: number
  /** Rope already on the drum with the roof sitting at height 0, ft. */
  ropeOnDrumAtZeroFt: number
  /** Parts of line at this tower when it differs from the rig's lifter (single vs double reeve). */
  partsOfLine?: number
  /** Lifters sharing this tower's load (two chain motors on one sleeve block). Default 1. */
  motors?: number
  /** Known static load (engineering reaction or load cell), lb. Wins over the estimate. */
  loadLb?: number
}

export interface RoofMember {
  id: string
  kind: string
  a: [number, number]
  b: [number, number]
}

export interface AreaLoad {
  id: string
  label: string
  x0: number
  y0: number
  x1: number
  y1: number
  psf: number
}

export interface PointLoad {
  id: string
  label: string
  x: number
  y: number
  lbs: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Rig {
  id: string
  name: string
  /** Short name for the stage picker. */
  short: string
  source: string
  /** What the crew calls the thing that lifts each tower. */
  lift: 'winch' | 'motor'
  towers: Tower[]
  /** Tower id pairs whose height differential matters (neighbors that share a truss run). */
  adjacency: [string, string][]
  members: RoofMember[]
  /** Self-weight per foot for each member kind, lb/ft. */
  memberPlf: Record<string, number>
  areaLoads: AreaLoad[]
  pointLoads: PointLoad[]
  /** If set, estimated tower loads are rescaled so the lightest/heaviest land on this band. */
  loadBandKips: [number, number] | null
  /** How much load a tower picks up per inch it rides above its neighbors, lb/in. */
  couplingLbPerIn: number
  winch: WinchSpec
  power: PowerSpec
  towerHeightFt: number
  maxTrimFt: number
  /** Travel of one tap on a winch's local UP / DOWN switch, inches (Lab). */
  bumpIn: number
  tolerance: { warnIn: number; stopIn: number }
  /** Display precision, 1/denom inch (the scale model wants eighths). */
  displayDenom?: number
  /**
   * Lab only: the app may drive this rig's motors through the hub. Only ever a bench model: on a real
   * roof the hoists stay on their own rated controls and a linked hub is monitor only.
   */
  hardwareControl?: boolean
}

/** Where a design came from on paper, so the plan can be redrawn under the roof and edited again. */
export interface Drawing {
  fileName: string
  /** Blob store key of the original PDF (kept on this device only). */
  pdfKey: string
  /** 1-based page holding the plan view. */
  page: number
  /** Page rotation that puts upstage at the top. */
  rotation: 0 | 90 | 180 | 270
  /** Drawing points (1/72") per real foot on that page. Plan feet = rotated page points / ptPerFt. */
  ptPerFt: number
  /** Pre-rendered plan under the roof in the 3D view: blob key and its extent in plan feet. */
  underlay?: { key: string } & Rect
}

export interface StageDesign extends Rig {
  venue?: string
  /** Roof outline in plan, ft. */
  roof: Rect
  drawing?: Drawing
  /** Shipped example this design was seeded from. */
  example?: string
  createdAt: number
  updatedAt: number
}
