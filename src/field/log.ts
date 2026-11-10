import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { download } from '../model/library'

// The lift log: off by default, on for a real lift. While it's on, laser heights are kept over time
// for whichever stage is on screen. A recording is the field record of a lift, and in the Lab it is
// what teaches the sim how each tower's lifter really runs. Recordings live under their own storage
// key so the samples don't get rewritten with every tap in the app.

export interface LaserSample {
  t: number
  /** Stage design id. */
  rigId: string
  /** Per tower, inches; null = no reading from that tower. */
  heightsIn: (number | null)[]
}

export interface Recording {
  id: string
  startedAt: number
  endedAt: number | null
  /** Stage names and tower labels as they were, so an export reads on its own. */
  stages?: Record<string, { name: string; towers: string[] }>
  /** Stops typed into the old app; new recordings only hold samples. */
  stops?: unknown[]
  samples: LaserSample[]
}

interface LogState {
  recordings: Recording[]
  /** Id of the recording in progress, null when off. */
  current: string | null
}

export const useLog = create<LogState>()(
  persist((): LogState => ({ recordings: [], current: null }), { name: 'selfriser-recordings', version: 1 }),
)

/** Samples: at most one a second, and only when something moved 1/8" or 10 s went by. */
export const SAMPLE_MIN_MS = 1000
export const SAMPLE_IDLE_MS = 10000
export const SAMPLE_MOVE_IN = 1 / 8
/** Enough for about 5 hours of continuous motion at one a second; past it, samples stop. */
export const MAX_SAMPLES = 20000

export function shouldSample(last: LaserSample | undefined, heightsIn: (number | null)[], now: number): boolean {
  if (!heightsIn.some((h) => h !== null)) return false
  if (!last) return true
  if (now - last.t < SAMPLE_MIN_MS) return false
  if (now - last.t >= SAMPLE_IDLE_MS) return true
  return heightsIn.some((h, i) => {
    const p = last.heightsIn[i]
    return (h === null) !== (p === null) || (h !== null && p !== null && Math.abs(h - p) >= SAMPLE_MOVE_IN)
  })
}

export const isRecording = () => useLog.getState().current !== null

const update = (id: string, change: (r: Recording) => Recording) =>
  useLog.setState((s) => ({ recordings: s.recordings.map((r) => (r.id === id ? change(r) : r)) }))

// Samples collect here and reach storage every few seconds, not ten times a second.
let pending: LaserSample[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
const lastSample = new Map<string, LaserSample>()

function flush() {
  const id = useLog.getState().current
  if (!id || !pending.length) return
  const batch = pending
  pending = []
  update(id, (r) => ({ ...r, samples: [...r.samples, ...batch].slice(0, MAX_SAMPLES) }))
}

function startFlushing() {
  if (flushTimer === null && typeof setInterval !== 'undefined') flushTimer = setInterval(flush, 5000)
}

export function setRecording(on: boolean) {
  const st = useLog.getState()
  if (on === (st.current !== null)) return
  if (on) {
    const rec: Recording = { id: `rec-${Date.now()}`, startedAt: Date.now(), endedAt: null, stages: {}, samples: [] }
    lastSample.clear()
    useLog.setState({ recordings: [...st.recordings, rec], current: rec.id })
    startFlushing()
  } else {
    flush()
    update(st.current!, (r) => ({ ...r, endedAt: Date.now() }))
    useLog.setState({ current: null })
    if (flushTimer !== null) clearInterval(flushTimer)
    flushTimer = null
  }
}

/** Live laser heights (null = no reading), while recording. Throttled by shouldSample. */
export function recordSample(stage: { id: string; name: string; towers: { label: string }[] }, heightsIn: (number | null)[], now = Date.now()) {
  const id = useLog.getState().current
  if (!id) return
  const last = lastSample.get(stage.id)
  if (!shouldSample(last, heightsIn, now)) return
  const sample: LaserSample = { t: now, rigId: stage.id, heightsIn: heightsIn.map((h) => (h === null ? null : Math.round(h * 64) / 64)) }
  if (!last) update(id, (r) => ({ ...r, stages: { ...r.stages, [stage.id]: { name: stage.name, towers: stage.towers.map((t) => t.label) } } }))
  lastSample.set(stage.id, sample)
  pending.push(sample)
  startFlushing()
}

export function deleteRecording(id: string) {
  useLog.setState((s) => ({ recordings: s.recordings.filter((r) => r.id !== id), current: s.current === id ? null : s.current }))
}

/** Samples for one stage, oldest first, flushing anything still pending. */
export function samplesFor(rec: Recording, stageId: string): (number | null)[][] {
  flush()
  const fresh = useLog.getState().recordings.find((r) => r.id === rec.id) ?? rec
  return fresh.samples.filter((s) => s.rigId === stageId).map((s) => s.heightsIn)
}

/** Download one recording as JSON. */
export function exportRecording(id: string) {
  flush()
  const rec = useLog.getState().recordings.find((r) => r.id === id)
  if (!rec) return
  download(new Blob([JSON.stringify(rec, null, 1)], { type: 'application/json' }), `selfriser-${new Date(rec.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
}

// A reload mid-lift keeps recording: pick the flush timer back up.
if (useLog.getState().current) startFlushing()
