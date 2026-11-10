import { describe, expect, it } from 'vitest'
import { demoRoof as rig } from '../model/examples/demo-roof'
import { analyzeLevel } from './level'
import { towerLoads } from './loads'
import { allSwitches, calibrate, forecast, learnFromSamples, runTravel, step, type SimModel, type Switch } from './sim'
import { drumLayer, winchSpeed, type WinchState } from './winch'

const base: WinchState = { towerLoadLb: 12000, heightIn: 60, feederFt: 100, ropeOnDrumAtZeroFt: 15, partsOfLine: 2, motors: 1, calibration: 1 }
const speed = (s: Partial<WinchState>, dir: 1 | -1 = 1) => winchSpeed(rig.winch, rig.power, { ...base, ...s }, dir)

describe('winchSpeed', () => {
  it('heavier is slower going up and faster coming down', () => {
    expect(speed({ towerLoadLb: 16000 }).roofFpm).toBeLessThan(speed({ towerLoadLb: 8000 }).roofFpm)
    expect(speed({ towerLoadLb: 16000 }, -1).roofFpm).toBeGreaterThan(speed({ towerLoadLb: 8000 }, -1).roofFpm)
  })

  it('8 vs 16 kips is a 1-3% speed difference', () => {
    const light = speed({ towerLoadLb: 8000 }).roofFpm, heavy = speed({ towerLoadLb: 16000 }).roofFpm
    const delta = (light - heavy) / light
    expect(delta).toBeGreaterThan(0.01)
    expect(delta).toBeLessThan(0.03)
  })

  it('16 kips is rated load: rated slip, rated pull', () => {
    const r = speed({ towerLoadLb: 16000, feederFt: 0 })
    expect(r.loadFraction).toBeCloseTo(1, 9)
    expect(r.slip).toBeCloseTo(rig.winch.ratedSlip, 9)
  })

  it('a long feeder sags the voltage and adds slip', () => {
    const near = speed({ feederFt: 50 }), far = speed({ feederFt: 400 })
    expect(far.motorVolts).toBeLessThan(near.motorVolts)
    expect(far.slip).toBeGreaterThan(near.slip)
    expect(far.roofFpm).toBeLessThan(near.roofFpm)
  })

  it('rope stacking onto the drum speeds the line up in steps', () => {
    expect(drumLayer(rig.winch, 10).layer).toBe(1)
    const high = drumLayer(rig.winch, 15 + 2 * 60)
    expect(high.layer).toBeGreaterThan(1)
    expect(high.factor).toBeGreaterThan(1.05)
  })
})

describe('sim', () => {
  const model: SimModel = { rig, staticLb: towerLoads(rig).towerLb, calibration: rig.towers.map(() => 1) }
  const level = rig.towers.map(() => 60)
  const idx = (id: string) => rig.towers.findIndex((t) => t.id === id)

  it('one second at ~9 fpm moves ~1.75 inches', () => {
    const h = step(model, level, 1, 1)
    h.forEach((v) => { expect(v - 60).toBeGreaterThan(1.6); expect(v - 60).toBeLessThan(1.9) })
  })

  it('going up 10 ft the heavy downstage towers fall behind', () => {
    const { heightsIn, seconds } = runTravel(model, level, 1, 120)
    expect(seconds).toBeGreaterThan(60)
    expect(heightsIn[idx('DS3')]).toBeLessThan(heightsIn[idx('US3')])
    const spread = analyzeLevel(rig, heightsIn).spreadIn
    expect(spread).toBeGreaterThan(0.5)
    expect(spread).toBeLessThan(12)
  })

  it('coming down the heavy towers lead', () => {
    const top = rig.towers.map(() => 400)
    const { heightsIn } = runTravel(model, top, -1, 120)
    expect(heightsIn[idx('DS3')]).toBeLessThan(heightsIn[idx('US3')])
  })

  it('clamps at the deck and at max trim', () => {
    expect(step(model, rig.towers.map(() => 0.5), -1, 5).every((v) => v === 0)).toBe(true)
    const trim = rig.maxTrimFt * 12
    expect(step(model, rig.towers.map(() => trim - 0.5), 1, 5).every((v) => v === trim)).toBe(true)
  })

  it('each winch follows its own switch: off holds, up and down run together', () => {
    const sw = allSwitches(12, 1)
    sw[idx('US2')] = 0
    sw[idx('DS5')] = -1
    const h = step(model, level, sw, 2)
    expect(h[idx('US2')]).toBe(60)
    expect(h[idx('US1')]).toBeGreaterThan(62)
    expect(h[idx('DS5')]).toBeLessThan(58)
    const solo: Switch[] = allSwitches(12, 0)
    solo[idx('DS4')] = 1
    const bump = runTravel(model, level, solo, 1)
    expect(bump.heightsIn[idx('DS4')] - 60).toBeGreaterThanOrEqual(1)
    expect(bump.heightsIn[idx('DS4')] - 60).toBeLessThan(1.5)
    expect(bump.heightsIn.filter((v) => v !== 60)).toHaveLength(1)
    expect(runTravel(model, level, allSwitches(12, 0), 6).seconds).toBe(0)
    expect(forecast(model, level, allSwitches(12, 0)).warnAfterIn).toBeNull()
  })

  it('forecasts warn before stop', () => {
    const f = forecast(model, level, 1)
    if (f.stopAfterIn !== null) expect(f.warnAfterIn).not.toBeNull()
    if (f.warnAfterIn !== null && f.stopAfterIn !== null) expect(f.warnAfterIn).toBeLessThanOrEqual(f.stopAfterIn)
  })

  it('calibration converges on a winch that really runs 5% slow', () => {
    const slow = idx('US2')
    const truth: SimModel = { ...model, calibration: model.calibration.map((c, i) => (i === slow ? 0.95 : c)) }
    let cal = [...model.calibration]
    let h = level
    for (let stop = 0; stop < 4; stop++) {
      const predicted = runTravel({ ...model, calibration: cal }, h, 1, 96).heightsIn
      const measured = runTravel(truth, h, 1, 96).heightsIn
      cal = calibrate(cal, h, predicted, measured)
      h = measured
    }
    const others = cal.filter((_, i) => i !== slow)
    const ref = others.reduce((s, v) => s + v, 0) / others.length
    expect(cal[slow] / ref).toBeCloseTo(0.95, 2)
  })

  it('calibration ignores short moves and lone readings', () => {
    const cal = model.calibration
    expect(calibrate(cal, level, level.map((v) => v + 5), level.map((v) => v + 6))).toBe(cal)
    const lone = level.map((v, i) => (i === 0 ? v + 50 : null))
    expect(calibrate(cal, level, level.map((v) => v + 48), lone)).toBe(cal)
  })
})

describe('learnFromSamples', () => {
  const staticLb = towerLoads(rig).towerLb
  const model: SimModel = { rig, staticLb, calibration: rig.towers.map(() => 1) }

  it('learns which towers really run fast or slow from a recorded run', () => {
    // A pretend real lift: the model's own speeds, with tower 0 really 6% quick and tower 1 4% slow.
    const truth = rig.towers.map((_, i) => (i === 0 ? 1.06 : i === 1 ? 0.96 : 1))
    const real: SimModel = { ...model, calibration: truth }
    let h = rig.towers.map(() => 0)
    const samples: number[][] = [h]
    for (let k = 0; k < 120; k++) samples.push((h = step(real, h, 1, 1)))
    const learned = learnFromSamples(model, samples)!
    const norm = truth.reduce((s, v) => s + v, 0) / truth.length
    learned.forEach((c, i) => expect(c).toBeCloseTo(truth[i] / norm, 2))
  })

  it('ignores bumps, idle time and towers without a reading', () => {
    const idle = rig.towers.map(() => 50)
    const bump = idle.map((v, i) => (i === 3 ? v + 2 : v))
    const gap = idle.map((v, i) => (i === 5 ? null : v + 30))
    expect(learnFromSamples(model, [idle, idle, bump, idle, gap])).toBeNull()
  })
})
