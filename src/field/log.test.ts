import { beforeEach, describe, expect, it } from 'vitest'
import { isRecording, recordSample, samplesFor, setRecording, shouldSample, useLog } from './log'

const stage = { id: 'stage-1', name: 'Test stage', towers: [{ label: '1' }, { label: '2' }] }

describe('lift log', () => {
  beforeEach(() => {
    setRecording(false)
    useLog.setState({ recordings: [], current: null })
  })

  it('is off by default and keeps nothing while off', () => {
    expect(isRecording()).toBe(false)
    recordSample(stage, [10, 12], 0)
    expect(useLog.getState().recordings).toHaveLength(0)
  })

  it('keeps samples per stage with the stage named, while on', () => {
    setRecording(true)
    recordSample(stage, [10, 12], 0)
    recordSample(stage, [11, 13], 2000)
    setRecording(false)
    const [rec] = useLog.getState().recordings
    expect(rec.endedAt).not.toBeNull()
    expect(rec.stages?.[stage.id]).toEqual({ name: 'Test stage', towers: ['1', '2'] })
    expect(samplesFor(rec, stage.id)).toEqual([[10, 12], [11, 13]])
  })
})

describe('shouldSample', () => {
  const s = (t: number, h: (number | null)[]) => ({ t, rigId: 'x', heightsIn: h })

  it('takes the first reading and skips empty ones', () => {
    expect(shouldSample(undefined, [10, 12], 0)).toBe(true)
    expect(shouldSample(undefined, [null, null], 0)).toBe(false)
  })

  it('at most once a second, and only when something moved 1/8" or 10 s went by', () => {
    const last = s(0, [10, 12])
    expect(shouldSample(last, [11, 12], 500)).toBe(false)
    expect(shouldSample(last, [10.05, 12], 2000)).toBe(false)
    expect(shouldSample(last, [10.2, 12], 2000)).toBe(true)
    expect(shouldSample(last, [10, 12], 10000)).toBe(true)
  })

  it('a tower dropping out or coming back counts as a change', () => {
    expect(shouldSample(s(0, [10, 12]), [10, null], 2000)).toBe(true)
  })
})
