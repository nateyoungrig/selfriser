import { describe, expect, it } from 'vitest'
import { formatDelta, formatLength, parseLength } from './units'

describe('parseLength', () => {
  it.each([
    [`12'3 1/2"`, 147.5],
    [`12' 3.5`, 147.5],
    [`12'-3 1/2"`, 147.5],
    ['12-3 1/2', 147.5],
    ['12 3 1/2', 147.5],
    ['12 3', 147],
    [`12'`, 144],
    [`12.5'`, 150],
    ['147"', 147],
    ['147in', 147],
    ['12ft 3in', 147],
    ['5', 60],
    ['147', 147],
    ['4 1/2', 54],
    ['23’ 4½”', 280.5],
    [`0'`, 0],
  ])('%s -> %d', (text, inches) => expect(parseLength(text)).toBeCloseTo(inches, 6))

  it.each(['', 'abc', `12'3'4`, '1/0', '1 2 3 4', '-5'])('rejects %j', (text) => expect(parseLength(text)).toBeNull())
})

describe('format', () => {
  it('rounds to the nearest inch by default', () => {
    expect(formatLength(280.5)).toBe(`23'-5"`)
    expect(formatLength(280.4)).toBe(`23'-4"`)
    expect(formatDelta(2.25)).toBe('+2"')
    expect(formatDelta(-0.5)).toBe('-1"')
    expect(formatDelta(0.4)).toBe('0"')
  })
  it('formats feet-inches to eighths when asked', () => {
    expect(formatLength(280.5, 8)).toBe(`23'-4 1/2"`)
    expect(formatLength(60, 8)).toBe(`5'-0"`)
    expect(formatLength(143.99, 8)).toBe(`12'-0"`)
    expect(formatLength(7.125, 8)).toBe(`0'-7 1/8"`)
  })
  it('round-trips at eighths', () => {
    for (const v of [0, 0.125, 59.875, 60, 147.5, 733.25]) expect(parseLength(formatLength(v, 8))).toBeCloseTo(v, 6)
  })
  it('formats deltas to eighths when asked', () => {
    expect(formatDelta(2.25, 8)).toBe('+2 1/4"')
    expect(formatDelta(-0.5, 8)).toBe('-1/2"')
    expect(formatDelta(0.01, 8)).toBe('0"')
    expect(formatDelta(-6, 8)).toBe('-6"')
  })
})
