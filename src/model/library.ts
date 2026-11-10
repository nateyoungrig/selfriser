import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StageDesign, Tower } from './types'
import { exampleDesigns } from './examples'
import { blankDesign, finishPlan, newId } from './defaults'
import { deleteBlob, getBlob, putBlob } from './blobs'

// The stage designs on this device and which one is up. Every screen works off the active design;
// there is always at least one (the last can't be removed), so nothing has to handle "no stage".

interface LibraryState {
  designs: StageDesign[]
  activeId: string
}

export const useLibrary = create<LibraryState>()(
  persist(
    (): LibraryState => {
      const designs = seedDesigns()
      return { designs, activeId: designs[0].id }
    },
    { name: 'selfriser-designs', version: 1 },
  ),
)

export function activeDesign(st: LibraryState = useLibrary.getState()): StageDesign {
  return st.designs.find((d) => d.id === st.activeId) ?? st.designs[0]
}

/** The design on screen. Re-renders when it, and only it, changes. */
export const useDesign = () => useLibrary(activeDesign)

export const setActive = (id: string) => useLibrary.setState({ activeId: id })

export function saveDesign(design: StageDesign) {
  const d = { ...design, updatedAt: Date.now() }
  useLibrary.setState((st) => ({
    designs: st.designs.some((x) => x.id === d.id) ? st.designs.map((x) => (x.id === d.id ? d : x)) : [...st.designs, d],
  }))
}

/** Change the active design in place (Lab sim settings, display precision). */
export function patchActive(change: (d: StageDesign) => StageDesign) {
  saveDesign(change(activeDesign()))
}

export function removeDesign(id: string): boolean {
  const st = useLibrary.getState()
  const d = st.designs.find((x) => x.id === id)
  if (!d || st.designs.length < 2) return false
  const designs = st.designs.filter((x) => x.id !== id)
  useLibrary.setState({ designs, activeId: st.activeId === id ? designs[0].id : st.activeId })
  // Blobs can be shared by a duplicate; only drop them when nothing else uses them.
  for (const key of [d.drawing?.pdfKey, d.drawing?.underlay?.key]) {
    if (key && !designs.some((x) => x.drawing?.pdfKey === key || x.drawing?.underlay?.key === key)) void deleteBlob(key)
  }
  return true
}

export function duplicateDesign(id: string): StageDesign | null {
  const d = useLibrary.getState().designs.find((x) => x.id === id)
  if (!d) return null
  const now = Date.now()
  const copy: StageDesign = { ...structuredClone(d), id: newId('stage'), name: `${d.name} (copy)`, example: undefined, createdAt: now, updatedAt: now }
  saveDesign(copy)
  return copy
}

/** Put back any shipped example that was removed. Edited examples are left alone. */
export function restoreExamples(): number {
  const st = useLibrary.getState()
  const missing = exampleDesigns().filter((e) => !st.designs.some((d) => d.example === e.example))
  if (missing.length) useLibrary.setState({ designs: [...st.designs, ...missing] })
  return missing.length
}

// ---- Files: a design travels as one JSON file (with its plan underlay, never the original PDF). ----

const FORMAT = 'selfriser-stage'

export async function exportDesign(d: StageDesign) {
  const underlay = d.drawing?.underlay ? await getBlob(d.drawing.underlay.key) : undefined
  const file = {
    format: FORMAT,
    version: 1,
    design: { ...d, drawing: d.drawing ? { ...d.drawing, pdfKey: '' } : undefined },
    underlay: underlay ? await blobToDataUrl(underlay) : undefined,
  }
  download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${slug(d.name)}.selfriser.json`)
}

export async function importDesignFile(file: File): Promise<StageDesign> {
  let parsed: { format?: string; design?: unknown; underlay?: string }
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error(`${file.name} isn't a stage design file.`)
  }
  if (parsed?.format !== FORMAT) throw new Error(`${file.name} isn't a stage design file.`)
  const d = sanitizeDesign(parsed.design)
  if (!d) throw new Error(`${file.name} has no towers in it.`)
  d.id = newId('stage')
  d.example = undefined
  if (d.drawing) {
    d.drawing.pdfKey = ''
    if (parsed.underlay && d.drawing.underlay) {
      const blob = await (await fetch(parsed.underlay)).blob()
      d.drawing.underlay.key = await putBlob(newId('underlay'), blob)
    } else d.drawing.underlay = undefined
  }
  saveDesign(d)
  return d
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Whatever came in from a file, made into a design the app can trust: missing fields get defaults. */
export function sanitizeDesign(raw: unknown): StageDesign | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<StageDesign>
  const base = blankDesign(typeof r.name === 'string' && r.name ? r.name : 'Imported stage')
  const towers: Tower[] = (Array.isArray(r.towers) ? r.towers : [])
    .filter((t): t is Tower => !!t && typeof t === 'object' && Number.isFinite(t.x) && Number.isFinite(t.y))
    .map((t, i) => ({
      id: typeof t.id === 'string' && t.id ? t.id : `T${i + 1}`,
      label: String(t.label ?? i + 1),
      linkId: Math.max(1, Math.round(num(t.linkId, i + 1))),
      x: t.x, y: t.y,
      feederFt: num(t.feederFt, 0),
      ropeOnDrumAtZeroFt: num(t.ropeOnDrumAtZeroFt, 0),
      partsOfLine: t.partsOfLine === undefined ? undefined : num(t.partsOfLine, 1),
      motors: t.motors === undefined ? undefined : num(t.motors, 1),
      loadLb: t.loadLb === undefined ? undefined : num(t.loadLb, 0),
    }))
  if (!towers.length) return null
  const d: StageDesign = {
    ...base,
    ...r,
    id: base.id,
    name: base.name,
    short: typeof r.short === 'string' && r.short ? r.short : base.short,
    towers,
    winch: { ...base.winch, ...r.winch },
    power: { ...base.power, ...r.power },
    tolerance: { warnIn: num(r.tolerance?.warnIn, 4), stopIn: num(r.tolerance?.stopIn, 8) },
    members: Array.isArray(r.members) ? r.members : [],
    areaLoads: Array.isArray(r.areaLoads) ? r.areaLoads : [],
    pointLoads: Array.isArray(r.pointLoads) ? r.pointLoads : [],
    memberPlf: r.memberPlf && typeof r.memberPlf === 'object' ? r.memberPlf : base.memberPlf,
    roof: r.roof ?? base.roof,
    towerHeightFt: num(r.towerHeightFt, base.towerHeightFt),
    maxTrimFt: num(r.maxTrimFt, base.maxTrimFt),
    // A design from a file never drives motors until someone says so in the Lab.
    hardwareControl: false,
  }
  return finishPlan(d)
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage'

// ---- First run ----

interface OldRigSettings {
  tolerance?: { warnIn: number; stopIn: number }
  winch?: Partial<StageDesign['winch']>
  power?: Partial<StageDesign['power']>
  couplingLbPerIn?: number
  maxTrimFt?: number
  bumpIn?: number
  denom?: number
  towers?: Record<string, Partial<Tower>>
  loads?: { memberPlf?: Record<string, number>; areaPsf?: Record<string, number>; pointLbs?: Record<string, number>; towerLb?: Record<string, number>; loadBandKips?: [number, number] | null }
}

/**
 * The shipped examples, with anything tuned for them in the old tabbed app (localStorage
 * "selfriser-v1" Settings) folded in, so an update doesn't throw away a crew's numbers.
 */
function seedDesigns(): StageDesign[] {
  let old: { state?: { settings?: Record<string, OldRigSettings>; rigId?: string } } = {}
  try {
    old = JSON.parse(globalThis.localStorage?.getItem('selfriser-v1') ?? '{}') ?? {}
  } catch { /* nothing to carry over */ }
  const settings = old.state?.settings ?? {}
  const designs = exampleDesigns().map((d): StageDesign => {
    const s = settings[d.example!]
    if (!s) return d
    const l = s.loads ?? {}
    return {
      ...d,
      tolerance: s.tolerance ?? d.tolerance,
      winch: { ...d.winch, ...s.winch },
      power: { ...d.power, ...s.power },
      couplingLbPerIn: s.couplingLbPerIn ?? d.couplingLbPerIn,
      maxTrimFt: s.maxTrimFt ?? d.maxTrimFt,
      bumpIn: s.bumpIn ?? d.bumpIn,
      displayDenom: s.denom ?? d.displayDenom,
      memberPlf: { ...d.memberPlf, ...l.memberPlf },
      areaLoads: d.areaLoads.map((a) => ({ ...a, psf: l.areaPsf?.[a.id] ?? a.psf })),
      pointLoads: d.pointLoads.map((p) => ({ ...p, lbs: l.pointLbs?.[p.id] ?? p.lbs })),
      loadBandKips: l.loadBandKips === undefined ? d.loadBandKips : l.loadBandKips,
      towers: d.towers.map((t) => {
        const o = s.towers?.[t.id] ?? {}
        return { ...t, ...o, loadLb: l.towerLb?.[t.id] ?? t.loadLb, linkId: t.linkId }
      }),
    }
  })
  // The full-size roofs first; the old app opened on whichever tab was last used.
  const last = designs.find((d) => d.example === old.state?.rigId && !d.hardwareControl)
  return last ? [last, ...designs.filter((d) => d !== last)] : designs
}
