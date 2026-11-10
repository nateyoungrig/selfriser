import { useEffect } from 'react'
import { pressLocal, releaseLocal, startRun, stopRun } from './hold'
import { motionAllowed, STALE_MS, useLink } from '../hw/link'
import { formatCompact, formatDeltaCompact } from '../lib/units'
import type { Direction } from '../lib/winch'
import type { Rig } from '../model/types'
import { lab, useLab, useLabSession } from './store'

/** One-letter prefix for a lifter's name on the paddle and pad: W9 on a winch roof, M9 on a motor roof. */
export const liftTag = (rig: Rig) => (rig.lift === 'motor' ? 'M' : 'W')

const POS = { 1: '▲', 0: '○', '-1': '▼' } as const

/**
 * The Lab's pickle, pinned to the bottom so the buttons never move. Master: GO runs every winch
 * in its own switch direction. With a tower picked, big local UP / DOWN for that winch alone
 * (tap = one bump, hold = run).
 */
export function Paddle() {
  const { rig, session, switches } = useLabSession()
  const running = useLab((s) => s.running)
  const selected = useLab((s) => s.selected)
  const setAllSwitches = lab.setAllSwitches
  const linked = useLink((s) => s.status === 'live')
  const reports = useLink((s) => s.towers)
  const alarm = useLink((s) => s.alarm)
  // Re-evaluated with the link's 10 Hz snapshot (a monitor-only tower can appear at any time).
  const monitor = !motionAllowed()
  useEffect(() => stopRun, [])

  // Monitor only: no GO, no local UP / DOWN. The hoists run from their own controls; this watches.
  if (linked && monitor) {
    const now = Date.now()
    const lasers = rig.towers.filter((t) => { const r = reports[t.linkId]; return r && now - r.at < STALE_MS && r.s !== 'nosensor' }).length
    return (
      <div className={`paddle monitor ${alarm ? 'alarm' : ''}`}>
        <div className="monitor-panel">
          <b>{alarm ?? 'MONITOR ONLY'}</b>
          <span>Lasers reading on {lasers} of {rig.towers.length} towers{lasers < rig.towers.length ? ' (type the rest from a tape)' : ''}</span>
          <span className="dim">Run the {rig.lift === 'motor' ? 'motors' : 'winches'} from their own controls. This app reads heights and never runs a {rig.lift}.</span>
        </div>
      </div>
    )
  }

  const moving = switches.map((sw, i) => (selected !== null ? i === selected : sw !== 0))
  const moved = session.predictedIn.map((v, i) => v - session.baselineIn[i]).filter((_, i) => moving[i])
  const travel = moved.length ? moved.reduce((s, v) => s + v, 0) / moved.length : 0
  const mm = Math.floor(session.runSeconds / 60), ss = Math.floor(session.runSeconds % 60)
  const ups = switches.filter((s) => s === 1).length, downs = switches.filter((s) => s === -1).length
  const who = ups && downs ? `${ups}▲ ${downs}▼` : ups === rig.towers.length ? 'ALL ▲' : downs === rig.towers.length ? 'ALL ▼' : ups ? `${ups} OF ${rig.towers.length} ▲` : downs ? `${downs} OF ${rig.towers.length} ▼` : 'ALL OFF'

  const release = () => stopRun()
  const goProps = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startRun(switches) },
    onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
  const localProps = (dir: Direction) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); pressLocal(selected!, dir, rig.towers.length) },
    onPointerUp: releaseLocal, onPointerCancel: releaseLocal, onLostPointerCapture: releaseLocal,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })

  const readout = (label: string) => (
    <div className="paddle-readout">
      <em>{label}</em>
      <b>{mm}:{String(ss).padStart(2, '0')}</b>
      <span>{travel >= 0 ? '+' : '-'}{formatCompact(Math.abs(travel), rig.displayDenom ?? 1)}</span>
    </div>
  )

  if (selected !== null) {
    const t = rig.towers[selected]
    const tag = liftTag(rig)
    return (
      <div className="paddle solo">
        <div className="jumps">
          <span className="jumps-note">{tag}{t.label} switch: {POS[String(switches[selected]) as keyof typeof POS]} &middot; tap = bump {formatDeltaCompact(rig.bumpIn, 8).replace('+', '')}, hold = run</span>
        </div>
        <div className="paddle-main">
          <button className={`run down ${running && session.dir === -1 ? 'on' : ''}`} {...localProps(-1)}>▼ {tag}{t.label} DOWN</button>
          {readout(`${tag}${t.label} ONLY`)}
          <button className={`run up ${running && session.dir === 1 ? 'on' : ''}`} {...localProps(1)}>▲ {tag}{t.label} UP</button>
        </div>
      </div>
    )
  }

  return (
    <div className="paddle">
      <div className="jumps">
        <button className={ups === rig.towers.length ? 'on' : ''} onClick={() => setAllSwitches(1)}>ALL ▲</button>
        <button className={!ups && !downs ? 'on' : ''} onClick={() => setAllSwitches(0)}>ALL OFF</button>
        <button className={downs === rig.towers.length ? 'on' : ''} onClick={() => setAllSwitches(-1)}>ALL ▼</button>
      </div>
      <div className="paddle-main go">
        <button className={`run go ${running ? 'on' : ''} ${!ups && !downs ? 'idle' : ''}`} {...goProps}>
          {!ups && !downs ? 'ALL SWITCHES OFF' : `GO  ${ups ? `${ups}▲` : ''} ${downs ? `${downs}▼` : ''}`}
        </button>
        {readout(who)}
      </div>
    </div>
  )
}
