import { describe, expect, it } from 'vitest'
import { demoRoof as rig } from '../model/examples/demo-roof'
import { analyzeLevel, corrections } from './level'

const flat = (h: number) => rig.towers.map(() => h)

describe('analyzeLevel', () => {
  it('rig has 12 towers and 16 adjacent pairs', () => {
    expect(rig.towers).toHaveLength(12)
    expect(rig.adjacency).toHaveLength(16)
  })

  it('level roof is ok', () => {
    const r = analyzeLevel(rig, flat(60))
    expect(r.status).toBe('ok')
    expect(r.spreadIn).toBe(0)
    expect(r.devIn.every((d) => d === 0)).toBe(true)
  })

  it('a pure tilt has zero plane deviation and the right slope', () => {
    const h = rig.towers.map((t) => 100 + 0.02 * t.x - 0.05 * t.y)
    const r = analyzeLevel(rig, h)
    expect(r.planeSlope.x).toBeCloseTo(0.02, 9)
    expect(r.planeSlope.y).toBeCloseTo(-0.05, 9)
    r.planeDevIn.forEach((d) => expect(d).toBeCloseTo(0, 9))
  })

  it('flags one low tower and its neighbors', () => {
    const h = flat(120)
    const i = rig.towers.findIndex((t) => t.id === 'DS3')
    h[i] -= 4
    const warn = analyzeLevel(rig, h)
    expect(warn.status).toBe('warn')
    expect(warn.towerStatus[i]).toBe('warn')
    expect(warn.towerStatus[rig.towers.findIndex((t) => t.id === 'US3')]).toBe('warn')
    expect(warn.towerStatus[rig.towers.findIndex((t) => t.id === 'US1')]).toBe('ok')
    h[i] -= 4
    const stop = analyzeLevel(rig, h)
    expect(stop.status).toBe('stop')
    expect(Math.abs(stop.worstPair!.diffIn)).toBe(8)
  })

  it('corrections level the roof', () => {
    const h = [10, 12, 14]
    expect(corrections(h, 'high')).toEqual([4, 2, 0])
    expect(corrections(h, 'low')).toEqual([0, -2, -4])
    expect(corrections(h, 'mean')).toEqual([2, 0, -2])
    expect(corrections([20, 20, 20, 27, 16, 20], 'median')).toEqual([0, 0, 0, -7, 4, 0])
  })
})

describe('towers without a height', () => {
  it('stay out of the average and every pair', () => {
    const h = flat(100)
    const known = rig.towers.map(() => true)
    const i = rig.towers.findIndex((t) => t.id === 'DS3')
    h[i] = 0
    known[i] = false
    const r = analyzeLevel(rig, h, rig.tolerance, known)
    expect(r.meanIn).toBe(100)
    expect(r.status).toBe('ok')
    expect(r.pairs.some((p) => p.a === 'DS3' || p.b === 'DS3')).toBe(false)
    expect(corrections(h, 'median', known)[i]).toBe(0)
  })
})
