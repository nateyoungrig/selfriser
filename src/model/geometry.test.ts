import { describe, expect, it } from 'vitest'
import { autoMembers, crewNumbering, gridAdjacency, squareUp } from './geometry'
import { demoRoof, exampleDesign } from './examples'
import { blankDesign, finishPlan, newTower } from './defaults'
import type { Tower } from './types'

const t = (id: string, x: number, y: number): Tower => ({ id, label: id, linkId: 0, x, y, feederFt: 0, ropeOnDrumAtZeroFt: 0 })

describe('towers tapped onto a drawing', () => {
  // Two rows of three, placed by hand a few inches off.
  const tapped = [t('a', 0.2, 40.1), t('b', 50, 39.8), t('c', 99.7, 40.3), t('d', -0.1, 0), t('e', 50.3, 0.2), t('f', 100, -0.2)]

  it('square up onto shared rows and columns', () => {
    const sq = squareUp(tapped)
    expect(new Set(sq.map((x) => x.y)).size).toBe(2)
    expect(new Set(sq.map((x) => x.x)).size).toBe(3)
  })

  it('number the way crews call them: downstage row first, stage right to left', () => {
    const n = crewNumbering(tapped)
    expect(n.map((x) => [x.id, x.label, x.linkId])).toEqual([['a', '1', 1], ['b', '2', 2], ['c', '3', 3], ['d', '4', 4], ['e', '5', 5], ['f', '6', 6]])
  })

  it('pair neighbours along rows and columns, and run truss through them out to the roof edge', () => {
    const sq = squareUp(tapped)
    expect(gridAdjacency(sq)).toHaveLength(7)
    const roof = { x0: -5, y0: -3, x1: 105, y1: 60 }
    const runs = autoMembers(sq, roof)
    expect(runs).toHaveLength(5)
    // Rows reach both roof ends; columns reach upstage and the downstage cantilever.
    for (const m of runs.filter((r) => r.kind === 'main')) expect([m.a[0], m.b[0]]).toEqual([-5, 105])
    for (const m of runs.filter((r) => r.kind === 'cross')) expect([m.a[1], m.b[1]]).toEqual([-3, 60])
  })
})

describe('designs', () => {
  it('a hand-measured example comes out of finishPlan with the same neighbours', () => {
    expect(finishPlan(exampleDesign(demoRoof, 0)).adjacency).toEqual(demoRoof.adjacency)
  })

  it('a new tower takes the next free laser number', () => {
    let d = blankDesign('x')
    for (const [x, y] of [[0, 0], [10, 0], [20, 0]]) d = { ...d, towers: [...d.towers, newTower(d, x, y)] }
    d = { ...d, towers: d.towers.filter((x) => x.linkId !== 2) }
    expect(newTower(d, 30, 0).linkId).toBe(2)
  })
})
