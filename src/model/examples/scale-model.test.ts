import { describe, expect, it } from 'vitest'
import { towerLoads } from '../../lib/loads'
import { readouts, runTravel } from '../../lib/sim'
import { scaleModel as rig } from './scale-model'

describe('scale model rig', () => {
  const staticLb = towerLoads(rig).towerLb
  const model = { rig, staticLb, calibration: rig.towers.map(() => 1) }

  it('four towers on the grid, each with two neighbours', () => {
    expect(rig.towers).toHaveLength(4)
    expect(rig.adjacency).toHaveLength(4)
  })

  it('a light frame: well under the motors, but not weightless', () => {
    const total = staticLb.reduce((s, v) => s + v, 0)
    expect(total).toBeGreaterThan(1)
    expect(total).toBeLessThan(5)
    for (const r of readouts(model, [0, 0, 0, 0], 1)) expect(r.loadFraction).toBeLessThan(0.6)
  })

  it('a full-height run takes tens of seconds, not minutes', () => {
    const { seconds } = runTravel(model, [0, 0, 0, 0], 1, rig.maxTrimFt * 12)
    expect(seconds).toBeGreaterThan(15)
    expect(seconds).toBeLessThan(120)
  })
})
