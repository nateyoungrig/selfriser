import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from '../app/ui'
import { setActive, useLibrary } from '../model/library'
import { _injectForTest, motionAllowed, useLink } from './link'
import '../lab/hold'
import { exampleDesigns } from '../model/examples'

// The safety rule: the app only ever drives motors in the Lab, on a design that is a bench model,
// with the link not switched to monitor only and no tower reporting a monitor-only build.
const byExample = (ex: string) => useLibrary.getState().designs.find((d) => d.example === ex)!.id
const fullSize = exampleDesigns(0).filter((d) => !d.hardwareControl).map((d) => d.example!)

describe('motionAllowed', () => {
  beforeEach(() => {
    useLink.setState({ monitor: false })
    useUi.setState({ mode: 'field' })
  })

  it('never in the field, not even for the bench model', () => {
    for (const ex of [...fullSize, 'scale-model']) {
      setActive(byExample(ex))
      expect(motionAllowed()).toBe(false)
    }
  })

  it('never for a full-size roof, in the Lab either', () => {
    useUi.setState({ mode: 'lab' })
    expect(fullSize.length).toBeGreaterThan(0)
    for (const ex of fullSize) {
      setActive(byExample(ex))
      expect(motionAllowed()).toBe(false)
    }
  })

  it('a choice for the bench model in the Lab', () => {
    useUi.setState({ mode: 'lab' })
    setActive(byExample('scale-model'))
    expect(motionAllowed()).toBe(true)
    useLink.setState({ monitor: true })
    expect(motionAllowed()).toBe(false)
  })

  it('off as soon as any tower says it was built monitor only', () => {
    useUi.setState({ mode: 'lab' })
    setActive(byExample('scale-model'))
    _injectForTest({ t: 'tel', n: 1, h: 3, mm: 100, s: 'idle', d: 0, q: 0, max: 30, mon: true, via: 0 })
    expect(motionAllowed()).toBe(false)
  })
})
