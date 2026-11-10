import { pressLocal, releaseLocal } from './hold'
import type { Switch } from '../lib/sim'
import { lab } from './store'

/**
 * A winch's selector switch: ▲ / OFF / ▼. Tapping ▲ or ▼ also bumps that winch once in that
 * direction; holding it runs the winch alone until you let go. The position sets what GO does.
 */
export function SwitchControl({ i, n, value, size = 'small' }: { i: number; n: number; value: Switch; size?: 'small' | 'large' }) {
  const local = (dir: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); pressLocal(i, dir, n) },
    onPointerUp: (e: React.PointerEvent) => { e.stopPropagation(); releaseLocal() },
    onPointerCancel: releaseLocal,
    onLostPointerCapture: releaseLocal,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })
  return (
    <div className={`switch ${size} pos${value}`} onClick={(e) => e.stopPropagation()}>
      <button className="sw-up" title="Up: tap = bump up, hold = run this winch up" {...local(1)}>▲</button>
      <button className="sw-off" title="Off" onClick={(e) => { e.stopPropagation(); lab.setSwitch(i, 0) }}>{size === 'large' ? 'OFF' : '○'}</button>
      <button className="sw-down" title="Down: tap = bump down, hold = run this winch down" {...local(-1)}>▼</button>
    </div>
  )
}
