import type { ReactNode } from 'react'
import { formatDeltaCompact } from '../lib/units'
import { MAGNIFY_MAX, setView, useUi, type ViewName } from '../app/ui'
import { LEGEND_GRADIENT } from './colors'

const VIEWS: [ViewName, string][] = [['iso', 'ISO'], ['front', 'FRONT'], ['side', 'SIDE'], ['plan', 'PLAN']]

export function Slider({ label, value, min, max, step = 1, title, onChange }: { label: string; value: number; min: number; max: number; step?: number; title: string; onChange(v: number): void }) {
  return (
    <label className="slider" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()} />
    </label>
  )
}

/** Camera views and the stress magnifier, over the top left of the 3D view. The Lab adds its sim clock. */
export function ViewBar({ children }: { children?: ReactNode }) {
  const view = useUi((s) => s.view)
  const exaggeration = useUi((s) => s.exaggeration)
  return (
    <div className="viewbar">
      <div className="seg">
        {VIEWS.map(([v, label]) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>)}
      </div>
      {/* Drawing aid only: heights and spacing are true, the out-of-level is drawn k times bigger than life. */}
      <Slider
        label="MAGNIFY STRESS"
        value={exaggeration} min={1} max={MAGNIFY_MAX}
        title="Magnifies the out-of-level in the 3D view so inches show on a 260' roof. Heights, tags and colors stay true."
        onChange={(v) => useUi.setState({ exaggeration: v })}
      />
      {children}
    </div>
  )
}

export function Legend({ tolerance }: { tolerance: { warnIn: number; stopIn: number } }) {
  const { warnIn, stopIn } = tolerance
  const ticks = [stopIn, warnIn, 0, -warnIn, -stopIn]
  return (
    <div className="legend">
      <div className="legend-bar" style={{ background: LEGEND_GRADIENT }} />
      <div className="legend-ticks">
        {ticks.map((v) => <span key={v}>{v === 0 ? 'AVG' : formatDeltaCompact(v)}</span>)}
      </div>
    </div>
  )
}
