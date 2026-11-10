// What the app and the scale-model hub say to each other: one JSON object per line, both ways,
// over USB serial or a WebSocket. The hub turns these into ESP-NOW radio packets for the tower
// controllers (hardware/firmware/include/wire_format.h).

import type { Switch } from '../lib/sim'

/** Tower controller states, in the firmware's order. */
export const TOWER_STATES = ['idle', 'run', 'goto', 'limit', 'stall', 'nosensor'] as const
export type TowerState = (typeof TOWER_STATES)[number]

export type Command =
  /** Every tower's direction, index = tower number - 1. Towers stop 400 ms after the last one. */
  | { t: 'run'; d: Switch[] }
  | { t: 'stop' }
  /** Tower n runs to height h (inches above its zero) and stops. */
  | { t: 'goto'; n: number; h: number }
  /** Tower n (0 = all) takes its reading right now as height 0. */
  | { t: 'zero'; n: number }
  /** Top soft limit for tower n (0 = all), inches. */
  | { t: 'cfg'; n: number; max: number }

export interface Telemetry {
  t: 'tel'
  /** Tower number, 1-based: rig tower index + 1. */
  n: number
  /** Height above the tower's zero, inches. */
  h: number
  /** Raw laser distance, mm. */
  mm: number
  s: TowerState
  /** What the motor is doing: 1 up, -1 down, 0 stopped. */
  d: -1 | 0 | 1
  /** Laser range status, 0 = good reading. */
  q: number
  /** The tower's top soft limit, inches. */
  max: number
  /** Built monitor only: it measures and reports, and has no motor outputs. */
  mon: boolean
  /** 0 = heard straight from the tower; n = repeated to the hub by tower n. */
  via: number
}

export interface HubStatus {
  t: 'hub'
  fw: string
  net: number
  ch: number
  ip?: string
  /** Towers heard from in the last 2 s. */
  towers: number[]
}

export interface HubLog {
  t: 'log'
  m: string
}

export type HubEvent = Telemetry | HubStatus | HubLog

export const encode = (c: Command): string => JSON.stringify(c) + '\n'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One line from the hub, or null for anything that isn't a well-formed event (boot noise, partial lines). */
export function decode(line: string): HubEvent | null {
  let v: Record<string, unknown>
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  if (v.t === 'tel') {
    if (!num(v.n) || v.n < 1 || !num(v.h)) return null
    const s = TOWER_STATES.includes(v.s as TowerState) ? (v.s as TowerState) : 'idle'
    const d = v.d === 1 || v.d === -1 ? v.d : 0
    return { t: 'tel', n: v.n, h: v.h, mm: num(v.mm) ? v.mm : 0, s, d, q: num(v.q) ? v.q : 0, max: num(v.max) ? v.max : 0, mon: v.mon === 1 || v.mon === true, via: num(v.via) && v.via > 0 ? v.via : 0 }
  }
  if (v.t === 'hub') {
    return {
      t: 'hub',
      fw: String(v.fw ?? ''),
      net: num(v.net) ? v.net : 0,
      ch: num(v.ch) ? v.ch : 0,
      ip: typeof v.ip === 'string' ? v.ip : undefined,
      towers: Array.isArray(v.towers) ? v.towers.filter(num) : [],
    }
  }
  if (v.t === 'log') return { t: 'log', m: String(v.m ?? '') }
  return null
}

/** Reassemble lines from a byte stream that arrives in arbitrary chunks. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(buffer[nl] === '\r' ? nl + 2 : nl + 1)
      if (line) onLine(line)
    }
    // A hub that never sends a newline shouldn't grow this forever.
    if (buffer.length > 4096) buffer = ''
  }
}
