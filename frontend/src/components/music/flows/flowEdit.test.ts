import { describe, expect, it } from 'vitest'
import { branchAt, deleteChunk, insertChunk, pathOf, resize, spansOf } from './flowEdit'
import type { Chunk } from '../../../musicFlows'

const c = (id: string, next: string[], share = 1): Chunk => ({ id, share, next, layers: {} })
const NIGHT = { chunks: [c('warm', ['peak', 'deep']), c('peak', ['down'], 2), c('deep', ['down'], 2), c('down', [])] }
const ids = (cs: Chunk[]) => cs.map(x => x.id)

describe('flow edits', () => {
  it('follow the choice, then the generator, then the first future', () => {
    expect(ids(pathOf(NIGHT, {}))).toEqual(['warm', 'peak', 'down'])
    expect(ids(pathOf(NIGHT, {}, { warm: 'deep' }))).toEqual(['warm', 'deep', 'down'])
    expect(ids(pathOf(NIGHT, { warm: 'peak' }, { warm: 'deep' }))).toEqual(['warm', 'peak', 'down'])
    expect(spansOf(pathOf(NIGHT, {})).map(s => [s.a, s.b])).toEqual([[0, 0.25], [0.25, 0.75], [0.75, 1]])
  })
  it('insert a chunk in the middle, at the start and at the end', () => {
    const path = pathOf(NIGHT, {})
    const mid = insertChunk(NIGHT, path, 2, 'Plateau', {})
    expect(ids(pathOf(mid, {}))).toEqual(['warm', 'peak', 'plateau', 'down'])
    expect(mid.chunks.find(x => x.id === 'deep')!.next).toEqual(['down']) // the other future is untouched
    expect(ids(pathOf(insertChunk(NIGHT, path, 0, 'Intro', {}), {}))).toEqual(['intro', 'warm', 'peak', 'down'])
    expect(ids(pathOf(insertChunk(NIGHT, path, 3, 'Outro', {}), {}))).toEqual(['warm', 'peak', 'down', 'outro'])
    expect(NIGHT.chunks).toHaveLength(4) // a copy, never the original
  })
  it('branch here makes a second future from the same parent', () => {
    const [f, id] = branchAt(NIGHT, pathOf(NIGHT, {}), 'down')!
    expect(id).toBe('down-b')
    expect(f.chunks.find(x => x.id === 'peak')!.next).toEqual(['down', 'down-b'])
    expect(branchAt(NIGHT, pathOf(NIGHT, {}), 'warm')).toBeNull()
  })
  it('delete hands a chunk\'s futures to its parents', () => {
    const f = deleteChunk(NIGHT, 'peak')
    expect(f.chunks.find(x => x.id === 'warm')!.next).toEqual(['down', 'deep'])
    const g = deleteChunk(NIGHT, 'warm')
    expect(g.chunks[0].id).toBe('peak')
    expect(deleteChunk({ chunks: [c('only', [])] }, 'only').chunks).toHaveLength(1)
  })
  it('resize moves one boundary and keeps the total', () => {
    const f = resize(NIGHT, pathOf(NIGHT, {}), 1, 0.5)
    const s = f.chunks.map(x => x.share)
    expect(s[0] + s[1]).toBeCloseTo(3)
    expect(spansOf(pathOf(f, {}))[1].a).toBeCloseTo(0.5)
  })
})
