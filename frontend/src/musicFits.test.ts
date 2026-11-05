import { describe, expect, it } from 'vitest'
import { rankFits, type FitsFilters } from './musicFits'

const t = (id: string, camelot: string, bpm = 120, genre = 'House') => ({ id, camelot, bpm, genre })
const ref = t('a', '8A')
const pool = [t('same', '8A'), t('next', '9A'), t('clash', '3B'), t('fast', '8A', 160), t('other', '8A', 120, 'Dubstep')]
const base: FitsFilters = { harmony: 'same', mood: 'any', energy: 'any', genre: 'same', tempo: 'near' }
const ids = (f: Partial<FitsFilters>) => rankFits(ref, pool, { ...base, ...f }).map(r => r.id)

describe('rankFits', () => {
  it('Same notes keeps only all 7 shared, Close allows 6, Any allows a clash', () => {
    expect(ids({})).toEqual(['same'])
    expect(ids({ harmony: 'close' })).toEqual(['same', 'next'])
    expect(ids({ harmony: 'any' })).toContain('clash')
  })
  it('Genre and Tempo Any let other genres and big tempo changes in', () => {
    expect(ids({ genre: 'any' })).toContain('other')
    expect(ids({ tempo: 'any' })).toContain('fast')
  })
})
