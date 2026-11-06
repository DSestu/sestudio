import { describe, expect, it } from 'vitest'
import { EMPTY_QUEUE, type QueueItem, type QueueState } from '../../../musicQueue'
import { forkAhead, type Flow } from '../../../musicFlows'

const slot = (chunk: string) => ({ chunk, join: 'match', fit: 1, event: null, relaxed: [] })
const item = (n: number, chunk: string): QueueItem => ({ item_id: `q${n}`, library: 'local', track_id: `t${n}`, flow: slot(chunk) })
const flow = {
  id: 'f', chunks: [
    { id: 'a', share: 1, next: ['b', 'c'], layers: {} },
    { id: 'b', share: 1, next: [], layers: {} },
    { id: 'c', share: 1, next: [], layers: {} },
  ],
} as unknown as Flow
const q = (current: number): QueueState => ({
  ...EMPTY_QUEUE,
  items: [item(1, 'a'), item(2, 'a'), item(3, 'a'), item(4, 'a'), item(5, 'b'), item(6, 'b')],
  current,
  source: { flow: 'f', mix: null, choices: {}, seed: 1, path: ['a', 'b'], auto: { a: 'b' }, minutes: 60 },
})

describe('forkAhead', () => {
  it('asks only when the fork is within two tracks', () => {
    expect(forkAhead(q(0), flow)).toBeNull()
    expect(forkAhead(q(1), flow)).toEqual({ chunk: 'a', futures: ['b', 'c'], taken: 'b', left: 2 })
    expect(forkAhead(q(3), flow)?.left).toBe(0)
  })
  it('says nothing once past the fork or without a flow', () => {
    expect(forkAhead(q(4), flow)).toBeNull()
    expect(forkAhead({ ...q(1), source: null }, flow)).toBeNull()
    expect(forkAhead(q(1), undefined)).toBeNull()
  })
})
