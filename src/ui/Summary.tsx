import type { ReactNode } from 'react'
import type { LevelReport } from '../lib/level'
import type { Rig } from '../model/types'
import { formatCompact, formatDeltaCompact } from '../lib/units'

const STATUS_TEXT = { ok: 'LEVEL', warn: 'WATCH', stop: 'STOP' } as const

/** One fixed-height status row: nothing here appears or disappears, so nothing below it moves. */
export function Summary({ rig, report, empty, children }: { rig: Rig; report: LevelReport; empty?: boolean; children?: ReactNode }) {
  const label = (id: string) => rig.towers.find((t) => t.id === id)?.label ?? id
  const worst = report.worstPair
  return (
    <div className="summary">
      <div className={`chip ${empty ? 'none' : report.status}`}>{empty ? 'NO DATA' : STATUS_TEXT[report.status]}</div>
      <div className="stat"><label>AVG</label><b>{empty ? '-' : formatCompact(report.meanIn)}</b></div>
      <div className="stat"><label>HI-LO</label><b>{empty ? '-' : formatDeltaCompact(report.spreadIn).replace('+', '')}</b></div>
      <div className="stat"><label>WORST PAIR</label><b className={worst?.status}>{worst ? `${label(worst.a)}-${label(worst.b)} ${formatDeltaCompact(Math.abs(worst.diffIn)).replace('+', '')}` : '-'}</b></div>
      {children}
    </div>
  )
}
