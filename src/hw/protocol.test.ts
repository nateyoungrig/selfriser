import { describe, expect, it } from 'vitest'
import { decode, encode, lineSplitter } from './protocol'

describe('hub protocol', () => {
  it('encodes one command per line', () => {
    expect(encode({ t: 'run', d: [1, 0, -1, 1] })).toBe('{"t":"run","d":[1,0,-1,1]}\n')
    expect(encode({ t: 'goto', n: 2, h: 12.5 })).toBe('{"t":"goto","n":2,"h":12.5}\n')
  })

  it('decodes telemetry as the hub prints it', () => {
    expect(decode('{"t":"tel","n":3,"h":12.345,"mm":456,"s":"stall","d":1,"q":0,"max":30}')).toEqual({ t: 'tel', n: 3, h: 12.345, mm: 456, s: 'stall', d: 1, q: 0, max: 30, mon: false, via: 0 })
  })

  it('tolerates unknown states and missing fields', () => {
    expect(decode('{"t":"tel","n":1,"h":0}')).toEqual({ t: 'tel', n: 1, h: 0, mm: 0, s: 'idle', d: 0, q: 0, max: 0, mon: false, via: 0 })
    expect(decode('{"t":"tel","n":1,"h":1,"s":"dancing","d":7}')).toMatchObject({ s: 'idle', d: 0 })
  })

  it('flags monitor-only towers', () => {
    expect(decode('{"t":"tel","n":2,"h":240.5,"mm":6200,"s":"idle","d":0,"q":0,"max":792,"mon":1}')).toMatchObject({ n: 2, mon: true })
  })

  it('says which tower relayed a report', () => {
    expect(decode('{"t":"tel","n":7,"h":100,"via":4}')).toMatchObject({ n: 7, via: 4 })
    expect(decode('{"t":"tel","n":7,"h":100}')).toMatchObject({ via: 0 })
  })

  it('rejects boot noise and malformed reports', () => {
    expect(decode('ESP-ROM:esp32c3-api1-20210207')).toBeNull()
    expect(decode('{"t":"tel","n":0,"h":1}')).toBeNull()
    expect(decode('{"t":"tel","n":1}')).toBeNull()
    expect(decode('{"t":"nope"}')).toBeNull()
    expect(decode('null')).toBeNull()
  })

  it('decodes hub status and log lines', () => {
    expect(decode('{"t":"hub","fw":"0.1.0","net":1,"ch":6,"ip":"10.0.0.9","towers":[1,2,"x"]}')).toEqual({ t: 'hub', fw: '0.1.0', net: 1, ch: 6, ip: '10.0.0.9', towers: [1, 2] })
    expect(decode('{"t":"log","m":"hub up"}')).toEqual({ t: 'log', m: 'hub up' })
  })

  it('reassembles lines split across chunks, CRLF or LF', () => {
    const lines: string[] = []
    const feed = lineSplitter((l) => lines.push(l))
    feed('{"t":"log",')
    feed('"m":"a"}\r')
    feed('\n{"t":"log","m":"b"}\n\n{"t"')
    expect(lines).toEqual(['{"t":"log","m":"a"}', '{"t":"log","m":"b"}'])
    feed(':"log","m":"c"}\n')
    expect(lines[2]).toBe('{"t":"log","m":"c"}')
  })
})
