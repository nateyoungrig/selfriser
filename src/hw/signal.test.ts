import { describe, expect, it } from 'vitest'
import { linkQuality, prune } from './signal'

const every = (ms: number, from: number, to: number) => {
  const out: number[] = []
  for (let t = from; t <= to; t += ms) out.push(t)
  return out
}

describe('linkQuality', () => {
  it('a tower reporting 5 times a second is 100%', () => {
    expect(linkQuality(every(200, 0, 10000), 10000, 0)).toBe(100)
  })

  it('losing half the reports reads 50%', () => {
    const q = linkQuality(every(400, 0, 10000), 10000, 0)
    expect(q).toBeGreaterThanOrEqual(48)
    expect(q).toBeLessThanOrEqual(54)
  })

  it('a tower that just appeared is not penalised for the time before it did', () => {
    expect(linkQuality(every(200, 8000, 10000), 10000, 8000)).toBe(100)
  })

  it('silence is 0%, and faster-than-idle reporting caps at 100%', () => {
    expect(linkQuality([], 10000, 0)).toBe(0)
    expect(linkQuality(every(50, 0, 10000), 10000, 0)).toBe(100)
  })

  it('prune drops arrivals older than the window', () => {
    expect(prune([1000, 4000, 9000], 10000)).toEqual([9000])
  })
})
