import { describe, expect, it } from 'vitest'
import type { SeasonCard } from './api'
import { clearRecentSearches, matchesKind, parseKind, rememberSearch } from './titleSearch'

const card = (is_film: boolean, is_anime: boolean): SeasonCard => ({
  newsid: '1', title: 't', series_name: 't', season_number: 0, poster_url: '', page_url: '',
  is_film, is_anime,
})

describe('kind filter', () => {
  it('sorts each card into exactly one kind, anime films counting as anime', () => {
    const film = card(true, false), series = card(false, false), anime = card(false, true), animeFilm = card(true, true)
    expect([film, series, anime, animeFilm].map(c => matchesKind(c, 'films'))).toEqual([true, false, false, false])
    expect([film, series, anime, animeFilm].map(c => matchesKind(c, 'series'))).toEqual([false, true, false, false])
    expect([film, series, anime, animeFilm].map(c => matchesKind(c, 'anime'))).toEqual([false, false, true, true])
    expect([film, series, anime, animeFilm].every(c => matchesKind(c, 'all'))).toBe(true)
  })

  it('reads an unknown or missing `only` as everything', () => {
    expect(parseKind('anime')).toBe('anime')
    expect(parseKind('nope')).toBe('all')
    expect(parseKind(null)).toBe('all')
  })
})

describe('recent searches', () => {
  it('keeps the last five, newest first, one per term whatever its case', () => {
    clearRecentSearches()
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f']) rememberSearch(t, 'all')
    rememberSearch('C', 'anime')
    expect(JSON.parse(localStorage.getItem('sestudio.searches.recent') ?? '[]')).toEqual([
      { term: 'C', kind: 'anime' },
      { term: 'f', kind: 'all' },
      { term: 'e', kind: 'all' },
      { term: 'd', kind: 'all' },
      { term: 'b', kind: 'all' },
    ])
  })
})
