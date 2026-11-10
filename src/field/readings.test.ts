import { describe, expect, it } from 'vitest'
import { exampleDesign, scaleModel } from '../model/examples'
import type { LiveTower } from '../hw/link'
import { readTowers } from './readings'

const d = exampleDesign(scaleModel, 0)
const report = (h: number, at: number, extra: Partial<LiveTower> = {}): LiveTower => ({ h, mm: 0, s: 'idle', d: 0, q: 0, max: 0, mon: true, via: 0, at, ...extra })

describe('readTowers', () => {
  const now = 100_000

  it('a fresh laser reading wins over a tape', () => {
    const r = readTowers(d, { 1: report(120, now - 200) }, { DS1: { in: 100, at: now - 100 } }, now)
    expect(r[0]).toMatchObject({ in: 120, source: 'live' })
  })

  it('without a fresh reading, the newer of tape and last laser reading', () => {
    expect(readTowers(d, { 1: report(120, now - 5000) }, { DS1: { in: 100, at: now - 1000 } }, now)[0]).toMatchObject({ in: 100, source: 'tape' })
    expect(readTowers(d, { 1: report(120, now - 5000) }, { DS1: { in: 100, at: now - 9000 } }, now)[0]).toMatchObject({ in: 120, source: 'stale' })
  })

  it('towers find their reports by laser number, not by position', () => {
    const moved = { ...d, towers: d.towers.map((t, i) => ({ ...t, linkId: [7, 8, 9, 10][i] })) }
    const r = readTowers(moved, { 1: report(50, now), 9: report(80, now) }, undefined, now)
    expect(r.map((x) => x.in)).toEqual([null, null, 80, null])
  })

  it('a controller with no laser gives no height; noise below the deck reads as the deck', () => {
    const r = readTowers(d, { 1: report(40, now, { s: 'nosensor' }), 2: report(-0.1, now) }, undefined, now)
    expect(r[0]).toMatchObject({ in: null, source: 'none' })
    expect(r[1]).toMatchObject({ in: 0, source: 'live' })
  })
})
