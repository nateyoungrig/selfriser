import { alarmPair } from '../hw/interlock'
import { soundAlarm } from '../hw/alarm'
import { freshReport, linkLive, motionAllowed, onAttach, onTick, send, useLink } from '../hw/link'
import { formatDeltaCompact } from '../lib/units'
import { activeDesign, useLibrary } from '../model/library'
import { recordSample } from './log'

// What runs behind the field screen while lasers are linked, whichever screen is up: the stop
// alarm, the lift log, and the towers' top soft limit kept on the stage's max trim.

let lastBeep = 0

/** Monitoring: keep the alarm in step with the lasers, and beep every few seconds while it holds. */
function checkAlarm(now: number) {
  const d = activeDesign()
  const live = d.towers.map((t) => freshReport(t.linkId, now))
  // Driving a bench model the interlock does this job; the alarm is for watching hoists the app can't stop.
  const trip = linkLive() && !motionAllowed() && useLink.getState().guard
    ? alarmPair(d, live.map((r) => (r ? Math.max(0, r.h) : 0)), live.map((r) => r !== null))
    : null
  if (!trip) {
    if (useLink.getState().alarm) useLink.setState({ alarm: null })
    return
  }
  const label = (id: string) => d.towers.find((t) => t.id === id)?.label ?? id
  const text = `STOP: ${label(trip.a)}-${label(trip.b)} are ${formatDeltaCompact(Math.abs(trip.diffIn)).replace('+', '')} apart`
  if (useLink.getState().alarm !== text) useLink.setState({ alarm: text })
  if (now - lastBeep > 3000) {
    lastBeep = now
    soundAlarm()
  }
}

/** Keep every tower's top soft limit on the stage's max trim. */
const pushLimits = () => send({ t: 'cfg', n: 0, max: activeDesign().maxTrimFt * 12 })

let started = false
export function startWatch() {
  if (started) return
  started = true
  onTick((now) => {
    checkAlarm(now)
    if (!linkLive()) return
    const d = activeDesign()
    recordSample(d, d.towers.map((t) => { const r = freshReport(t.linkId, now); return r ? Math.max(0, r.h) : null }), now)
  })
  onAttach(pushLimits)
  let lastMax = activeDesign().maxTrimFt
  useLibrary.subscribe(() => {
    const max = activeDesign().maxTrimFt
    if (max !== lastMax && linkLive()) pushLimits()
    lastMax = max
  })
}
