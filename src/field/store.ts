import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Field state: the tape-measure fallback for towers without a laser, and which tower is picked.
// Laser readings themselves are never stored here; they come straight off the link.

export interface Tape {
  in: number
  at: number
}

interface FieldState {
  /** Per design, per tower id: the last height typed off a tape. */
  tape: Record<string, Record<string, Tape>>
  selected: number | null
  /** What has been typed for the picked tower since it was picked (not persisted). */
  entryText: string
}

export const useField = create<FieldState>()(
  persist((): FieldState => ({ tape: {}, selected: null, entryText: '' }), {
    name: 'selfriser-field',
    partialize: (s) => ({ tape: s.tape }),
  }),
)

export const selectTower = (i: number | null) => useField.setState({ selected: i, entryText: '' })
export const setEntryText = (entryText: string) => useField.setState({ entryText })

export function setTape(designId: string, towerId: string, inches: number | null) {
  useField.setState((s) => {
    const cur = { ...s.tape[designId] }
    if (inches === null) delete cur[towerId]
    else cur[towerId] = { in: inches, at: Date.now() }
    return { tape: { ...s.tape, [designId]: cur } }
  })
}

export function setAllTape(designId: string, towerIds: string[], inches: number) {
  const at = Date.now()
  useField.setState((s) => ({ tape: { ...s.tape, [designId]: Object.fromEntries(towerIds.map((id) => [id, { in: inches, at }])) } }))
}

export const clearTape = (designId: string) => useField.setState((s) => ({ tape: { ...s.tape, [designId]: {} } }))
