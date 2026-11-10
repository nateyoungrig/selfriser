import { useState } from 'react'
import type { StageDesign } from '../model/types'
import { duplicateDesign, exportDesign, importDesignFile, removeDesign, restoreExamples, setActive, useLibrary } from '../model/library'
import { useBlobUrl } from '../model/blobs'
import { extentOf } from '../model/geometry'
import { exampleDesigns } from '../model/examples'
import { openEditor, openSheet } from '../app/ui'

/** A small plan of the design: its drawing when it has one, towers and runs on top. */
function Thumb({ d }: { d: StageDesign }) {
  const url = useBlobUrl(d.drawing?.underlay?.key)
  const e = extentOf([...d.towers, { x: d.roof.x0, y: d.roof.y0 }, { x: d.roof.x1, y: d.roof.y1 }])
  const pad = Math.max(e.x1 - e.x0, e.y1 - e.y0, 1) * 0.08
  const vb = [e.x0 - pad, e.y0 - pad, e.x1 - e.x0 + 2 * pad, e.y1 - e.y0 + 2 * pad]
  const r = Math.max(vb[2], vb[3]) / 40
  const u = d.drawing?.underlay
  return (
    <svg className="thumb" viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {url && u && <image href={url} x={u.x0} y={u.y0} width={u.x1 - u.x0} height={u.y1 - u.y0} preserveAspectRatio="none" opacity={0.7} />}
      <rect x={d.roof.x0} y={d.roof.y0} width={d.roof.x1 - d.roof.x0} height={d.roof.y1 - d.roof.y0} fill="none" stroke="#f97316" strokeWidth={r / 3} strokeDasharray={`${r} ${r / 1.5}`} />
      {d.members.map((m) => <line key={m.id} x1={m.a[0]} y1={m.a[1]} x2={m.b[0]} y2={m.b[1]} stroke="#64748b" strokeWidth={r / 2.5} />)}
      {d.towers.map((t) => <circle key={t.id} cx={t.x} cy={t.y} r={r} fill="#a78bfa" />)}
    </svg>
  )
}

const when = (t: number) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '')

/** Every stage design on this device: open one, import a drawing, edit, copy, share as a file, or remove. */
export function DesignsSheet() {
  const designs = useLibrary((s) => s.designs)
  const activeId = useLibrary((s) => s.activeId)
  const [msg, setMsg] = useState<string | null>(null)

  const importFile = async (f: File) => {
    try {
      const d = await importDesignFile(f)
      setMsg(`Added ${d.name}.`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="panel designs">
      <div className="row add-row">
        <label className="btn primary">
          IMPORT A STAGE DRAWING (PDF)…
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openEditor({ pdf: f }) }} />
        </label>
        <button onClick={() => openEditor({ blank: true })}>NEW, NO DRAWING</button>
        <label className="btn">
          OPEN A DESIGN FILE…
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
        </label>
      </div>
      <p className="hint">
        A drawing becomes a design in a few taps: pick its plan sheet, set the scale off one dimension, tap the towers and
        the roof outline. Drawings stay on this device. EXPORT shares a design (with its plan picture, never the PDF) as a
        file another phone can open.
      </p>
      {msg && <p className="hint" onClick={() => setMsg(null)}>{msg}</p>}

      <div className="design-list">
        {designs.map((d) => (
          <div key={d.id} className={`design-item ${d.id === activeId ? 'current' : ''}`}>
            <Thumb d={d} />
            <div className="design-info">
              <b>{d.name}</b>
              <span className="dim">
                {d.towers.length} towers · {d.lift === 'motor' ? 'chain motors' : 'winches'}{d.hardwareControl ? ' · bench model' : ''}
              </span>
              <span className="dim">{d.drawing ? `From ${d.drawing.fileName || 'a drawing'}${d.drawing.pdfKey ? '' : ' (picture only)'}` : d.example ? `Example · ${d.source}` : d.source} · {when(d.updatedAt)}</span>
            </div>
            <div className="row design-actions">
              {d.id === activeId ? <span className="on-screen">ON SCREEN</span> : <button className="primary" onClick={() => { setActive(d.id); openSheet(null) }}>OPEN</button>}
              <button onClick={() => openEditor({ id: d.id })}>EDIT</button>
              <button onClick={() => { const c = duplicateDesign(d.id); if (c) setMsg(`Copied to ${c.name}.`) }}>COPY</button>
              <button onClick={() => void exportDesign(d)}>EXPORT</button>
              <button
                className="danger" disabled={designs.length < 2} title={designs.length < 2 ? 'Add another design before removing the last one' : undefined}
                onClick={() => confirm(`Remove ${d.name} from this device? Its drawing goes too. This can't be undone (EXPORT it first to keep a copy).`) && removeDesign(d.id)}
              >REMOVE</button>
            </div>
          </div>
        ))}
      </div>

      <h3>Examples</h3>
      <p className="hint">{exampleDesigns(0).map((d) => d.name).join(', ')} ship with the app.</p>
      <div className="row">
        <button onClick={() => { const n = restoreExamples(); setMsg(n ? `Restored ${n} example${n > 1 ? 's' : ''}.` : 'Every example is already here.') }}>RESTORE EXAMPLES</button>
      </div>
    </div>
  )
}
