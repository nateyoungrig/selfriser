import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Rect, StageDesign } from '../model/types'
import { distToSegment } from '../model/geometry'
import { formatLength } from '../lib/units'

// The importer's drawing board: the plan sheet (or a feet grid) under the design being built, in plan
// feet. One finger drags the view, two fingers or the wheel zoom; a tap is a tap. In the tower tool a
// drag that starts on a tower moves that tower instead.

export type Pt = [number, number]

export interface Background {
  image: CanvasImageSource
  /** Where the image sits in plan feet. */
  rect: Rect
  /** Paper white (the PDF page) or already dark (a stored underlay). */
  paper: boolean
}

export interface PlanCanvasHandle {
  fit(): void
}

export interface Segment { a: Pt; b: Pt; label?: string; color: string }

interface Props {
  design: StageDesign
  background: Background | null
  /** Tower tool: drags on towers move them, taps snap to existing rows and columns. */
  towersEditable: boolean
  moveAll: boolean
  selectedTower: string | null
  selectedMember: string | null
  /** Markers and segments the current tool is drawing (scale line, pending corner, new run). */
  marks: Pt[]
  segments: Segment[]
  roofPreview: Rect | null
  onTap(p: Pt, hit: { tower: string | null; member: string | null }, snapped: Pt): void
  onMoveTower(id: string, p: Pt): void
  onMoveAll(dx: number, dy: number): void
  onDragEnd(): void
  handle?: Ref<PlanCanvasHandle>
}

const TAP_PX = 7
const HIT_PX = 18
const SNAP_PX = 10

export function PlanCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ ox: 0, oy: 0, k: 1 })
  const size = useRef({ w: 1, h: 1, dpr: 1 })
  const latest = useRef(props)
  latest.current = props
  const frame = useRef<number | null>(null)

  const draw = useCallback(() => {
    frame.current = null
    const c = canvasRef.current
    if (!c) return
    const p = latest.current
    const { w, h, dpr } = size.current
    const { ox, oy, k } = view.current
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = p.background?.paper ? '#e8e8e4' : '#10151c'
    ctx.fillRect(0, 0, w, h)
    const sx = (x: number) => (x - ox) * k
    const sy = (y: number) => (y - oy) * k

    if (p.background) {
      const r = p.background.rect
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(p.background.image, sx(r.x0), sy(r.y0), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k)
    } else {
      // Feet grid: 1' lines when zoomed in, then 10', 50'.
      for (const step of [1, 10, 50]) {
        if (step * k < 8) continue
        ctx.strokeStyle = step === 1 ? 'rgba(255,255,255,0.04)' : step === 10 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.16)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = Math.floor(ox / step) * step; x < ox + w / k; x += step) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), h) }
        for (let y = Math.floor(oy / step) * step; y < oy + h / k; y += step) { ctx.moveTo(0, sy(y)); ctx.lineTo(w, sy(y)) }
        ctx.stroke()
      }
    }

    const ink = p.background?.paper ? '#0f172a' : '#e2e8f0'
    const d = p.design
    // Roof outline.
    const roof = p.roofPreview ?? (d.roof.x1 > d.roof.x0 ? d.roof : null)
    if (roof) {
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = 2
      ctx.strokeRect(sx(roof.x0), sy(roof.y0), (roof.x1 - roof.x0) * k, (roof.y1 - roof.y0) * k)
      ctx.setLineDash([])
    }
    // Truss runs.
    for (const m of d.members) {
      ctx.strokeStyle = m.id === p.selectedMember ? '#facc15' : 'rgba(59,130,246,0.85)'
      ctx.lineWidth = m.id === p.selectedMember ? 5 : m.kind === 'main' ? 3 : 2
      ctx.beginPath(); ctx.moveTo(sx(m.a[0]), sy(m.a[1])); ctx.lineTo(sx(m.b[0]), sy(m.b[1])); ctx.stroke()
    }
    // Neighbour pairs, so a crew can see which differentials will be watched.
    const at = new Map(d.towers.map((t) => [t.id, t]))
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = 'rgba(34,197,94,0.8)'
    ctx.lineWidth = 1.5
    for (const [a, b] of d.adjacency) {
      const ta = at.get(a), tb = at.get(b)
      if (!ta || !tb) continue
      ctx.beginPath(); ctx.moveTo(sx(ta.x), sy(ta.y)); ctx.lineTo(sx(tb.x), sy(tb.y)); ctx.stroke()
    }
    ctx.setLineDash([])
    // Towers.
    ctx.font = '700 13px "Barlow Semi Condensed", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const t of d.towers) {
      const x = sx(t.x), y = sy(t.y)
      const sel = t.id === p.selectedTower
      ctx.fillStyle = sel ? '#facc15' : '#a78bfa'
      ctx.strokeStyle = sel ? '#000' : '#1e1b4b'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      // Crosshair through the center, so a tap can be checked against the drawing.
      ctx.strokeStyle = sel ? '#000' : '#1e1b4b'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke()
      ctx.fillStyle = '#0b0b16'
      ctx.fillText(t.label, x, y + 0.5)
      if (t.linkId !== Number(t.label)) {
        ctx.fillStyle = ink
        ctx.fillText(`#${t.linkId}`, x, y + 22)
      }
    }
    // Tool marks.
    for (const s of p.segments) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(sx(s.a[0]), sy(s.a[1])); ctx.lineTo(sx(s.b[0]), sy(s.b[1])); ctx.stroke()
      if (s.label) {
        const mx = (sx(s.a[0]) + sx(s.b[0])) / 2, my = (sy(s.a[1]) + sy(s.b[1])) / 2
        ctx.font = '700 15px "Barlow Semi Condensed", system-ui, sans-serif'
        const tw = ctx.measureText(s.label).width + 12
        ctx.fillStyle = 'rgba(0,0,0,0.8)'
        ctx.fillRect(mx - tw / 2, my - 22, tw, 20)
        ctx.fillStyle = '#fff'
        ctx.fillText(s.label, mx, my - 12)
        ctx.font = '700 13px "Barlow Semi Condensed", system-ui, sans-serif'
      }
    }
    for (const m of p.marks) {
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      const x = sx(m[0]), y = sy(m[1])
      ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12); ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke()
    }
  }, [])

  const redraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(draw)
  }, [draw])

  /** Frame the drawing (or the towers, with no drawing) in the canvas. */
  const fit = useCallback(() => {
    const p = latest.current
    const d = p.design
    const pts = d.towers.map((t) => [t.x, t.y])
    let r: Rect | null = p.background?.rect ?? null
    if (!r && (pts.length || d.roof.x1 > d.roof.x0)) {
      const xs = [...pts.map((q) => q[0]), d.roof.x0, d.roof.x1], ys = [...pts.map((q) => q[1]), d.roof.y0, d.roof.y1]
      r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    }
    r ??= { x0: -10, y0: -10, x1: 110, y1: 70 }
    const pad = 0.04 * Math.max(r.x1 - r.x0, r.y1 - r.y0, 1)
    const { w, h } = size.current
    const k = Math.min(w / (r.x1 - r.x0 + 2 * pad), h / (r.y1 - r.y0 + 2 * pad))
    view.current = { k, ox: (r.x0 + r.x1) / 2 - w / 2 / k, oy: (r.y0 + r.y1) / 2 - h / 2 / k }
    redraw()
  }, [redraw])

  useImperativeHandle(props.handle, () => ({ fit }), [fit])

  // Size the canvas to its box; fit the view the first time it has a size.
  useEffect(() => {
    const c = canvasRef.current!
    let fitted = false
    const ro = new ResizeObserver(() => {
      const box = c.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      // The board grows and shrinks as the panel under it changes: keep what's in the middle in the middle.
      const { k } = view.current
      view.current.ox += (size.current.w - box.width) / 2 / k
      view.current.oy += (size.current.h - box.height) / 2 / k
      size.current = { w: box.width, h: box.height, dpr }
      c.width = Math.round(box.width * dpr)
      c.height = Math.round(box.height * dpr)
      if (!fitted && box.width > 0) { fitted = true; fit() } else redraw()
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [fit, redraw])

  // A new background (another page, a rotation, a new scale) re-frames; anything else just redraws.
  const bg = props.background
  useEffect(() => { if (bg) fit() }, [bg, fit])
  useEffect(redraw)

  // ---- Pointers ----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ kind: 'pan' | 'tower' | 'all' | 'pinch'; id?: string; sx: number; sy: number; moved: boolean; last: Pt; dist?: number; mid?: Pt } | null>(null)

  const toWorld = (cx: number, cy: number): Pt => {
    const box = canvasRef.current!.getBoundingClientRect()
    const { ox, oy, k } = view.current
    return [(cx - box.left) / k + ox, (cy - box.top) / k + oy]
  }
  const hitTower = (p: Pt): string | null => {
    const { k } = view.current
    let best: string | null = null, bestD = HIT_PX / k
    for (const t of latest.current.design.towers) {
      const dd = Math.hypot(t.x - p[0], t.y - p[1])
      if (dd < bestD) { bestD = dd; best = t.id }
    }
    return best
  }
  const hitMember = (p: Pt): string | null => {
    const { k } = view.current
    let best: string | null = null, bestD = HIT_PX / k
    for (const m of latest.current.design.members) {
      const dd = distToSegment(p, m.a, m.b)
      if (dd < bestD) { bestD = dd; best = m.id }
    }
    return best
  }
  /** Snap onto another tower's row or column, a tower itself, or a roof edge, within a few pixels. */
  const snap = (p: Pt, exclude: string | null): Pt => {
    const tol = SNAP_PX / view.current.k
    const d = latest.current.design
    const others = d.towers.filter((t) => t.id !== exclude)
    const near = others.find((t) => Math.hypot(t.x - p[0], t.y - p[1]) < tol)
    if (near) return [near.x, near.y]
    let [x, y] = p
    const roof = d.roof.x1 > d.roof.x0 ? d.roof : null
    const xs = [...others.map((t) => t.x), ...(roof ? [roof.x0, roof.x1] : [])]
    const ys = [...others.map((t) => t.y), ...(roof ? [roof.y0, roof.y1] : [])]
    const nx = xs.reduce<number | null>((b, v) => (Math.abs(v - p[0]) < tol && (b === null || Math.abs(v - p[0]) < Math.abs(b - p[0])) ? v : b), null)
    const ny = ys.reduce<number | null>((b, v) => (Math.abs(v - p[1]) < tol && (b === null || Math.abs(v - p[1]) < Math.abs(b - p[1])) ? v : b), null)
    if (nx !== null) x = nx
    if (ny !== null) y = ny
    return [x, y]
  }

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', sx: 0, sy: 0, moved: true, last: [0, 0], dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] }
      return
    }
    if (pointers.current.size > 2) return
    const w = toWorld(e.clientX, e.clientY)
    const p = latest.current
    const tower = p.towersEditable ? hitTower(w) : null
    gesture.current = {
      kind: p.towersEditable && p.moveAll ? 'all' : tower ? 'tower' : 'pan',
      id: tower ?? undefined, sx: e.clientX, sy: e.clientY, moved: false, last: w,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid: Pt = [(a.x + b.x) / 2, (a.y + b.y) / 2]
      const before = toWorld(g.mid![0], g.mid![1])
      view.current.k *= dist / g.dist!
      const after = toWorld(mid[0], mid[1])
      view.current.ox += before[0] - after[0]
      view.current.oy += before[1] - after[1]
      g.dist = dist
      g.mid = mid
      redraw()
      return
    }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP_PX) return
    g.moved = true
    const w = toWorld(e.clientX, e.clientY)
    if (g.kind === 'pan') {
      view.current.ox -= w[0] - g.last[0]
      view.current.oy -= w[1] - g.last[1]
      redraw()
      return // the view moved under the pointer, so g.last stays the same world point
    }
    if (g.kind === 'tower') latest.current.onMoveTower(g.id!, snap(w, g.id!))
    else if (g.kind === 'all') latest.current.onMoveAll(w[0] - g.last[0], w[1] - g.last[1])
    g.last = w
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null
      return
    }
    gesture.current = null
    if (g.moved) {
      if (g.kind !== 'pan') latest.current.onDragEnd()
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    latest.current.onTap(w, { tower: hitTower(w), member: hitMember(w) }, snap(w, null))
  }

  const onWheel = (e: React.WheelEvent) => {
    const before = toWorld(e.clientX, e.clientY)
    view.current.k *= Math.exp(-e.deltaY * 0.0015)
    const after = toWorld(e.clientX, e.clientY)
    view.current.ox += before[0] - after[0]
    view.current.oy += before[1] - after[1]
    redraw()
  }

  return (
    <canvas
      ref={canvasRef} className="plan-canvas"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null }}
      onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
    />
  )
}

/** A length for a canvas label: feet and inches to the inch, or eighths under 10 ft. */
export const label = (ft: number) => formatLength(ft * 12, ft < 10 ? 8 : 1)
