#!/usr/bin/env node
// A pretend hub with pretend towers, for trying the app's LINK before anything is soldered.
// Speaks the same JSON lines as the real hub over a WebSocket (no dependencies).
//
//   node hardware/fake-hub.mjs                       ws://localhost:8181, 4 model towers
//   node hardware/fake-hub.mjs 12 8181               12 towers
//   node hardware/fake-hub.mjs 12 8181 --monitor     12 full-size monitor-only towers (demo roof)
//   ... --hide 7                                     tower 7 out of the hub's sight, relayed by a neighbour
//
// Then `npm run dev`, open the app over http, tap the lasers pill -> CONNECT WI-FI HUB with ws://localhost:8181.
// Model towers run at their own speeds (heavier corners are slower), with laser noise, the 400 ms
// deadman, soft limits and GOTO, like the firmware. Monitor towers ignore the app, like the
// monitor-only firmware: a pretend crew runs a lift on the hoist controls, 16 fpm with each tower a
// few percent off, stopping every 20 s to bump the high towers back.

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--hide')
const monitor = process.argv.includes('--monitor')
const hideAt = process.argv.indexOf('--hide')
const hidden = hideAt > 0 ? Number(process.argv[hideAt + 1]) : 0
const count = Number(args[0] ?? 4)
const port = Number(args[1] ?? 8181)

const towers = Array.from({ length: count }, (_, i) => ({
  n: i + 1,
  h: 0,
  // in/s: about 30 rpm on a 3/4" spool, each motor a few percent off, going up; lowering is a bit faster.
  upIps: monitor ? 3.2 * (1 - 0.025 * Math.sin(i * 2.3 + 1)) : 1.2 * (1 - 0.06 * Math.sin(i * 2.3 + 1)),
  downIps: monitor ? 3.3 * (1 - 0.015 * Math.sin(i * 1.7)) : 1.3 * (1 - 0.03 * Math.sin(i * 1.7)),
  zeroMm: monitor ? 300 + i * 20 : 60 + i * 3,
  maxIn: monitor ? 66 * 12 : 30,
  mode: 'idle', // idle | run | goto
  runDir: 0,
  runUntil: 0,
  target: 0,
  motor: 0,
  state: 'idle',
  lastSent: 0,
}))

const clients = new Set()

function frame(text) {
  const body = Buffer.from(text)
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
  return Buffer.concat([head, body])
}
const emit = (obj) => { const f = frame(JSON.stringify(obj)); for (const c of clients) c.write(f) }

function handle(line) {
  let m
  try { m = JSON.parse(line) } catch { return }
  const now = Date.now()
  const pick = (n) => towers.filter((t) => !n || t.n === n)
  if (monitor && ['run', 'stop', 'goto'].includes(m.t)) {
    console.log(`monitor-only tower got "${m.t}": ignored (the real firmware has no motor outputs)`)
    return
  }
  if (m.t === 'run') {
    for (const t of towers) {
      t.mode = 'run'
      t.runDir = Math.sign(m.d?.[t.n - 1] ?? 0)
      t.runUntil = now + 400
    }
  } else if (m.t === 'stop') {
    for (const t of towers) { t.mode = 'idle'; t.runDir = 0 }
  } else if (m.t === 'goto') {
    for (const t of pick(m.n)) { t.mode = 'goto'; t.target = Math.min(t.maxIn, Math.max(0, m.h)) }
  } else if (m.t === 'zero') {
    for (const t of pick(m.n)) { t.zeroMm += t.h * 25.4; t.h = 0; t.mode = 'idle' }
  } else if (m.t === 'cfg') {
    for (const t of pick(m.n)) if (m.max > 0) t.maxIn = m.max
  }
}

function readFrames(socket) {
  let buf = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 2) {
      const op = buf[0] & 15
      let len = buf[1] & 127, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      const masked = buf[1] & 128
      if (buf.length < off + (masked ? 4 : 0) + len) return
      const mask = masked ? buf.subarray(off, off + 4) : null
      off += masked ? 4 : 0
      const data = Buffer.from(buf.subarray(off, off + len))
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]
      buf = buf.subarray(off + len)
      if (op === 8) { socket.end(); return }
      if (op === 1) for (const line of data.toString().split('\n')) if (line.trim()) handle(line)
    }
  })
}

const server = createServer((_, res) => { res.writeHead(426); res.end('WebSocket only') })
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  clients.add(socket)
  readFrames(socket)
  const drop = () => { clients.delete(socket); for (const t of towers) { t.mode = 'idle'; t.runDir = 0 } }
  socket.on('close', drop)
  socket.on('error', drop)
  emit({ t: 'log', m: `fake hub: ${count} towers` })
  console.log('app connected')
})

/** The pretend crew on a monitor rig: 20 s runs up, then bump anyone more than 1" above the lowest back down. */
let crewClock = 0
function crew(dt) {
  crewClock += dt
  const phase = crewClock % 30
  const low = Math.min(...towers.map((t) => t.h))
  for (const t of towers) {
    const top = t.h >= t.maxIn - 1
    if (phase < 20 && !top) { t.mode = 'run'; t.runDir = 1; t.runUntil = Date.now() + 400 }
    else if (phase >= 20 && t.h - low > 1) { t.mode = 'goto'; t.target = low }
    else if (t.mode !== 'goto') { t.mode = 'idle'; t.runDir = 0 }
  }
}

let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = (now - last) / 1000
  last = now
  if (monitor && clients.size) crew(dt)
  for (const t of towers) {
    if (t.mode === 'run' && now > t.runUntil) { t.mode = 'idle'; t.runDir = 0 }
    let want = t.mode === 'run' ? t.runDir : 0
    if (t.mode === 'goto') {
      const err = t.target - t.h
      if (Math.abs(err) <= 0.03) { t.mode = 'idle'; want = 0 } else want = Math.sign(err)
    }
    const allowed = want > 0 ? t.h < t.maxIn : want < 0 ? t.h > 0 : true
    t.state = t.mode === 'idle' || !want ? 'idle' : allowed ? t.mode : 'limit'
    t.motor = allowed ? want : 0
    if (t.motor) {
      const slow = t.mode === 'goto' ? Math.max(0.45, Math.min(1, Math.abs(t.target - t.h) / 0.5)) : 1
      t.h += t.motor * (t.motor > 0 ? t.upIps : t.downIps) * slow * dt
      t.h = Math.min(t.maxIn + 0.05, Math.max(-0.05, t.h))
    }
    if (now - t.lastSent >= (t.motor ? 50 : 200)) {
      t.lastSent = now
      const noisy = t.h + (Math.random() - 0.5) * 0.04
      // Monitor firmware never reports a motor: it doesn't know one is there.
      const tel = { t: 'tel', n: t.n, h: Math.round(noisy * 1000) / 1000, mm: Math.round(t.zeroMm + noisy * 25.4), s: monitor ? 'idle' : t.state, d: monitor ? 0 : t.motor, q: 0, max: t.maxIn }
      const relayed = t.n === hidden ? { via: (t.n % count) + 1 } : {}
      emit({ ...tel, ...(monitor ? { mon: 1 } : {}), ...relayed })
    }
  }
}, 20)
setInterval(() => emit({ t: 'hub', fw: 'fake-0.1.0', net: 1, ch: 1, towers: towers.map((t) => t.n) }), 1000)

server.listen(port, () => console.log(`fake hub on ws://localhost:${port} with ${count} ${monitor ? 'monitor-only full-size' : 'model'} towers`))
