import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { corrections, type LevelTarget } from '../lib/level'
import { towerLoads } from '../lib/loads'
import { runTravel, step, type SimModel, type Switch } from '../lib/sim'
import type { Direction } from '../lib/winch'
import { activeDesign, useDesign } from '../model/library'
import type { Rig } from '../model/types'

// The Lab's simulator: a pretend lift per stage design, kept entirely apart from the field. Nothing
// here ever reaches the field screen, and field readings only reach the sim through a recording
// (Sim settings → TEACH THE SIM).

export interface Session {
  /** Heights at the last committed stop. */
  baselineIn: number[]
  /** Baseline carried forward by the sim. */
  predictedIn: number[]
  /** Heights typed in (or read off a bench model's lasers) since the last commit. */
  enteredIn: (number | null)[]
  runSeconds: number
  dir: Direction | 0
  /** Some of this run wasn't every winch moving the same way (bumps, switches off or mixed). */
  soloRun?: boolean
  /** Per-tower learned speed factor, from a recorded real lift. */
  calibration: number[]
}

interface LabState {
  sessions: Record<string, Session>
  /** Per design: each winch's selector switch (1 up, 0 off, -1 down). Missing = all up. */
  switches: Record<string, Switch[]>
  /** Undo / redo stacks per design (not persisted). */
  past: Record<string, Session[]>
  future: Record<string, Session[]>
  selected: number | null
  entryText: string
  /** Paddle is being held right now. */
  running: boolean
}

function freshSession(rig: Rig, calibration?: number[]): Session {
  const zeros = rig.towers.map(() => 0)
  return {
    baselineIn: zeros, predictedIn: zeros, enteredIn: rig.towers.map(() => null), runSeconds: 0, dir: 0,
    calibration: calibration?.length === rig.towers.length ? calibration : rig.towers.map(() => 1),
  }
}

const valid = (s: Session | undefined, rig: Rig): s is Session => !!s && s.baselineIn.length === rig.towers.length

let modelCache: { rig: Rig; calibration: number[]; model: SimModel } | null = null
export function simModel(rig: Rig, calibration: number[]): SimModel {
  if (modelCache && modelCache.rig === rig && modelCache.calibration === calibration) return modelCache.model
  const staticLb = modelCache && modelCache.rig === rig ? modelCache.model.staticLb : towerLoads(rig).towerLb
  const model = { rig, staticLb, calibration }
  modelCache = { rig, calibration, model }
  return model
}

export const switchesFor = (rig: Rig, stored: Switch[] | undefined): Switch[] => (stored && stored.length === rig.towers.length ? stored : rig.towers.map(() => 1))

/** Sign of a run: 1 / -1 when every moving winch went the same way, else 0 (mixed). */
const runSign = (dirs: Switch[]): Direction | 0 => {
  const moving = dirs.filter(Boolean)
  return moving.length && moving.every((d) => d === moving[0]) ? moving[0] : 0
}
const afterRun = (s: Session, heightsIn: number[], seconds: number, dirs: Switch[]): Session => ({
  ...s,
  predictedIn: heightsIn,
  runSeconds: s.runSeconds + seconds,
  dir: s.runSeconds > 0 && s.dir !== runSign(dirs) ? 0 : runSign(dirs),
  soloRun: s.soloRun || !dirs.every((d) => d === dirs[0]),
})

export const displayHeights = (s: Session) => s.enteredIn.map((e, i) => e ?? s.predictedIn[i])

/** Close out a stop: the heights on screen become the new baseline. */
const committed = (s: Session): Session => {
  const h = displayHeights(s)
  return { ...s, baselineIn: h, predictedIn: h, enteredIn: h.map(() => null), runSeconds: 0, dir: 0, soloRun: false }
}
/** The paddle always starts from what's on screen: fold typed heights in before moving. */
const readyToRun = (s: Session): Session => (s.enteredIn.some((e) => e !== null) ? committed(s) : s)

const HISTORY_LIMIT = 200
/** Consecutive edits with the same key (typing into one tower, one paddle hold) undo as a single step. */
let lastEditKey: string | null = null
let runCounter = 0

/** The calibration the old tabbed app had learned, carried over once per example. */
function oldCalibration(): Record<string, number[]> {
  try {
    const old = JSON.parse(globalThis.localStorage?.getItem('selfriser-v1') ?? '{}')
    return Object.fromEntries(Object.entries(old?.state?.sessions ?? {}).map(([id, s]) => [id, (s as Session).calibration]).filter(([, c]) => Array.isArray(c)))
  } catch {
    return {}
  }
}

export const useLab = create<LabState>()(
  persist(
    (): LabState => ({
      sessions: Object.fromEntries(Object.entries(oldCalibration()).map(([id, calibration]) => [id, { ...freshSession({ towers: calibration.map(() => ({})) } as Rig), calibration }])),
      switches: {}, past: {}, future: {}, selected: null, entryText: '', running: false,
    }),
    { name: 'selfriser-lab', version: 1, partialize: (s) => ({ sessions: s.sessions, switches: s.switches }) },
  ),
)

function ctx() {
  const rig = activeDesign()
  const stored = useLab.getState().sessions[rig.id]
  const session = valid(stored, rig) ? stored : freshSession(rig, (stored as Session | undefined)?.calibration)
  return { rig, session, model: simModel(rig, session.calibration) }
}
type Ctx = ReturnType<typeof ctx>

/** Every session change goes through here so it lands in the undo history. */
function edit(key: string | null, change: (session: Session, c: Ctx) => Session | null) {
  const c = ctx()
  const next = change(c.session, c)
  if (!next || next === c.session) return
  const coalesce = key !== null && key === lastEditKey
  lastEditKey = key
  useLab.setState((st) => {
    const past = st.past[c.rig.id] ?? []
    return {
      sessions: { ...st.sessions, [c.rig.id]: next },
      past: { ...st.past, [c.rig.id]: coalesce ? past : [...past, c.session].slice(-HISTORY_LIMIT) },
      future: { ...st.future, [c.rig.id]: [] },
    }
  })
}

function travel(from: 'past' | 'future', to: 'past' | 'future') {
  const c = ctx()
  const stack = useLab.getState()[from][c.rig.id] ?? []
  if (!stack.length) return
  lastEditKey = null
  useLab.setState((st) => ({
    sessions: { ...st.sessions, [c.rig.id]: stack[stack.length - 1] },
    [from]: { ...st[from], [c.rig.id]: stack.slice(0, -1) },
    [to]: { ...st[to], [c.rig.id]: [...(st[to][c.rig.id] ?? []), c.session] },
  }))
}

export const lab = {
  undo: () => travel('past', 'future'),
  redo: () => travel('future', 'past'),
  select: (i: number | null) => useLab.setState({ selected: i, entryText: '' }),
  setEntryText: (entryText: string) => useLab.setState({ entryText }),
  setRunning(running: boolean) {
    if (running) runCounter++
    useLab.setState({ running })
  },
  setSwitch(i: number, sw: Switch) {
    const { rig } = ctx()
    useLab.setState((st) => ({ switches: { ...st.switches, [rig.id]: switchesFor(rig, st.switches[rig.id]).map((v, k) => (k === i ? sw : v)) } }))
  },
  setAllSwitches(sw: Switch | Switch[]) {
    const { rig } = ctx()
    useLab.setState((st) => ({ switches: { ...st.switches, [rig.id]: Array.isArray(sw) ? sw : rig.towers.map(() => sw) } }))
  },
  /** One tap on a winch's local switch: run that winch alone by the rig's bump distance. */
  bump(i: number, dir: Direction) {
    lab.setSwitch(i, dir)
    edit(null, (session, c) => {
      const dirs = c.rig.towers.map((_, k): Switch => (k === i ? dir : 0))
      const s = readyToRun(session)
      const r = runTravel(c.model, s.predictedIn, dirs, c.rig.bumpIn)
      return afterRun(s, r.heightsIn, r.seconds, dirs)
    })
  },
  simStep: (dirs: Switch[], dtSec: number) => edit(`run:${runCounter}`, (session, c) => {
    if (!dirs.some(Boolean)) return null
    const s = readyToRun(session)
    return afterRun(s, step(c.model, s.predictedIn, dirs, dtSec), dtSec, dirs)
  }),
  setEntry: (i: number, inches: number | null) => edit(`entry:${i}`, (s) => ({ ...s, enteredIn: s.enteredIn.map((e, k) => (k === i ? inches : e)) })),
  setAll: (inches: number) => edit(null, (s) => ({ ...s, enteredIn: s.enteredIn.map(() => inches) })),
  /** Bench model: laser heights per tower (null = no reading), folded in as measurements. */
  setLive: (live: (number | null)[]) => edit(`live:${runCounter}`, (s) => {
    let changed = false
    const predictedIn = [...s.predictedIn]
    const enteredIn = s.enteredIn.map((e, i) => {
      const v = live[i]
      if (v === null || v === undefined) return e
      const h = Math.round(Math.max(0, v) * 64) / 64
      // Ignore laser jitter under 1/32" so an idle model isn't a stream of undo steps.
      if (e !== null && Math.abs(e - h) < 1 / 32) return e
      changed = true
      // The laser is where the tower is: the run's travel readout follows it too.
      predictedIn[i] = h
      return h
    })
    return changed ? { ...s, predictedIn, enteredIn } : null
  }),
  /** Bench model: close out the stop before real motors move. Everything until the next one undoes as a step. */
  liveRunStart() {
    runCounter++
    edit(`live:${runCounter}`, (s) => (s.enteredIn.some((e) => e !== null) ? committed(s) : s))
  },
  /** Bench model: the paddle clock while real motors run. */
  liveRun: (dirs: Switch[], dtSec: number) => edit(`live:${runCounter}`, (s) => (dirs.some(Boolean) ? afterRun(s, s.predictedIn, dtSec, dirs) : null)),
  /** Pretend the bump list was done: heights jump to level. */
  applyCorrection: (target: LevelTarget) => edit(null, (session) => {
    const h = displayHeights(session)
    const fix = corrections(h, target)
    const leveled = h.map((v, i) => v + fix[i])
    return committed({ ...session, predictedIn: leveled, enteredIn: leveled.map(() => null), runSeconds: 0 })
  }),
  /** Back to a roof on the deck with every switch up. Learned speeds are kept. */
  reset() {
    edit(null, (s, c) => freshSession(c.rig, s.calibration))
    lab.setAllSwitches(1)
    useLab.setState({ selected: null })
  },
  setCalibration: (calibration: number[]) => edit(null, (s) => ({ ...s, calibration })),
}

const sessionCache = new Map<string, Session>()

/** The active design's sim session, switches and model. */
export function useLabSession() {
  const rig = useDesign()
  const stored = useLab((s) => s.sessions[rig.id])
  const storedSwitches = useLab((s) => s.switches[rig.id])
  let session = stored
  if (!valid(session, rig)) {
    const key = `${rig.id}:${rig.towers.length}`
    session = sessionCache.get(key) ?? freshSession(rig, stored?.calibration)
    sessionCache.set(key, session)
  }
  const switches = useMemo(() => switchesFor(rig, storedSwitches), [rig, storedSwitches])
  return { rig, session, switches, model: simModel(rig, session.calibration) }
}
