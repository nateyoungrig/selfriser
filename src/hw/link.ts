import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { armAlarm } from './alarm'
import { linkQuality, prune } from './signal'
import { decode, encode, lineSplitter, type Command, type HubEvent, type HubStatus, type TowerState } from './protocol'

// The link to the laser hub. One connection at a time, over USB (Web Serial) or Wi-Fi (WebSocket).
// Telemetry lands in a plain map as it arrives and is pushed to the UI ten times a second, so a chatty
// radio can't flood React. This module knows nothing about stages or screens: towers are the numbers
// set on their controllers, and whoever cares subscribes with onTick.
//
// Motion is shut by default. No RUN or GOTO leaves the app unless the motion gate says so, and only
// the Lab ever opens it, for a bench model whose design allows it.

export interface LiveTower {
  h: number
  mm: number
  s: TowerState
  d: -1 | 0 | 1
  q: number
  max: number
  mon: boolean
  /** 0 = heard directly; n = relayed by tower n. */
  via: number
  /** Share of expected reports arriving over the last few seconds, 0-100 (in the UI snapshot). */
  sig?: number
  /** Date.now() of the last report. */
  at: number
}

export type LinkStatus = 'off' | 'connecting' | 'live'

interface LinkState {
  status: LinkStatus
  via: 'usb' | 'wifi' | null
  error: string | null
  hub: HubStatus | null
  /** Snapshot of the latest report per tower number, refreshed at 10 Hz. */
  towers: Record<number, LiveTower>
  /** Why the app refused or stopped something, shown until dismissed. */
  notice: string | null
  log: string[]
  /** Monitoring: sound the alarm at the stop tolerance. Driving a bench model: the interlock. */
  guard: boolean
  /** Lab: keep the bench model monitor only too, to rehearse the field workflow. */
  monitor: boolean
  /** A pair is at the stop tolerance right now (monitor alarm). */
  alarm: string | null
  wsUrl: string
}

export const useLink = create<LinkState>()(
  persist(
    (): LinkState => ({ status: 'off', via: null, error: null, hub: null, towers: {}, notice: null, log: [], guard: true, monitor: false, alarm: null, wsUrl: 'ws://selfriser-hub.local:81' }),
    { name: 'selfriser-link', partialize: (s) => ({ guard: s.guard, monitor: s.monitor, wsUrl: s.wsUrl }) },
  ),
)

/** A tower that hasn't reported in this long is treated as unplugged. */
export const STALE_MS = 1000
/** RUN frames go out this often while a run is held; the towers' deadman is 400 ms. */
const RUN_EVERY_MS = 100

interface Transport {
  write(text: string): void
  close(): Promise<void>
}
let transport: Transport | null = null
const reports = new Map<number, LiveTower>()
/** Per tower number: when recent reports arrived, and when it was first heard this connection. */
const arrivals = new Map<number, number[]>()
const firstSeen = new Map<number, number>()
let lastRunSent = 0

export const linkLive = () => useLink.getState().status === 'live' && transport !== null

let motionGate: () => boolean = () => false
/** The Lab hands in its rule for when the app may drive motors. Nobody else calls this. */
export function setMotionGate(gate: () => boolean) {
  motionGate = gate
}

/** Any tower built monitor only (no motor outputs) makes the whole link monitor only. */
const monitorTowerHeard = (now = Date.now()) => [...reports.values()].some((r) => r.mon && now - r.at < STALE_MS)

/** True only when the app may send RUN / GOTO right now. */
export function motionAllowed(): boolean {
  return motionGate() && !useLink.getState().monitor && !monitorTowerHeard()
}

export function send(cmd: Command) {
  // Belt and braces: whoever asks, no motion command leaves the app unless motion is allowed.
  if ((cmd.t === 'run' || cmd.t === 'goto') && !motionAllowed()) return
  transport?.write(encode(cmd))
}

/** One frame of a held run, directions indexed by tower number - 1. Call every animation frame; it throttles itself. */
export function sendRun(dirs: (1 | 0 | -1)[]) {
  const now = performance.now()
  if (now - lastRunSent < RUN_EVERY_MS) return
  lastRunSent = now
  send({ t: 'run', d: dirs })
}

export function sendStop() {
  lastRunSent = 0
  send({ t: 'stop' })
}

/** Latest report from tower number n, if it is recent and its laser is reading. */
export function freshReport(n: number, now = Date.now()): LiveTower | null {
  const r = reports.get(n)
  return r && now - r.at < STALE_MS && r.s !== 'nosensor' ? r : null
}

/** Latest report from tower number n however old (the UI shows how old). */
export const lastReport = (n: number): LiveTower | null => reports.get(n) ?? null

const tickers = new Set<(now: number) => void>()
/** Called ten times a second while linked, after the snapshot is refreshed. Returns an unsubscribe. */
export function onTick(fn: (now: number) => void): () => void {
  tickers.add(fn)
  return () => tickers.delete(fn)
}
const attachers = new Set<() => void>()
/** Called once each time a hub links (to push limits and the like). */
export function onAttach(fn: () => void): () => void {
  attachers.add(fn)
  return () => attachers.delete(fn)
}

function onEvent(e: HubEvent) {
  if (e.t === 'tel') {
    const now = Date.now()
    reports.set(e.n, { h: e.h, mm: e.mm, s: e.s, d: e.d, q: e.q, max: e.max, mon: e.mon, via: e.via, at: now })
    if (!firstSeen.has(e.n)) firstSeen.set(e.n, now)
    const list = arrivals.get(e.n) ?? []
    list.push(now)
    arrivals.set(e.n, prune(list, now))
  } else if (e.t === 'hub') {
    useLink.setState({ hub: e })
  } else {
    useLink.setState((s) => ({ log: [...s.log, e.m].slice(-30) }))
  }
}

let pump: number | null = null

function attached(t: Transport, via: 'usb' | 'wifi') {
  transport = t
  reports.clear()
  arrivals.clear()
  firstSeen.clear()
  useLink.setState({ status: 'live', via, error: null, hub: null, towers: {}, notice: null })
  send({ t: 'stop' })
  for (const fn of attachers) fn()
  pump = window.setInterval(() => {
    const now = Date.now()
    useLink.setState({
      towers: Object.fromEntries([...reports].map(([n, r]) => [n, { ...r, sig: linkQuality(prune(arrivals.get(n) ?? [], now), now, firstSeen.get(n) ?? now) }])),
    })
    for (const fn of tickers) fn(now)
  }, 100)
}

function detached(error: string | null) {
  if (pump !== null) clearInterval(pump)
  pump = null
  transport = null
  useLink.setState({ status: 'off', via: null, error, hub: null, alarm: null })
  for (const fn of tickers) fn(Date.now())
}

export async function disconnect() {
  const t = transport
  if (!t) return
  send({ t: 'stop' })
  detached(null)
  await t.close().catch(() => {})
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const hasWebSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator

/** Pick the hub's USB port (Chrome / Edge on a computer or Android). */
export async function connectUsb() {
  armAlarm()
  if (!hasWebSerial()) {
    useLink.setState({ error: 'This browser has no Web Serial. Use Chrome or Edge on a computer or Android, or the Wi-Fi hub.' })
    return
  }
  await disconnect()
  useLink.setState({ status: 'connecting', error: null })
  let port: SerialPort
  try {
    port = await navigator.serial.requestPort()
    await port.open({ baudRate: 115200 })
  } catch (err) {
    useLink.setState({ status: 'off', error: (err as DOMException)?.name === 'NotFoundError' ? null : message(err) })
    return
  }
  const reader = port.readable!.getReader()
  const writer = port.writable!.getWriter()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const split = lineSplitter((line) => { const e = decode(line); if (e) onEvent(e) })
  let closing = false
  const t: Transport = {
    write: (text) => { writer.write(encoder.encode(text)).catch(() => {}) },
    close: async () => {
      closing = true
      await reader.cancel().catch(() => {})
      await writer.close().catch(() => {})
      await port.close().catch(() => {})
    },
  }
  attached(t, 'usb')
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      split(decoder.decode(value, { stream: true }))
    }
  } catch (err) {
    if (!closing) detached(`USB hub dropped: ${message(err)}`)
  } finally {
    reader.releaseLock()
  }
  if (!closing && transport === t) detached('USB hub disconnected')
}

/** Connect to a Wi-Fi hub. Browsers only allow ws:// from a page served over http (npm run dev). */
export async function connectWifi(url: string) {
  armAlarm()
  await disconnect()
  useLink.setState({ status: 'connecting', error: null, wsUrl: url })
  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch (err) {
    const https = location.protocol === 'https:' && url.startsWith('ws:')
    useLink.setState({ status: 'off', error: https ? 'This page is on https, so the browser blocks ws://. Open the app from npm run dev (http) on the same Wi-Fi, or use USB.' : message(err) })
    return
  }
  const split = lineSplitter((line) => { const e = decode(line); if (e) onEvent(e) })
  let t: Transport | null = null
  ws.onopen = () => {
    t = { write: (text) => { if (ws.readyState === WebSocket.OPEN) ws.send(text) }, close: async () => ws.close() }
    attached(t, 'wifi')
  }
  ws.onmessage = (m) => split(String(m.data) + '\n')
  ws.onclose = () => {
    if (t && transport === t) detached('Wi-Fi hub disconnected')
    else if (!t) useLink.setState({ status: 'off', error: `Could not reach ${url}` })
  }
}

/** Test hook: feed a report in as if it came off the radio. */
export const _injectForTest = (e: HubEvent) => onEvent(e)
