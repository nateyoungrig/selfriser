import type { PowerSpec, WinchSpec } from '../model/types'

export type Direction = 1 | -1

export interface WinchState {
  /** Load this tower's lines are carrying, lb. */
  towerLoadLb: number
  /** Roof height at this tower, inches. */
  heightIn: number
  feederFt: number
  ropeOnDrumAtZeroFt: number
  /** Parts of line at this tower. */
  partsOfLine: number
  /** Motors sharing the tower load; each sees load / motors. */
  motors: number
  /** Learned from field measurements; 1 = behaves like the model. */
  calibration: number
}

export interface WinchReadout {
  roofFpm: number
  linePullLb: number
  loadFraction: number
  motorVolts: number
  slip: number
  drumLayer: number
  layerFactor: number
}

/** Which drum layer the rope is on and how much faster that layer pays than the first. */
export function drumLayer(spec: WinchSpec, ropeOnDrumFt: number): { layer: number; factor: number } {
  const wraps = Math.max(1, Math.floor(spec.drumWidthIn / spec.ropeDiaIn))
  // Pitch diameter of layer n; layers nest into the grooves of the one below (~0.866 d rise).
  const pitchDia = (n: number) => spec.drumDiaIn + spec.ropeDiaIn + 2 * (n - 1) * 0.866 * spec.ropeDiaIn
  let remainingIn = Math.max(0, ropeOnDrumFt) * 12
  let layer = 1
  while (remainingIn > wraps * Math.PI * pitchDia(layer) && layer < 50) {
    remainingIn -= wraps * Math.PI * pitchDia(layer)
    layer++
  }
  return { layer, factor: pitchDia(layer) / pitchDia(1) }
}

/**
 * Roof speed at one tower for a fixed-speed 3-phase winch.
 *
 *  - Induction motor slip is ~proportional to torque and to 1/V^2, so a heavy tower on a long
 *    feeder turns slower than a light one near the distro.
 *  - Hoisting, the motor fights load + friction (torque ~ load/eff) and runs below synchronous.
 *    Lowering, the load overhauls the motor (torque ~ load*eff) and it runs *above* synchronous:
 *    heavy towers lag going up and lead coming down.
 *  - Rope stacking onto the drum raises line speed a step per layer.
 */
export function winchSpeed(spec: WinchSpec, power: PowerSpec, s: WinchState, dir: Direction): WinchReadout {
  const linePullLb = s.towerLoadLb / s.motors / s.partsOfLine
  const loadFraction = linePullLb / spec.ratedLinePullLb
  // Rated slip is quoted hoisting rated load, friction included.
  const torqueFraction = dir === 1 ? loadFraction : loadFraction * spec.mechEfficiency ** 2

  // Feeder drop: current has a magnetizing floor and climbs with torque. Two passes settle it.
  let motorVolts = power.supplyVolts
  for (let pass = 0; pass < 2; pass++) {
    const amps = spec.fullLoadAmps * (0.35 + 0.65 * torqueFraction) * (spec.ratedVolts / motorVolts)
    const drop = Math.sqrt(3) * amps * (power.feederOhmsPerKft / 1000) * s.feederFt
    motorVolts = Math.max(power.supplyVolts * 0.5, power.supplyVolts - drop)
  }

  const slip = Math.min(0.5, spec.ratedSlip * torqueFraction * (spec.ratedVolts / motorVolts) ** 2)
  // A chain hoist has no drum: its chain speed never steps.
  const ropeOnDrumFt = s.ropeOnDrumAtZeroFt + (s.partsOfLine * s.heightIn) / 12
  const { layer, factor } = spec.kind === 'hoist' ? { layer: 1, factor: 1 } : drumLayer(spec, ropeOnDrumFt)

  const lineFpm = spec.lineFpmNoLoad * (1 - dir * slip) * factor * s.calibration
  return { roofFpm: lineFpm / s.partsOfLine, linePullLb, loadFraction, motorVolts, slip, drumLayer: layer, layerFactor: factor }
}
