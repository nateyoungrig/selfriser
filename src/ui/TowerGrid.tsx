import { useEffect, useMemo, type ReactNode } from 'react'
import type { Tower } from '../model/types'
import { lineTolerance } from '../model/geometry'

/** Rank positions so the cards sit like the plan view: upstage on top, stage right on the left. */
function ranks(values: number[], tolFt: number): number[] {
  const unique: number[] = []
  for (const v of [...values].sort((a, b) => a - b)) if (!unique.length || v - unique[unique.length - 1] > tolFt) unique.push(v)
  return values.map((v) => unique.findIndex((u) => Math.abs(u - v) <= tolFt))
}

/**
 * One card per tower, laid out in plan. Wide: upstage on top. Narrow: the plan turned on its side,
 * stage right at the top, so cards keep their real neighbours and the downstage column reads 1, 2, 3
 * down the screen.
 */
export function TowerGrid({ towers, selected, cell, footer }: { towers: Tower[]; selected: number | null; cell(i: number, style: React.CSSProperties): ReactNode; footer?: ReactNode }) {
  const tol = useMemo(() => lineTolerance(towers), [towers])
  const cols = useMemo(() => ranks(towers.map((t) => t.x), tol), [towers, tol])
  const rows = useMemo(() => ranks(towers.map((t) => t.y), tol), [towers, tol])
  const nCols = Math.max(0, ...cols) + 1
  const nRows = Math.max(0, ...rows) + 1
  const rowName = (r: number) => (r === 0 ? 'UPSTAGE' : r === nRows - 1 ? 'DOWNSTAGE' : 'MID')
  // The picked card scrolls into view above the pad.
  useEffect(() => {
    if (selected !== null) document.querySelector('.cell.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="grid-wrap">
      <div className="grid-edge edge-wide">UPSTAGE</div>
      <div className="grid-cols-head edge-narrow" style={{ '--rows': nRows } as React.CSSProperties}>
        {Array.from({ length: nRows }, (_, r) => <span key={r}>{nRows > 1 ? rowName(r) : ''}</span>)}
      </div>
      <div className="tower-grid" style={{ '--cols': nCols, '--rows': nRows } as React.CSSProperties}>
        {towers.map((_, i) => cell(i, { '--col': cols[i] + 1, '--row': rows[i] + 1 } as React.CSSProperties))}
      </div>
      <div className="grid-edge">
        <span className="edge-wide">DOWNSTAGE &middot; AUDIENCE</span>
        <span className="edge-narrow">STAGE RIGHT at top &middot; STAGE LEFT at bottom</span>
        {footer && <span className="grid-total">{footer}</span>}
      </div>
    </div>
  )
}
