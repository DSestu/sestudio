import { describe, expect, it } from 'vitest'
import type { SeasonCard } from './api'
import { cardSources, countBySource, filterBySources, formatSources, parseSources } from './sourceFilter'

const card = (source: string, extra: Partial<SeasonCard> = {}): SeasonCard => ({
  newsid: `${source}-${Math.random()}`,
  title: 'One Piece',
  series_name: 'One Piece',
  season_number: 1,
  poster_url: '',
  page_url: `https://${source}.example/1`,
  is_film: false,
  is_anime: true,
  source,
  ...extra,
})

describe('cardSources', () => {
  it('collects the card, its merged pages and its folded seasons', () => {
    const merged = card('french-manga', {
      alts: [card('uniquestream')],
      seasons: [card('kisskh', { alts: [card('kumo')] })],
    })
    expect([...cardSources(merged)].sort()).toEqual(['french-manga', 'kisskh', 'kumo', 'uniquestream'])
  })
})

describe('countBySource', () => {
  it('counts a title once per source it is on', () => {
    const cards = [card('fstream', { alts: [card('kisskh')] }), card('kisskh'), card('kisskh', { alts: [card('kisskh')] })]
    expect(Object.fromEntries(countBySource(cards))).toEqual({ fstream: 1, kisskh: 3 })
  })
})

describe('filterBySources', () => {
  const both = card('fstream', { alts: [card('kisskh')] })
  const kiss = card('kisskh')
  const fs = card('fstream')

  it('keeps everything when nothing is picked', () => {
    expect(filterBySources([both, kiss, fs], new Set())).toHaveLength(3)
  })

  it('keeps a title any picked source has', () => {
    expect(filterBySources([both, kiss, fs], new Set(['kisskh']))).toEqual([both, kiss])
    expect(filterBySources([both, kiss, fs], new Set(['kisskh', 'fstream']))).toEqual([both, kiss, fs])
  })
})

describe('src param', () => {
  it('round-trips, sorted, and is absent when empty', () => {
    expect([...parseSources('kisskh,fstream,')]).toEqual(['kisskh', 'fstream'])
    expect(formatSources(new Set(['kisskh', 'fstream']))).toBe('fstream,kisskh')
    expect(formatSources(new Set())).toBeUndefined()
    expect(parseSources(null).size).toBe(0)
  })
})
