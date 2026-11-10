import type { Switch } from '../lib/sim'
import type { Direction } from '../lib/winch'
import { freshReport, linkLive, motionAllowed, onTick, send, sendRun, sendStop, setMotionGate, useLink } from '../hw/link'
import { interlockTrip } from '../hw/interlock'
import { activeDesign, useLibrary } from '../model/library'
import { useUi } from '../app/ui'
import { displayHeights, lab, useLab } from './store'

// One run loop shared by the on-screen paddle, the local switches and the arrow keys, so they can't
// fight each other. With a bench model linked and allowed to move, the same loop drives its motors
// instead of the sim.

// The only place the app ever opens the motion gate: in the Lab, on a design that is a bench model.
setMotionGate(() => useUi.getState().mode === 'lab' && !!activeDesign().hardwareControl)

let held: { raf: number; last: number; live: boolean } | null = null

const MONITOR_NOTICE = 'Monitor only: the app reads the lasers and never runs a hoist. Run from the hoist controls.'

/** Directions per tower index, as the hub wants them: indexed by tower number - 1. */
function byNumber(dirs: Switch[]): Switch[] {
  const d = activeDesign()
  const out: Switch[] = Array(Math.max(0, ...d.towers.map((t) => t.linkId))).fill(0)
  d.towers.forEach((t, i) => { out[t.linkId - 1] = dirs[i] ?? 0 })
  return out
}

const liveMask = () => activeDesign().towers.map((t) => freshReport(t.linkId) !== null)

/** Hold GO: every winch runs in the direction given for it (0 = brake). */
export function startRun(dirs: Switch[]) {
  stopRun()
  if (!dirs.some(Boolean)) return
  // Linked but not allowed to move: say so rather than quietly running the sim beside real lasers.
  if (linkLive() && !motionAllowed()) { useLink.setState({ notice: MONITOR_NOTICE }); return }
  const live = linkLive()
  lab.setRunning(true)
  /** Heights when the run began, for the interlock's "getting worse" test. */
  let startIn: number[] | null = null
  if (live) {
    useLink.setState({ notice: null })
    lab.liveRunStart()
  }
  const master = dirs.filter(Boolean).length > 1
  const tick = (now: number) => {
    if (!held) return
    // Cap the step so a stalled tab doesn't teleport the roof.
    const dt = Math.min(0.25, (now - held.last) / 1000)
    held.last = now
    if (!held.live) {
      lab.simStep(dirs, dt * useUi.getState().timeScale)
    } else {
      if (!linkLive() || !motionAllowed()) { stopRun(); return }
      const rig = activeDesign()
      const session = useLab.getState().sessions[rig.id]
      const heightsIn = session ? displayHeights(session) : null
      if (heightsIn && !startIn) startIn = heightsIn
      if (master && heightsIn && startIn && useLink.getState().guard) {
        const trip = interlockTrip(rig, heightsIn, startIn, liveMask(), dirs.map(Boolean))
        if (trip) {
          const label = (id: string) => rig.towers.find((t) => t.id === id)?.label ?? id
          useLink.setState({ notice: `Interlock: ${label(trip.a)}-${label(trip.b)} reached the stop tolerance. Bump them back or turn the interlock off in Lasers.` })
          stopRun()
          return
        }
      }
      sendRun(byNumber(dirs))
      lab.liveRun(dirs, dt)
    }
    held.raf = requestAnimationFrame(tick)
  }
  held = { raf: requestAnimationFrame(tick), last: performance.now(), live }
  if (live) sendRun(byNumber(dirs))
}

export function stopRun() {
  if (!held) return
  cancelAnimationFrame(held.raf)
  if (held.live) sendStop()
  held = null
  lab.setRunning(false)
}

// Leaving the Lab or switching stage mid-run stops everything.
useUi.subscribe((s, prev) => { if (s.mode !== prev.mode) stopRun() })
useLibrary.subscribe((s, prev) => { if (s.activeId !== prev.activeId) stopRun() })

// In the Lab, linked lasers fill in the sim's heights: a bench model's corners are where they really are.
onTick((now) => {
  if (useUi.getState().mode !== 'lab' || !linkLive()) return
  lab.setLive(activeDesign().towers.map((t) => freshReport(t.linkId, now)?.h ?? null))
})

/** Run the linked model's tower i to a height: the tower closes the loop on its own laser. */
export function sendGoto(i: number, heightIn: number) {
  const rig = activeDesign()
  send({ t: 'goto', n: rig.towers[i].linkId, h: Math.min(rig.maxTrimFt * 12, Math.max(0, heightIn)) })
}

/** Bump list on the bench model: every tower runs to its level height at once, each on its own laser. */
export function sendGotoAll(fix: number[], heightsIn: number[]) {
  if (!linkLive() || !motionAllowed()) return
  lab.liveRunStart()
  fix.forEach((f, i) => { if (Math.abs(f) >= 0.125) sendGoto(i, heightsIn[i] + f) })
}

/** One bump: the sim moves the roof, or the linked tower runs bumpIn from where its laser says it is. */
function bump(i: number, dir: Direction) {
  if (!linkLive()) { lab.bump(i, dir); return }
  if (!motionAllowed()) { useLink.setState({ notice: MONITOR_NOTICE }); return }
  const rig = activeDesign()
  const report = freshReport(rig.towers[i].linkId)
  if (!report) { useLink.setState({ notice: `Tower ${rig.towers[i]?.label} isn't reporting, nothing to bump.` }); return }
  lab.setSwitch(i, dir)
  lab.liveRunStart()
  sendGoto(i, report.h + dir * rig.bumpIn)
}

const HOLD_MS = 280
let pending: { timer: number; i: number; dir: Direction } | null = null

/**
 * A winch's local switch: a tap is one bump in that direction, holding runs that winch alone
 * until release. Call pressLocal on pointer/key down and releaseLocal on up.
 */
export function pressLocal(i: number, dir: Direction, n: number) {
  releaseLocal()
  lab.setSwitch(i, dir)
  const timer = window.setTimeout(() => {
    pending = null
    startRun(Array.from({ length: n }, (_, k): Switch => (k === i ? dir : 0)))
  }, HOLD_MS)
  pending = { timer, i, dir }
}

export function releaseLocal() {
  if (pending) {
    clearTimeout(pending.timer)
    bump(pending.i, pending.dir)
    pending = null
  } else stopRun()
}
