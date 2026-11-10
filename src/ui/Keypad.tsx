import { useEffect } from 'react'
import { formatCompact, parseLength } from '../lib/units'

// Tape-measure fractions to the eighth; the parser reads a glyph glued to a number ("3½").
const FRACTIONS = ['⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
// Digits with feet / inches marks; a physical keyboard can still type space and / for "3 1/2".
const KEYS = ['7', '8', '9', '⌫', '4', '5', '6', "'", '1', '2', '3', '"', '0', '.']
const KEY_LABEL: Record<string, string> = { "'": "' ft", '"': '" in' }

export interface KeypadProps {
  /** The picked tower's name for the pad's head ("M3"). */
  tag: string
  text: string
  /** Height shown when nothing has been typed. */
  currentIn: number | null
  /** Under the name: where the current height came from. */
  hint: string
  maxFt: number
  setText(text: string): void
  /** A parseable length was typed (or null when the text no longer parses). */
  onEntry(inches: number): void
  onNext(step: number): void
  onClear?: () => void
  onSetAll?: () => void
  setAllLabel?: string
  onDone(): void
  disabled?: boolean
}

/** The tape-measure pad: slides up under the cards when a tower is picked. The picked card's height is the field. */
export function Keypad(p: KeypadProps) {
  const maxIn = p.maxFt * 12
  const type = (next: string) => {
    if (p.disabled) return
    p.setText(next)
    const inches = parseLength(next, p.maxFt)
    if (inches !== null && inches <= maxIn) p.onEntry(inches)
  }
  const press = (key: string) => type(key === '⌫' ? p.text.slice(0, -1) : p.text + key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[0-9.'"/ ]$/.test(e.key) || FRACTIONS.includes(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('⌫')
      else if (e.key === 'Enter' || e.key === 'Tab') p.onNext(e.shiftKey ? -1 : 1)
      else if (e.key === 'Escape') p.onDone()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const parsed = p.text ? parseLength(p.text, p.maxFt) : null
  const bad = p.text !== '' && (parsed === null || parsed > maxIn)

  return (
    <div className={`pad ${p.disabled ? 'disabled' : ''}`}>
      <div className="pad-head">
        <span className="winch-num">{p.tag}</span>
        <small>{p.text ? '' : p.hint}</small>
        <b className={bad ? 'bad' : ''}>{bad ? 'not a length' : p.text ? `= ${formatCompact(parsed!, 8)}` : p.currentIn === null ? '-' : formatCompact(p.currentIn, 8)}</b>
      </div>
      <div className="fractions">
        {FRACTIONS.map((f) => <button key={f} disabled={p.disabled} onClick={() => press(f)}>{f}</button>)}
      </div>
      <div className="keys">
        {KEYS.map((k) => <button key={k} disabled={p.disabled} className={KEY_LABEL[k] || k === '⌫' ? 'unit' : ''} onClick={() => press(k)}>{KEY_LABEL[k] ?? k}</button>)}
        <button className="primary" onClick={() => p.onNext(1)}>NEXT ▶</button>
      </div>
      <div className="pad-foot">
        <button onClick={p.onClear} disabled={!p.onClear}>CLEAR</button>
        <button disabled={bad || !p.onSetAll} onClick={p.onSetAll}>{p.setAllLabel ?? 'SET ALL'}</button>
        <button onClick={p.onDone}>DONE</button>
      </div>
    </div>
  )
}
