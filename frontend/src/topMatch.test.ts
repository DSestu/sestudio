import { describe, expect, it } from 'vitest'
import type { SeasonCard } from './api'
import { matchKey, pickTopMatch, splitYear } from './topMatch'

const card = (newsid: string, series_name: string, year = 0, extra: Partial<SeasonCard> = {}): SeasonCard => ({
  newsid,
  title: series_name,
  series_name,
  season_number: 0,
  poster_url: '',
  page_url: `https://x.example/${newsid}`,
  is_film: true,
  is_anime: false,
  source: 'fstream',
  year,
  ...extra,
})

// Real "dune" results, with the TMDB vote counts they had.
const dune2021 = card('1', 'Dune', 2021)
const dune1984 = card('2', 'Dune', 1984)
const dune2 = card('3', 'Dune : Deuxième partie', 2024)
const dreams = card('4', 'Dune Dreams', 2021)
const votes = new Map([['1', 15805], ['2', 3586], ['3', 7000], ['4', 20]])
const none = new Set<string>()
const pick = (cards: SeasonCard[], query: string, extra: { onDisk?: Set<string>; watching?: Set<string>; votes?: Map<string, number> } = {}) =>
  pickTopMatch({ cards, query, votes: extra.votes ?? votes, years: new Map(), onDisk: extra.onDisk ?? none, watching: extra.watching ?? none })

describe('matchKey', () => {
  it('ignores case, accents, punctuation and a leading article', () => {
    expect(matchKey('Le Seigneur des Anneaux')).toBe(matchKey('seigneur des anneaux'))
    expect(matchKey('Ténèbres')).toBe('tenebres')
    expect(matchKey("L'Île")).toBe('ile')
    expect(matchKey('Dune : Deuxième partie')).toBe('dune deuxieme partie')
  })
})

describe('splitYear', () => {
  it('pulls a year out of the query', () => {
    expect(splitYear('dune 1984')).toEqual({ title: 'dune', year: 1984 })
    expect(splitYear('dune')).toEqual({ title: 'dune', year: 0 })
  })
})

describe('pickTopMatch', () => {
  const cards = [dune2021, dune1984, dune2, dreams]

  it('picks the most-voted exact match when it leads by 3× (Dune 2021 over 1984)', () => {
    expect(pick(cards, 'dune')).toBe(dune2021)
  })

  it('shows no hero when the lead is under 3×', () => {
    expect(pick(cards, 'dune', { votes: new Map([['1', 5000], ['2', 3000]]) })).toBeNull()
  })

  it('needs an exact title match: "one" picks nothing', () => {
    expect(pick([card('9', 'One Piece'), card('8', 'One-Punch Man')], 'one')).toBeNull()
  })

  it('takes a lone exact match without votes', () => {
    expect(pick(cards, 'dune deuxieme partie', { votes: new Map() })).toBe(dune2)
  })

  it('lets a year in the query decide', () => {
    expect(pick(cards, 'dune 1984')).toBe(dune1984)
  })

  it('needs no clear lead when the title is on disk or being watched', () => {
    const close = new Map([['1', 5000], ['2', 3000]])
    expect(pick(cards, 'dune', { votes: close })).toBeNull()
    expect(pick(cards, 'dune', { votes: close, onDisk: new Set(['dune']) })).toBe(dune2021)
    expect(pick(cards, 'dune', { votes: close, watching: new Set(['dune']) })).toBe(dune2021)
  })

  it('returns null with no votes at all to tell two exact matches apart', () => {
    expect(pick([dune2021, dune1984], 'dune', { votes: new Map() })).toBeNull()
  })

  it('returns null for an empty query', () => {
    expect(pick(cards, '  ')).toBeNull()
  })
})
