import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Drawing, Rect, RoofMember, StageDesign, Tower } from '../model/types'
import { autoMembers, autoRoof, crewNumbering, extentOf, gridAdjacency, lineTolerance, scaleDesign, squareUp, translateDesign } from '../model/geometry'
import { blankDesign, finishPlan, LIFTERS, newId, newTower, presetOf, withLifter, type LifterPreset } from '../model/defaults'
import { getBlob, deleteBlob, putBlob } from '../model/blobs'
import { saveDesign, setActive, useLibrary } from '../model/library'
import { openEditor, type EditorTarget } from '../app/ui'
import { parseLength } from '../lib/units'
import { LengthField } from '../ui/LengthField'
import { NumberField } from '../ui/NumberField'
import { guessPlanPage, openPdf, renderPage, renderUnderlay, type PageImage, type Rotation } from './pdf'
import { label as lengthLabel, PlanCanvas, type Background, type PlanCanvasHandle, type Pt, type Segment } from './PlanCanvas'

// Building a stage design from its drawing, in five steps: pick the plan sheet, set the scale off a
// dimension you can read, tap the towers, mark the roof and its truss runs, then name it and set the
// numbers. A design without a drawing uses the same board over a feet grid.

type Step = 'drawing' | 'scale' | 'towers' | 'roof' | 'details'
const STEPS: [Step, string][] = [['drawing', 'DRAWING'], ['scale', 'SCALE'], ['towers', 'TOWERS'], ['roof', 'ROOF'], ['details', 'DETAILS']]
/** Before anyone sets the scale: 3/32" = 1'-0", a common sheet scale for a whole roof. */
const DEFAULT_PT_PER_FT = 6.75
const PRECISION: [number, string][] = [[1, 'INCH'], [2, '½"'], [4, '¼"'], [8, '⅛"']]

interface Pdf {
  doc: PDFDocumentProxy
  /** A newly chosen file, stored on save. */
  file: File | null
}

const withTowers = (d: StageDesign, towers: Tower[]): StageDesign => ({ ...d, towers, adjacency: gridAdjacency(towers, lineTolerance(towers)) })
const scaleText = (ptPerFt: number) => {
  // Paper inches per real foot, as the nearest architectural scale.
  const inPerFt = ptPerFt / 72
  const frac = [[1, 64], [3, 128], [1, 32], [3, 64], [1, 16], [3, 32], [1, 8], [3, 16], [1, 4], [3, 8], [1, 2], [3, 4], [1, 1]] as const
  const best = frac.reduce((b, f) => (Math.abs(f[0] / f[1] - inPerFt) < Math.abs(b[0] / b[1] - inPerFt) ? f : b))
  const close = Math.abs(best[0] / best[1] - inPerFt) / inPerFt < 0.03
  return `${close ? '' : '≈ '}${best[1] === 1 ? best[0] : `${best[0]}/${best[1]}`}" = 1'-0" on paper (1:${Math.round(864 / ptPerFt)})`
}

export function Editor({ target }: { target: EditorTarget }) {
  const existing = useLibrary((s) => ('id' in target ? s.designs.find((d) => d.id === target.id) : undefined))
  const [draft, setDraft] = useState<StageDesign>(() => existing ? structuredClone(existing) : blankDesign('pdf' in target ? target.pdf.name.replace(/\.pdf$/i, '') : 'New stage'))
  const [step, setStep] = useState<Step>('pdf' in target ? 'drawing' : 'towers')
  const [pdf, setPdf] = useState<Pdf | null>(null)
  const [page, setPage] = useState<PageImage | null>(null)
  const [underlayImg, setUnderlayImg] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calibrated, setCalibrated] = useState(!!existing?.drawing)
  const [autoRuns, setAutoRuns] = useState(!existing)
  const [dirty, setDirty] = useState(!existing)
  const [selTower, setSelTower] = useState<string | null>(null)
  const [selMember, setSelMember] = useState<string | null>(null)
  const [marks, setMarks] = useState<Pt[]>([])
  const [moveAll, setMoveAll] = useState(false)
  const [roofTool, setRoofTool] = useState<'outline' | 'run'>('outline')
  const [realLength, setRealLength] = useState('')
  const canvas = useRef<PlanCanvasHandle>(null)
  // Every PDF opened here, closed when the editor goes away (pdf.js keeps a worker per document).
  const opened = useRef<PDFDocumentProxy[]>([])
  useEffect(() => () => { for (const doc of opened.current) void doc.loadingTask.destroy() }, [])

  const change = (d: StageDesign) => { setDraft(d); setDirty(true) }
  const changeTowers = (towers: Tower[]) => {
    let d = withTowers(draft, towers)
    if (autoRuns) d = { ...d, members: autoMembers(towers, d.roof.x1 > d.roof.x0 ? d.roof : autoRoof(towers)) }
    change(d)
  }

  // ---- Loading the drawing ----
  const loadPdf = async (file: File | Blob, fresh: boolean) => {
    setBusy('Opening the drawing…')
    setError(null)
    try {
      const doc = await openPdf(await file.arrayBuffer())
      opened.current.push(doc)
      setPdf({ doc, file: fresh ? (file as File) : null })
      if (fresh) {
        const guess = await guessPlanPage(doc).catch(() => 1)
        setDraft((d) => ({ ...d, drawing: { fileName: (file as File).name, pdfKey: '', page: guess, rotation: 0, ptPerFt: DEFAULT_PT_PER_FT }, source: (file as File).name }))
        setCalibrated(false)
        setDirty(true)
      }
    } catch (err) {
      setError(`Couldn't open that PDF: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }
  useEffect(() => {
    if ('pdf' in target) void loadPdf(target.pdf, true)
    else if (existing?.drawing?.pdfKey) {
      getBlob(existing.drawing.pdfKey).then((b) => (b ? loadPdf(b, false) : undefined))
    } else if (existing?.drawing?.underlay) {
      // Imported from a file: no PDF on this device, but its plan picture can still go under the towers.
      getBlob(existing.drawing.underlay.key).then((b) => {
        if (!b) return
        const img = new Image()
        img.onload = () => setUnderlayImg(img)
        img.src = URL.createObjectURL(b)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const drawing = draft.drawing
  useEffect(() => {
    if (!pdf || !drawing) return
    let live = true
    setBusy(`Drawing page ${drawing.page}…`)
    renderPage(pdf.doc, drawing.page, drawing.rotation)
      .then((img) => { if (live) setPage(img) })
      .catch((err) => live && setError(String(err)))
      .finally(() => live && setBusy(null))
    return () => { live = false }
  }, [pdf, drawing?.page, drawing?.rotation]) // eslint-disable-line react-hooks/exhaustive-deps

  const background: Background | null = useMemo(() => {
    if (page && drawing) return { image: page.canvas, rect: { x0: 0, y0: 0, x1: page.widthPt / drawing.ptPerFt, y1: page.heightPt / drawing.ptPerFt }, paper: true }
    if (underlayImg && drawing?.underlay) return { image: underlayImg, rect: drawing.underlay, paper: false }
    return null
  }, [page, underlayImg, drawing?.ptPerFt, drawing?.underlay]) // eslint-disable-line react-hooks/exhaustive-deps

  const setDrawing = (patch: Partial<Drawing>) => change({ ...draft, drawing: { ...draft.drawing!, ...patch } })

  // ---- Scale ----
  const measured = marks.length === 2 ? Math.hypot(marks[1][0] - marks[0][0], marks[1][1] - marks[0][1]) : null
  const applyScale = () => {
    const inches = parseLength(realLength, 100000)
    if (!measured || !inches || !drawing) return
    const k = inches / 12 / measured
    change({ ...scaleDesign(draft, k), drawing: { ...drawing, ptPerFt: drawing.ptPerFt / k } })
    setMarks(marks.map(([x, y]) => [x * k, y * k]))
    setCalibrated(true)
  }

  // ---- Taps on the board ----
  const onTap = (p: Pt, hit: { tower: string | null; member: string | null }, snapped: Pt) => {
    if (step === 'scale') {
      setMarks(marks.length === 1 ? [marks[0], p] : [p])
    } else if (step === 'towers') {
      if (moveAll) return
      if (hit.tower) { setSelTower(selTower === hit.tower ? null : hit.tower); return }
      const t = newTower(draft, snapped[0], snapped[1])
      changeTowers([...draft.towers, t])
      setSelTower(t.id)
    } else if (step === 'roof') {
      if (roofTool === 'run' && !marks.length && hit.member) { setSelMember(selMember === hit.member ? null : hit.member); return }
      if (!marks.length) { setMarks([snapped]); setSelMember(null); return }
      const [a] = marks
      setMarks([])
      if (roofTool === 'outline') {
        const roof: Rect = { x0: Math.min(a[0], snapped[0]), y0: Math.min(a[1], snapped[1]), x1: Math.max(a[0], snapped[0]), y1: Math.max(a[1], snapped[1]) }
        if (roof.x1 - roof.x0 < 0.01 || roof.y1 - roof.y0 < 0.01) return
        change({ ...draft, roof, members: autoRuns ? autoMembers(draft.towers, roof) : draft.members })
      } else {
        if (Math.hypot(snapped[0] - a[0], snapped[1] - a[1]) < 0.01) return
        const horizontal = Math.abs(snapped[0] - a[0]) >= Math.abs(snapped[1] - a[1])
        const m: RoofMember = { id: newId('run'), kind: horizontal ? 'main' : 'cross', a, b: snapped }
        setAutoRuns(false)
        change({ ...draft, members: [...draft.members, m] })
      }
    }
  }

  const sel = draft.towers.find((t) => t.id === selTower) ?? null
  const patchTower = (id: string, p: Partial<Tower>) => changeTowers(draft.towers.map((t) => (t.id === id ? { ...t, ...p } : t)))
  const dupLinks = useMemo(() => {
    const seen = new Map<number, number>()
    for (const t of draft.towers) seen.set(t.linkId, (seen.get(t.linkId) ?? 0) + 1)
    return [...seen].filter(([, c]) => c > 1).map(([n]) => n)
  }, [draft.towers])

  const segments: Segment[] = []
  if (step === 'scale' && marks.length === 2) segments.push({ a: marks[0], b: marks[1], color: '#ef4444', label: `${lengthLabel(measured!)}${calibrated ? '' : ' (scale not set)'}` })

  // ---- Save ----
  const problems: string[] = []
  if (!draft.towers.length) problems.push('Place at least one tower.')
  if (dupLinks.length) problems.push(`Two towers share laser number ${dupLinks.join(', ')}.`)
  if (drawing && pdf && !calibrated) problems.push('Set the scale from a dimension on the drawing.')
  if (!draft.name.trim()) problems.push('Give the stage a name.')

  const save = async () => {
    if (problems.length) { setError(problems.join(' ')); return }
    setBusy('Saving…')
    try {
      let d = finishPlan({ ...draft, name: draft.name.trim(), short: (draft.short || draft.name).trim() }, { members: autoRuns ? 'auto' : 'keep' })
      if (d.drawing && pdf) {
        const dr = d.drawing
        const pdfKey = pdf.file ? await putBlob(newId('pdf'), pdf.file) : dr.pdfKey
        // The plan under the roof in 3D: the roof and towers with a margin, cut from the page.
        const e = extentOf([...d.towers, { x: d.roof.x0, y: d.roof.y0 }, { x: d.roof.x1, y: d.roof.y1 }])
        const pad = Math.max(e.x1 - e.x0, e.y1 - e.y0) * 0.12 + 2
        const w = page?.widthPt ?? Infinity, h = page?.heightPt ?? Infinity
        const pt: Rect = {
          x0: Math.max(0, (e.x0 - pad) * dr.ptPerFt), y0: Math.max(0, (e.y0 - pad) * dr.ptPerFt),
          x1: Math.min(w, (e.x1 + pad) * dr.ptPerFt), y1: Math.min(h, (e.y1 + pad) * dr.ptPerFt),
        }
        const blob = await renderUnderlay(pdf.doc, dr.page, dr.rotation, pt)
        const key = await putBlob(newId('underlay'), blob)
        const old = existing?.drawing?.underlay?.key
        d = { ...d, drawing: { ...dr, pdfKey, underlay: { key, x0: pt.x0 / dr.ptPerFt, y0: pt.y0 / dr.ptPerFt, x1: pt.x1 / dr.ptPerFt, y1: pt.y1 / dr.ptPerFt } } }
        if (old && old !== key && !useLibrary.getState().designs.some((x) => x.id !== d.id && x.drawing?.underlay?.key === old)) void deleteBlob(old)
      }
      saveDesign(d)
      setActive(d.id)
      openEditor(null)
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }
  const cancel = () => (!dirty || confirm('Leave without saving this stage design?')) && openEditor(null)

  const steps = STEPS.filter(([s]) => s !== 'scale' || (pdf && drawing))
  const goto = (s: Step) => { setStep(s); setMarks([]); setSelMember(null); setMoveAll(false) }

  return (
    <div className="editor" role="dialog" aria-modal="true">
      <div className="sheet-head">
        <button onClick={cancel}>CANCEL</button>
        <h2>{existing ? `Edit ${existing.short || existing.name}` : 'New stage design'}</h2>
        <button className="primary" disabled={!!busy} onClick={save}>SAVE</button>
      </div>
      <div className="steps seg">
        {steps.map(([s, text], n) => <button key={s} className={step === s ? 'on' : ''} onClick={() => goto(s)}>{n + 1} {text}</button>)}
      </div>

      {step !== 'details' && (
        <div className="board">
          <PlanCanvas
            handle={canvas} design={draft} background={background}
            towersEditable={step === 'towers'} moveAll={moveAll}
            selectedTower={step === 'towers' ? selTower : null} selectedMember={step === 'roof' ? selMember : null}
            marks={step === 'drawing' ? [] : marks} segments={segments} roofPreview={null}
            onTap={onTap}
            onMoveTower={(id, p) => setDraft((d) => ({ ...d, towers: d.towers.map((t) => (t.id === id ? { ...t, x: p[0], y: p[1] } : t)) }))}
            onMoveAll={(dx, dy) => setDraft((d) => translateDesign(d, dx, dy))}
            onDragEnd={() => changeTowers(draft.towers)}
          />
          {busy && <div className="board-busy">{busy}</div>}
          <button className="board-fit" onClick={() => canvas.current?.fit()}>FIT</button>
        </div>
      )}

      <div className={`tool-panel ${step === 'details' ? 'full' : ''}`}>
        {error && <p className="hint bad" onClick={() => setError(null)}>{error} ✕</p>}

        {step === 'drawing' && (
          <>
            {pdf && drawing ? (
              <>
                <p className="hint">Pick the sheet with the <b>plan view</b>, looking down on the roof, and turn it so <b>upstage is at the top</b> and the audience at the bottom. Then SCALE.</p>
                <div className="row">
                  <span className="dim">{drawing.fileName}</span>
                  <div className="seg">
                    <button disabled={drawing.page <= 1} onClick={() => setDrawing({ page: drawing.page - 1 })}>‹</button>
                    <button className="on">SHEET {drawing.page} / {pdf.doc.numPages}</button>
                    <button disabled={drawing.page >= pdf.doc.numPages} onClick={() => setDrawing({ page: drawing.page + 1 })}>›</button>
                  </div>
                  <div className="seg">
                    <button onClick={() => setDrawing({ rotation: ((drawing.rotation + 270) % 360) as Rotation })}>⟲</button>
                    <button onClick={() => setDrawing({ rotation: ((drawing.rotation + 90) % 360) as Rotation })}>⟳</button>
                  </div>
                </div>
              </>
            ) : (
              <p className="hint">{drawing?.underlay ? 'This design came from a file: its plan picture is under the towers, but the PDF itself isn\'t on this device.' : 'No drawing. Attach the stage\'s PDF to place towers on its plan view, or place them on the feet grid.'}</p>
            )}
            <div className="row">
              <label className="btn">
                {pdf ? 'USE A DIFFERENT PDF…' : 'ATTACH A DRAWING (PDF)…'}
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadPdf(f, true) }} />
              </label>
              {drawing && <button className="danger" onClick={() => { setPdf(null); setPage(null); setUnderlayImg(null); change({ ...draft, drawing: undefined }) }}>REMOVE DRAWING</button>}
              {pdf && drawing && <button className="primary" onClick={() => goto('scale')}>NEXT: SCALE ▶</button>}
            </div>
            {draft.towers.length > 0 && pdf && <p className="hint">This design already has {draft.towers.length} towers. Once the scale is set, TOWERS → MOVE ALL slides them onto the drawing.</p>}
          </>
        )}

        {step === 'scale' && drawing && (
          <>
            <p className="hint">Tap both ends of a long dimension you can read (the overall roof width is best), then type what it says. Two more taps measure anything to check.</p>
            <div className="row">
              <span className="dim">{marks.length === 0 ? 'Tap the first end' : marks.length === 1 ? 'Tap the other end' : `Measures ${lengthLabel(measured!)} at the current scale`}</span>
            </div>
            <div className="row">
              <input className="text length" placeholder={`e.g. 264'-2"`} value={realLength} onChange={(e) => setRealLength(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyScale()} aria-label="Real length" />
              <button className="primary" disabled={!measured || !parseLength(realLength, 100000)} onClick={applyScale}>SET SCALE</button>
              {calibrated && <button onClick={() => goto('towers')}>NEXT: TOWERS ▶</button>}
            </div>
            <p className={`hint ${calibrated ? '' : 'bad'}`}>{calibrated ? `Scale: ${scaleText(drawing.ptPerFt)}.` : 'Scale not set yet.'}</p>
          </>
        )}

        {step === 'towers' && (
          <>
            <p className="hint">{moveAll ? 'Drag anywhere to slide every tower, the roof and its runs together.' : 'Tap the center of each tower to place it; it snaps to rows and columns already placed. Drag one to move it, tap one to pick it.'}</p>
            <div className="row">
              <b>{draft.towers.length} towers</b>
              <button className={moveAll ? 'on' : ''} onClick={() => setMoveAll(!moveAll)}>MOVE ALL</button>
              <button disabled={draft.towers.length < 2} onClick={() => changeTowers(squareUp(draft.towers))} title="Line up towers that are nearly on the same row or column">SQUARE UP</button>
              <button disabled={!draft.towers.length} onClick={() => changeTowers(crewNumbering(draft.towers))} title="Downstage row first, stage right to left, then each row upstage">RENUMBER</button>
              {draft.towers.length > 0 && <button onClick={() => goto('roof')}>NEXT: ROOF ▶</button>}
            </div>
            {sel && (
              <div className="tower-edit">
                <label className="field"><span>Tower</span><input className="text" value={sel.label} onChange={(e) => patchTower(sel.id, { label: e.target.value })} /></label>
                <NumberField label="Laser #" value={sel.linkId} min={1} step={1} onChange={(v) => patchTower(sel.id, { linkId: Math.max(1, Math.round(v)) })} />
                <LengthField label="X (SR→SL)" valueFt={sel.x} onChange={(x) => patchTower(sel.id, { x })} />
                <LengthField label="Y (US→DS)" valueFt={sel.y} onChange={(y) => patchTower(sel.id, { y })} />
                <button className="danger" onClick={() => { changeTowers(draft.towers.filter((t) => t.id !== sel.id)); setSelTower(null) }}>DELETE TOWER</button>
              </div>
            )}
            {dupLinks.length > 0 && <p className="hint bad">Laser number {dupLinks.join(', ')} is used twice: each tower's controller needs its own.</p>}
          </>
        )}

        {step === 'roof' && (
          <>
            <div className="seg">
              <button className={roofTool === 'outline' ? 'on' : ''} onClick={() => { setRoofTool('outline'); setMarks([]) }}>OUTLINE</button>
              <button className={roofTool === 'run' ? 'on' : ''} onClick={() => { setRoofTool('run'); setMarks([]) }}>TRUSS RUNS</button>
            </div>
            <p className="hint">
              {roofTool === 'outline'
                ? 'Tap two opposite corners of the roof (cantilevers included). Taps snap to tower lines.'
                : 'Tap both ends of a truss run to add it; tap a run to pick it. AUTO puts a run through every row and column of towers, out to the roof edge past the last one.'}
            </p>
            <div className="row">
              {roofTool === 'run' && <button className={autoRuns ? 'on' : ''} onClick={() => { setAutoRuns(true); change({ ...draft, members: autoMembers(draft.towers, draft.roof.x1 > draft.roof.x0 ? draft.roof : autoRoof(draft.towers)) }) }}>AUTO</button>}
              {roofTool === 'run' && selMember && <button className="danger" onClick={() => { setAutoRuns(false); change({ ...draft, members: draft.members.filter((m) => m.id !== selMember) }); setSelMember(null) }}>DELETE RUN</button>}
              {roofTool === 'run' && <button disabled={!draft.members.length} onClick={() => { setAutoRuns(false); change({ ...draft, members: [] }) }}>CLEAR RUNS</button>}
              {roofTool === 'outline' && draft.roof.x1 > draft.roof.x0 && <span className="dim">{lengthLabel(draft.roof.x1 - draft.roof.x0)} wide × {lengthLabel(draft.roof.y1 - draft.roof.y0)} deep</span>}
              <button onClick={() => goto('details')}>NEXT: DETAILS ▶</button>
            </div>
          </>
        )}

        {step === 'details' && <Details draft={draft} change={change} />}
      </div>
    </div>
  )
}

function Details({ draft, change }: { draft: StageDesign; change(d: StageDesign): void }) {
  const set = (p: Partial<StageDesign>) => change({ ...draft, ...p })
  const patchTower = (id: string, p: Partial<Tower>) => change(withTowers(draft, draft.towers.map((t) => (t.id === id ? { ...t, ...p } : t))))
  return (
    <div className="panel details">
      <h3>Stage</h3>
      <div className="fields">
        <label className="field"><span>Name</span><input className="wide" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Main stage - 2026" /></label>
        <label className="field"><span>Short name (picker)</span><input className="wide" value={draft.short} onChange={(e) => set({ short: e.target.value.toUpperCase() })} placeholder="MAIN S" /></label>
        <label className="field"><span>Venue</span><input className="wide" value={draft.venue ?? ''} onChange={(e) => set({ venue: e.target.value || undefined })} /></label>
      </div>

      <h3>Towers and lifters</h3>
      <div className="seg">
        {(Object.keys(LIFTERS) as LifterPreset[]).map((p) => <button key={p} className={presetOf(draft) === p ? 'on' : ''} onClick={() => change(withLifter(draft, p))}>{LIFTERS[p].label.toUpperCase()}</button>)}
      </div>
      <div className="fields">
        <LengthField label="Tower height, overall" valueFt={draft.towerHeightFt} min={0.1} onChange={(v) => set({ towerHeightFt: v })} />
        <LengthField label="Max trim (roof at full height)" valueFt={draft.maxTrimFt} min={0.1} onChange={(v) => set({ maxTrimFt: v })} />
      </div>

      <h3>Out-of-level between neighbouring towers</h3>
      <div className="fields">
        <NumberField label="Watch (yellow) at" unit="in" value={draft.tolerance.warnIn} onChange={(v) => set({ tolerance: { ...draft.tolerance, warnIn: v } })} />
        <NumberField label="Stop (red, alarm) at" unit="in" value={draft.tolerance.stopIn} onChange={(v) => set({ tolerance: { ...draft.tolerance, stopIn: v } })} />
      </div>
      <h3>Heights round to</h3>
      <div className="seg">
        {PRECISION.map(([d, text]) => <button key={d} className={(draft.displayDenom ?? 1) === d ? 'on' : ''} onClick={() => set({ displayDenom: d })}>{text}</button>)}
      </div>

      <h3>Towers</h3>
      <p className="hint">Laser # is the tower number set on that tower's controller ("tower 3" on its console). Positions are tower centers in plan.</p>
      <div className="scroll-x">
        <table className="tower-table">
          <thead><tr><th>Tower</th><th>Laser #</th><th>X (SR→SL)</th><th>Y (US→DS)</th><th>{draft.lift === 'motor' ? 'Motors' : 'Winches'}</th></tr></thead>
          <tbody>
            {draft.towers.map((t) => (
              <tr key={t.id}>
                <td><input className="text" value={t.label} onChange={(e) => patchTower(t.id, { label: e.target.value })} /></td>
                <td><NumberField value={t.linkId} min={1} step={1} onChange={(v) => patchTower(t.id, { linkId: Math.max(1, Math.round(v)) })} /></td>
                <td><LengthField valueFt={t.x} onChange={(x) => patchTower(t.id, { x })} /></td>
                <td><LengthField valueFt={t.y} onChange={(y) => patchTower(t.id, { y })} /></td>
                <td><NumberField value={t.motors ?? 1} min={1} step={1} onChange={(v) => patchTower(t.id, { motors: Math.max(1, Math.round(v)) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft.towers.length === 0 && <p className="hint">No towers yet: place them on the TOWERS step.</p>}
    </div>
  )
}
