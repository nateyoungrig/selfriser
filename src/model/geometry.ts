import type { Rect, RoofMember, StageDesign, Tower } from './types'

// Plan geometry shared by the shipped examples and the drawing importer: which towers are
// neighbours, where the truss runs go, crew-style numbering and squaring up hand-placed towers.

/** How close two towers have to be across a line to count as on it: 1 ft on a roof, less on a tabletop model. */
export function lineTolerance(towers: Pick<Tower, 'x' | 'y'>[]): number {
  if (towers.length < 2) return 1
  const e = extentOf(towers)
  return Math.min(1, Math.max(e.x1 - e.x0, e.y1 - e.y0) / 50)
}

export function extentOf(points: { x: number; y: number }[]): Rect {
  if (!points.length) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  }
}

/** Group values that sit within tol of each other; each group keeps the indices of its members. */
function clusters(values: number[], tol: number): number[][] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const out: number[][] = []
  for (const i of order) {
    const last = out[out.length - 1]
    if (last && values[i] - values[last[last.length - 1]] <= tol) last.push(i)
    else out.push([i])
  }
  return out
}

/** Towers sharing a row (same y) and a column (same x), each sorted along its line. */
export function lines(towers: Tower[], tolFt = lineTolerance(towers)): { rows: Tower[][]; cols: Tower[][] } {
  const rows = clusters(towers.map((t) => t.y), tolFt).map((g) => g.map((i) => towers[i]).sort((a, b) => a.x - b.x))
  const cols = clusters(towers.map((t) => t.x), tolFt).map((g) => g.map((i) => towers[i]).sort((a, b) => a.y - b.y))
  return { rows, cols }
}

/**
 * Adjacency for towers laid out on a (possibly irregular) grid: each tower pairs with the
 * next tower along its row and the next tower along its column.
 */
export function gridAdjacency(towers: Tower[], tolFt = lineTolerance(towers)): [string, string][] {
  const { rows, cols } = lines(towers, tolFt)
  const pairs: [string, string][] = []
  for (const line of [...rows, ...cols]) for (let i = 0; i + 1 < line.length; i++) pairs.push([line[i].id, line[i + 1].id])
  return pairs
}

/** The towers' footprint plus a sleeve all round: a starting roof outline before anyone draws one. */
export function autoRoof(towers: Tower[]): Rect {
  const e = extentOf(towers)
  const pad = Math.min(2, Math.max(e.x1 - e.x0, e.y1 - e.y0, 1) * 0.04)
  return { x0: e.x0 - pad, y0: e.y0 - pad, x1: e.x1 + pad, y1: e.y1 + pad }
}

/**
 * Truss runs through every row and column of towers. A run carries on to the roof edge past its
 * last tower when no other tower stands further out that way (the cantilevers); otherwise it
 * stops at its own end towers.
 */
export function autoMembers(towers: Tower[], roof: Rect, tolFt = lineTolerance(towers)): RoofMember[] {
  if (towers.length < 2) return []
  const e = extentOf(towers)
  const { rows, cols } = lines(towers, tolFt)
  const members: RoofMember[] = []
  rows.forEach((row, k) => {
    if (row.length < 2 && cols.length > 1) return
    const a = row[0].x <= e.x0 + tolFt ? roof.x0 : row[0].x
    const b = row[row.length - 1].x >= e.x1 - tolFt ? roof.x1 : row[row.length - 1].x
    if (b - a > tolFt) members.push({ id: `main-${k + 1}`, kind: 'main', a: [a, row[0].y], b: [b, row[0].y] })
  })
  cols.forEach((col, k) => {
    if (col.length < 2 && rows.length > 1) return
    const a = col[0].y <= e.y0 + tolFt ? roof.y0 : col[0].y
    const b = col[col.length - 1].y >= e.y1 - tolFt ? roof.y1 : col[col.length - 1].y
    if (b - a > tolFt) members.push({ id: `cross-${k + 1}`, kind: 'cross', a: [col[0].x, a], b: [col[0].x, b] })
  })
  return members
}

/** Number the towers the way crews call them: downstage row first, stage right to stage left, then each row upstage. */
export function crewNumbering(towers: Tower[], tolFt = lineTolerance(towers)): Tower[] {
  const order = lines(towers, tolFt).rows.reverse().flat()
  const number = new Map(order.map((t, k) => [t.id, k + 1]))
  return towers.map((t) => ({ ...t, label: String(number.get(t.id)), linkId: number.get(t.id)! }))
}

/** Hand-placed towers within tol of a shared row or column snap onto its average line. */
export function squareUp(towers: Tower[], tolFt = lineTolerance(towers)): Tower[] {
  const out = towers.map((t) => ({ ...t }))
  for (const axis of ['x', 'y'] as const) {
    for (const g of clusters(out.map((t) => t[axis]), tolFt)) {
      const mean = g.reduce((s, i) => s + out[i][axis], 0) / g.length
      for (const i of g) out[i][axis] = Math.round(mean * 96) / 96
    }
  }
  return out
}

const shiftRect = (r: Rect, dx: number, dy: number): Rect => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy })
const scaleRect = (r: Rect, k: number): Rect => ({ x0: r.x0 * k, y0: r.y0 * k, x1: r.x1 * k, y1: r.y1 * k })

/** Slide everything in the plan (towers, roof, truss, loads) by dx, dy feet. */
export function translateDesign<T extends StageDesign>(d: T, dx: number, dy: number): T {
  return {
    ...d,
    towers: d.towers.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
    roof: shiftRect(d.roof, dx, dy),
    members: d.members.map((m) => ({ ...m, a: [m.a[0] + dx, m.a[1] + dy], b: [m.b[0] + dx, m.b[1] + dy] })),
    areaLoads: d.areaLoads.map((a) => ({ ...a, ...shiftRect(a, dx, dy) })),
    pointLoads: d.pointLoads.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  }
}

/** Stretch everything in the plan about the origin: a drawing recalibrated after towers were placed on it. */
export function scaleDesign<T extends StageDesign>(d: T, k: number): T {
  return {
    ...d,
    towers: d.towers.map((t) => ({ ...t, x: t.x * k, y: t.y * k })),
    roof: scaleRect(d.roof, k),
    members: d.members.map((m) => ({ ...m, a: [m.a[0] * k, m.a[1] * k], b: [m.b[0] * k, m.b[1] * k] })),
    areaLoads: d.areaLoads.map((a) => ({ ...a, ...scaleRect(a, k) })),
    pointLoads: d.pointLoads.map((p) => ({ ...p, x: p.x * k, y: p.y * k })),
  }
}

/** Distance from point p to the segment a-b. */
export function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
