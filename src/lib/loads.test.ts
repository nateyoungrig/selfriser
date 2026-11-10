import { describe, expect, it } from 'vitest'
import { demoRoof as rig } from '../model/examples/demo-roof'
import { coupledLoads, discretizeLoads, towerLoads } from './loads'
import { shapeFunctions } from './surface'

const idx = (id: string) => rig.towers.findIndex((t) => t.id === id)

describe('shapeFunctions', () => {
  it('keeps force and moment equilibrium anywhere, including the cantilevers', () => {
    for (const [x, y] of [[0, -5], [120, 20], [240, 66], [60, 50], [90, 62]]) {
      const phi = shapeFunctions(rig.towers, x, y)
      expect(phi.reduce((s, f) => s + f, 0)).toBeCloseTo(1, 9)
      expect(phi.reduce((s, f, i) => s + f * rig.towers[i].x, 0)).toBeCloseTo(x, 5)
      expect(phi.reduce((s, f, i) => s + f * rig.towers[i].y, 0)).toBeCloseTo(y, 5)
    }
  })

  it('a load at a tower goes to that tower', () => {
    const t = rig.towers[idx('US4')]
    expect(shapeFunctions(rig.towers, t.x, t.y)[idx('US4')]).toBeGreaterThan(0.99)
  })

  it('a downstage cantilever load levers onto DS and off US', () => {
    const t = rig.towers[idx('DS3')]
    const phi = shapeFunctions(rig.towers, t.x, t.y + 25)
    expect(phi[idx('DS3')]).toBeGreaterThan(1)
    expect(phi[idx('US3')]).toBeLessThan(0)
  })
})

describe('towerLoads', () => {
  it('raw estimate conserves total weight', () => {
    const total = discretizeLoads(rig).reduce((s, p) => s + p.lbs, 0)
    const r = towerLoads(rig, { loadBandKips: null })
    expect(r.totalLb).toBeCloseTo(total, 3)
  })

  it('downstage towers carry more than their upstage partners', () => {
    const r = towerLoads(rig, { loadBandKips: null })
    for (let n = 1; n <= 6; n++) expect(r.towerLb[idx(`DS${n}`)]).toBeGreaterThan(r.towerLb[idx(`US${n}`)])
  })

  it('band fit lands on the rig band, overrides win, and nobody starts above 85% of winch rating', () => {
    const r = towerLoads(rig, { towerLb: { US1: 9500 } })
    const others = r.towerLb.filter((_, i) => i !== idx('US1'))
    expect(Math.max(...r.towerLb)).toBeCloseTo(rig.loadBandKips![1] * 1000, 6)
    expect(Math.max(...r.towerLb) / (rig.winch.ratedLinePullLb * rig.winch.partsOfLine)).toBeLessThanOrEqual(0.85)
    expect(Math.min(...others)).toBeGreaterThanOrEqual(8000 - 1e-6)
    expect(r.towerLb[idx('US1')]).toBe(9500)
  })
})

describe('coupledLoads', () => {
  const staticLb = rig.towers.map(() => 12000)
  it('level roof leaves loads alone', () => {
    expect(coupledLoads(rig, staticLb, rig.towers.map(() => 100))).toEqual(staticLb)
  })
  it('a high tower picks up load, total is conserved', () => {
    const h = rig.towers.map(() => 100)
    h[idx('DS2')] += 4
    const loads = coupledLoads(rig, staticLb, h)
    expect(loads[idx('DS2')]).toBeGreaterThan(12000 + 900)
    expect(loads[idx('DS1')]).toBeLessThan(12000)
    expect(loads.reduce((s, v) => s + v, 0)).toBeCloseTo(12 * 12000, 6)
  })
})
