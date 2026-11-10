import { useEffect, useState } from 'react'

/** Number input that only commits valid values (on blur or Enter) and shows when it differs from the default. */
export function NumberField({ label, value, onChange, unit, base, min = 0, step }: {
  label?: string; value: number; onChange(v: number): void; unit?: string; base?: number; min?: number; step?: number
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Number(text)
    if (text.trim() !== '' && Number.isFinite(v) && v >= min) onChange(v)
    else setText(String(value))
  }
  return (
    <label className={`field ${base !== undefined && base !== value ? 'changed' : ''}`}>
      {label && <span>{label}</span>}
      <input
        type="number" inputMode="decimal" step={step ?? 'any'} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {unit && <em>{unit}</em>}
    </label>
  )
}
