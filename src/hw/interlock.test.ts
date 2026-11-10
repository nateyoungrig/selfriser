import { describe, expect, it } from 'vitest'
import { scaleModel as rig } from '../model/examples/scale-model'
import { alarmPair, interlockTrip } from './interlock'

// Towers 1-2 downstage, 3-4 upstage; neighbours 1-2, 3-4, 1-3, 2-4. Stop tolerance 1/2".
const all = [true, true, true, true]

describe('interlockTrip', () => {
  it('stays quiet inside tolerance', () => {
    expect(interlockTrip(rig, [5, 5.3, 5.1, 5.2], [0, 0, 0, 0], all, all)).toBeNull()
  })

  it('trips when a neighbouring pair reaches the stop tolerance and got worse', () => {
    expect(interlockTrip(rig, [5, 5.6, 5.1, 5.2], [0, 0, 0, 0], all, all)).toMatchObject({ a: 'DS1', b: 'DS2' })
  })

  it('lets a run that is closing the gap keep going', () => {
    expect(interlockTrip(rig, [5, 5.6, 5.1, 5.2], [4, 4.8, 4.1, 4.2], all, all)).toBeNull()
  })

  it('ignores towers without a live laser and pairs where nobody moves', () => {
    expect(interlockTrip(rig, [5, 0, 5, 5], [0, 0, 0, 0], [true, false, true, true], all)).toBeNull()
    // 1-2 is 1/2" apart but neither is moving; the pairs with a moving tower are fine.
    expect(interlockTrip(rig, [5.8, 6.3, 5.6, 5.9], [0, 0, 0, 0], all, [false, false, true, true])).toBeNull()
  })
})

describe('alarmPair (monitor only)', () => {
  it('sounds at the stop tolerance whether or not the gap is growing', () => {
    expect(alarmPair(rig, [5, 5.6, 5.1, 5.2], all)).toMatchObject({ a: 'DS1', b: 'DS2' })
    expect(alarmPair(rig, [5, 5.3, 5.1, 5.2], all)).toBeNull()
  })

  it('only trusts pairs where both lasers are reading', () => {
    expect(alarmPair(rig, [5, 0, 5, 5], [true, false, true, true])).toBeNull()
  })
})
