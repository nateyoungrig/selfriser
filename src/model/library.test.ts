import { describe, expect, it } from 'vitest'
import { exampleDesigns } from './examples'
import { removeDesign, restoreExamples, sanitizeDesign, useLibrary } from './library'

describe('stage design library', () => {
  it('starts with the examples', () => {
    expect(useLibrary.getState().designs.map((d) => d.example)).toEqual(exampleDesigns(0).map((d) => d.example))
  })

  it('never removes the last design, and RESTORE EXAMPLES brings removed ones back', () => {
    const ids = useLibrary.getState().designs.map((d) => d.id)
    for (const id of ids.slice(1)) expect(removeDesign(id)).toBe(true)
    expect(removeDesign(ids[0])).toBe(false)
    expect(useLibrary.getState().designs).toHaveLength(1)
    expect(restoreExamples()).toBe(ids.length - 1)
    expect(useLibrary.getState().designs).toHaveLength(ids.length)
  })

  it('a design from a file is filled out, never drives motors, and has no towers dropped silently', () => {
    const d = sanitizeDesign({ name: 'From a file', towers: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 'bad' }], hardwareControl: true })!
    expect(d.towers).toHaveLength(2)
    expect(d.towers.map((t) => t.linkId)).toEqual([1, 2])
    expect(d.hardwareControl).toBe(false)
    expect(d.adjacency).toEqual([['T1', 'T2']])
    expect(d.tolerance).toEqual({ warnIn: 4, stopIn: 8 })
    expect(sanitizeDesign({ towers: [] })).toBeNull()
  })
})
