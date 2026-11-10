import { useMemo } from 'react'
import { analyzeLevel } from '../lib/level'
import { STALE_MS, useLink, type LiveTower } from '../hw/link'
import { useDesign } from '../model/library'
import type { StageDesign } from '../model/types'
import { useField, type Tape } from './store'

// Where each tower's height comes from, best first: its laser right now; otherwise whichever is newer
// of its last laser reading and a tape measurement; otherwise nothing yet.

export type Source = 'live' | 'stale' | 'tape' | 'none'

export interface Reading {
  in: number | null
  source: Source
  /** Date.now() of the reading shown. */
  at: number | null
  /** What the tower's controller last said, if it ever reported. */
  report: LiveTower | null
}

export function readTowers(design: StageDesign, reports: Record<number, LiveTower>, tape: Record<string, Tape> | undefined, now: number): Reading[] {
  return design.towers.map((t) => {
    const r = reports[t.linkId] ?? null
    const laser = r && r.s !== 'nosensor' ? r : null
    // The deck is the floor: a hair of laser noise below it reads as on the deck.
    if (laser && now - laser.at < STALE_MS) return { in: Math.max(0, laser.h), source: 'live', at: laser.at, report: r }
    const tp = tape?.[t.id]
    if (tp && (!laser || tp.at >= laser.at)) return { in: tp.in, source: 'tape', at: tp.at, report: r }
    if (laser) return { in: Math.max(0, laser.h), source: 'stale', at: laser.at, report: r }
    return { in: null, source: 'none', at: null, report: r }
  })
}

/** The active design and everything the field screen shows about it, refreshed with the link's 10 Hz snapshot. */
export function useFieldData() {
  const design = useDesign()
  const reports = useLink((s) => s.towers)
  const linked = useLink((s) => s.status === 'live')
  const tape = useField((s) => s.tape[design.id])
  const readings = useMemo(() => readTowers(design, reports, tape, Date.now()), [design, reports, tape, linked])
  const known = useMemo(() => readings.map((r) => r.in !== null), [readings])
  const report0 = useMemo(() => {
    const raw = readings.map((r) => r.in ?? 0)
    const rep = analyzeLevel(design, raw, design.tolerance, known)
    // Towers with no height yet are drawn at the average so they don't drag the roof to the deck.
    return { rep, heightsIn: raw.map((h, i) => (known[i] ? h : rep.meanIn)) }
  }, [design, readings, known])
  const liveCount = readings.filter((r) => r.source === 'live').length
  return { design, readings, known, heightsIn: report0.heightsIn, report: report0.rep, linked, liveCount }
}
