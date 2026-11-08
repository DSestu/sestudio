import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../../musicFlows'
import { flowSentence, madeWhen } from './flowWords'

const flow = (layers: Chunk['layers']) => ({ chunks: [{ id: 'a', share: 1, next: [], layers }] })

describe('flowSentence', () => {
  it('reads the presets', () => {
    expect(flowSentence(flow({ energy: [[0, 0.2], [1, 0.5]], tempo: [[0, 170], [1, 172]] }))).toBe('Easy, rising to lively')
    expect(flowSentence(flow({ energy: [[0, 0.65], [1, 0.95]], harmony: [{ at: 0.5, kind: 'up' }] }))).toBe('High, rising to all out · up a fifth halfway')
    expect(flowSentence(flow({ energy: [[0, 0.55], [1, 0.55]] }))).toBe('Lively all the way')
    expect(flowSentence(flow({ energy: [[0, 0.6], [1, 0.15]], tempo: [[0, 172], [1, 145]], harmony: [{ at: 0, kind: 'break' }] })))
      .toBe('High down to calm · a break at the start · slows to 145')
  })
  it('names a genre layer and walks a shape with several moves', () => {
    expect(flowSentence(flow({ energy: [[0, 0.5], [1, 0.5]], genre: [{ from: 0, to: 1, genres: ['Progressive House'], strict: 'must' }] })))
      .toBe('Lively all the way · Progressive House only')
    expect(flowSentence(flow({ energy: [[0, 0.3], [0.33, 0.9], [0.4, 0.7], [1, 0.3]] }))).toBe('Easy, up to all out, down to high, down to easy')
  })
  it('says something for an empty flow', () => {
    expect(flowSentence(flow({}))).toBe('Any energy, any key')
  })
})

describe('madeWhen', () => {
  it('reads days', () => {
    const now = new Date(2026, 10, 8, 12).getTime()
    expect(madeWhen(now / 1000 - 3600, now)).toBe('made today')
    expect(madeWhen(now / 1000 - 86400, now)).toBe('made yesterday')
    expect(madeWhen(now / 1000 - 5 * 86400, now)).toBe('made 3 Nov')
  })
})
