import { useEffect, useState } from 'react'
import { formatLength, parseLength } from '../lib/units'

/** A length in feet, typed tape-measure style (23'4 1/2", 23 4.5, 280.5"); a bare number is feet. Commits on blur or Enter. */
export function LengthField({ label, valueFt, onChange, denom = 8, min = -Infinity, className }: {
  label?: string; valueFt: number; onChange(ft: number): void; denom?: number; min?: number; className?: string
}) {
  const show = (ft: number) => (ft < 0 ? '-' : '') + formatLength(Math.abs(ft) * 12, denom)
  const [text, setText] = useState(show(valueFt))
  useEffect(() => setText(show(valueFt)), [valueFt]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const neg = text.trim().startsWith('-')
    const inches = parseLength(neg ? text.trim().slice(1) : text, 100000)
    const ft = inches === null ? null : (neg ? -inches : inches) / 12
    if (ft !== null && ft >= min) onChange(ft)
    else setText(show(valueFt))
  }
  const input = (
    <input
      className={`length ${className ?? ''}`} value={text} inputMode="text" aria-label={label}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onFocus={(e) => e.target.select()}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
  return label ? <label className="field"><span>{label}</span>{input}</label> : input
}
