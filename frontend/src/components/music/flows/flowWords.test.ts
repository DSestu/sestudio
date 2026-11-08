import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../../musicFlows'
import { flowSentence, madeWhen } from './flowWords'

const flow = (layers: Chunk['layers']) => ({ chunks: [{ id: 'a', share: 1, next: [], layers }] })

describe('flowSentence', () => {
  const lean = (...ls: [number, number, 'lift' | 'hold' | 'ease'][]) => ls.map(([from, to, l]) => ({ from, to, lean: l }))
  it('says the moves, never a level (SPEC-blend S1)', () => {
    expect(flowSentence(flow({ energy: lean([0, 0.33, 'lift'], [0.33, 0.8, 'hold'], [0.8, 1, 'ease']) }))).toBe('Lifts, holds, then eases out')
    expect(flowSentence(flow({ energy: lean([0, 1, 'hold']), genre: [{ from: 0, to: 1, genres: ['Progressive House'], strict: 'must' }] })))
      .toBe('Holds all the way · Progressive House only')
    expect(flowSentence(flow({ energy: lean([0, 0.2, 'hold'], [0.2, 1, 'ease']), tempo: [[0, 172], [1, 145]], harmony: [{ at: 0, kind: 'break' }] })))
      .toBe('Holds, then eases out · a break first · slows down')
    expect(flowSentence(flow({ energy: lean([0, 1, 'lift']), harmony: [{ at: 0.5, kind: 'up' }] }))).toBe('Lifts all the way · up a fifth halfway')
    expect(flowSentence(flow({ energy: lean([0, 0.5, 'ease'], [0.5, 1, 'lift']) }))).toBe('Eases off, then lifts')
  })
  it('reads an older curve as its moves', () => {
    expect(flowSentence(flow({ energy: [[0, 0.3], [0.33, 0.9], [0.4, 0.7], [1, 0.3]] }))).toBe('Lifts, then eases out')
  })
  it('says something for an empty flow', () => {
    expect(flowSentence(flow({}))).toBe('Holds all the way')
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
