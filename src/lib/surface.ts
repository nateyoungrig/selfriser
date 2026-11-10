// Moving-least-squares shape functions over the tower layout.
//
// phi_i(x, y) answers two questions at once:
//   - roof height at (x, y) given tower heights h:        z = sum(phi_i * h_i)
//   - share of a load placed at (x, y) carried by tower i: R_i = P * phi_i
// They are the same numbers (reciprocity): a locally-weighted plane through the towers.
// phi sums to 1 and reproduces position, so loads stay in force + moment equilibrium and
// cantilevered loads correctly lever extra weight onto the near row and off the far row.

export interface XY { x: number; y: number }

/** Solve the symmetric 3x3 system M * v = [1, 0, 0] (first column of the inverse). */
function firstInverseColumn(m: number[][]): [number, number, number] {
  const [[a, b, c], [, d, e], [, , f]] = m
  const c00 = d * f - e * e
  const c01 = c * e - b * f
  const c02 = b * e - c * d
  const det = a * c00 + b * c01 + c * c02
  return [c00 / det, c01 / det, c02 / det]
}

export function shapeFunctions(towers: XY[], x: number, y: number, power = 4, coreFt = 1): number[] {
  const w = towers.map((t) => 1 / Math.pow((t.x - x) ** 2 + (t.y - y) ** 2 + coreFt ** 2, power / 2))
  let s = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
  towers.forEach((t, i) => {
    const dx = t.x - x, dy = t.y - y
    s += w[i]; sx += w[i] * dx; sy += w[i] * dy
    sxx += w[i] * dx * dx; sxy += w[i] * dx * dy; syy += w[i] * dy * dy
  })
  // Tiny ridge on the slope terms keeps single-row (collinear) rigs solvable.
  const ridge = 1e-9 * (sxx + syy) + 1e-300
  const [v0, v1, v2] = firstInverseColumn([
    [s, sx, sy],
    [sx, sxx + ridge, sxy],
    [sy, sxy, syy + ridge],
  ])
  return towers.map((t, i) => w[i] * (v0 + v1 * (t.x - x) + v2 * (t.y - y)))
}

export function interpolate(phi: number[], values: number[]): number {
  let z = 0
  for (let i = 0; i < phi.length; i++) z += phi[i] * values[i]
  return z
}
