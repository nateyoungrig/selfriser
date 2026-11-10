import type { ReactNode } from 'react'
import { corrections, type LevelReport, type LevelTarget } from '../lib/level'
import { formatDeltaCompact } from '../lib/units'
import { useUi } from '../app/ui'
import type { Rig } from '../model/types'
import { STATUS_COLOR } from '../ui/colors'

const TARGETS: [LevelTarget, string][] = [['median', 'FEWEST MOVES'], ['high', 'TO HIGH'], ['mean', 'TO AVG'], ['low', 'TO LOW']]

export interface LevelProps {
  rig: Rig
  heightsIn: number[]
  known: boolean[]
  report: LevelReport
  /** Seconds on the button for a tower to travel inches (the Lab knows from its winch model). */
  seconds?: (i: number, inches: number) => number
  /** Lab: buttons that act on the list. */
  actions?: (fix: number[], target: LevelTarget) => ReactNode
}

/** Bump list: what to bump which way to bring the roof level, and every neighbouring pair. */
export function LevelSheet({ rig, heightsIn, known, report, seconds, actions }: LevelProps) {
  const target = useUi((s) => s.levelTarget)
  const fix = corrections(heightsIn, target, known)
  const label = (id: string) => rig.towers.find((t) => t.id === id)?.label ?? id
  const missing = rig.towers.filter((_, i) => !known[i]).map((t) => t.label)

  const bumps = rig.towers
    .map((t, i) => ({ t, i, inches: fix[i] }))
    .filter((b) => Math.abs(b.inches) >= 0.125)
    .sort((a, b) => Math.abs(b.inches) - Math.abs(a.inches))

  return (
    <div className="panel">
      <h3>Bump list</h3>
      <div className="seg">
        {TARGETS.map(([v, text]) => <button key={v} className={target === v ? 'on' : ''} onClick={() => useUi.setState({ levelTarget: v })}>{text}</button>)}
      </div>
      {missing.length > 0 && <p className="hint bad">No height for tower {missing.join(', ')}: left out of the list until its laser reports or someone tapes it.</p>}
      {!bumps.length && <p className="hint">{known.some(Boolean) ? 'Dead level. Nothing to bump.' : 'No heights yet.'}</p>}
      <table>
        <tbody>
          {bumps.map(({ t, i, inches }) => (
            <tr key={t.id}>
              <td><span className="winch-num">{t.label}</span></td>
              <td>{inches > 0 ? '▲ up' : '▼ down'}</td>
              <td><b>{formatDeltaCompact(Math.abs(inches)).replace('+', '')}</b></td>
              {seconds && <td className="dim">≈ {(() => { const s = seconds(i, inches); return s < 10 ? s.toFixed(1) : Math.round(s) })()} s on the button</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {bumps.length > 0 && actions && <div className="row">{actions(fix, target)}</div>}

      <h3>Neighbouring towers</h3>
      <p className="hint">Differential between neighbours is what racks a sleeve block. Watch at {formatDeltaCompact(rig.tolerance.warnIn).replace('+', '')}, stop at {formatDeltaCompact(rig.tolerance.stopIn).replace('+', '')}.</p>
      <table>
        <tbody>
          {[...report.pairs].sort((a, b) => Math.abs(b.diffIn) - Math.abs(a.diffIn)).map((p) => (
            <tr key={`${p.a}-${p.b}`}>
              <td><i className="dot" style={{ background: STATUS_COLOR[p.status] }} /> <b>{label(p.a)} - {label(p.b)}</b></td>
              <td>{formatDeltaCompact(Math.abs(p.diffIn)).replace('+', '')}</td>
              <td className="dim">{Math.abs(p.diffIn) < 0.0625 ? 'even' : `${label(p.diffIn > 0 ? p.b : p.a)} high`}</td>
              <td className="dim">{p.spanFt >= 10 ? `${Math.round(p.spanFt)}'` : formatDeltaCompact(p.spanFt * 12).replace('+', '')} apart</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
