import type { ReactNode } from 'react'
import { deleteRecording, exportRecording, setRecording, useLog, type Recording } from './log'
import { useLibrary } from '../model/library'

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const span = (a: number, b: number) => {
  const m = Math.round((b - a) / 60000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** The lift log: off for practice, on for a real lift. The Lab passes extra buttons per recording. */
export function LogSheet({ extra }: { extra?: (r: Recording) => ReactNode }) {
  const { recordings, current } = useLog()
  const designs = useLibrary((s) => s.designs)
  const stageName = (id: string, r: Recording) => r.stages?.[id]?.name ?? designs.find((d) => d.id === id)?.short ?? id

  return (
    <div className="panel">
      <h3>Record</h3>
      <div className="seg">
        <button className={!current ? 'on' : ''} onClick={() => setRecording(false)}>OFF</button>
        <button className={current ? 'on rec' : ''} onClick={() => setRecording(true)}>● RECORD THIS LIFT</button>
      </div>
      <p className="hint">
        On for a real lift: every tower's laser height is kept over time (once a second while anything moves, every 10 s
        otherwise) for the stage on screen. REC shows in the header while it's on; turn it off when the lift is done.
        A recording exports as JSON, and in the Lab it teaches the simulator how each tower's lifter really runs.
      </p>

      {recordings.length > 0 && <h3>Recordings</h3>}
      <div className="rec-list">
        {[...recordings].reverse().map((r) => {
          const stages = [...new Set(r.samples.map((s) => s.rigId))].map((id) => stageName(id, r))
          return (
            <div className="rec-item" key={r.id}>
              <div>
                <b>{when(r.startedAt)}</b>{r.id === current ? <span className="rec-live"> ● recording</span> : r.endedAt ? <span className="dim"> · {span(r.startedAt, r.endedAt)}</span> : null}
                <div className="dim">{stages.length ? `${stages.join(', ')} · ` : ''}{r.samples.length} laser readings{r.stops?.length ? ` · ${r.stops.length} stops` : ''}</div>
              </div>
              <div className="row">
                {extra?.(r)}
                <button onClick={() => exportRecording(r.id)}>EXPORT</button>
                {r.id !== current && <button className="danger" onClick={() => confirm(`Delete the recording from ${when(r.startedAt)}? This can't be undone.`) && deleteRecording(r.id)}>DELETE</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
