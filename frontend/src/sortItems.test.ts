import { describe, expect, it } from 'vitest'
import { SORTS_FOR, defaultSortFor, isSortKey, sortItems } from './sortItems'

const rows = [
  { title: 'Zodiac', year: 2007, rating: 7.7, addedAt: 300, updatedAt: 10 },
  { title: 'Arrival', year: 2016, rating: 7.6, addedAt: 100, updatedAt: 30 },
  { title: 'Élysée', year: 1999, rating: 9.1, addedAt: 200, updatedAt: 20 },
]
const titles = (key: Parameters<typeof sortItems>[1]) =>
  sortItems(rows, key).map(r => r.title)

describe('sortItems', () => {
  it('leaves the list untouched in natural order', () => {
    expect(sortItems(rows, 'natural')).toBe(rows)
  })

  it('does not mutate the input', () => {
    const before = rows.map(r => r.title)
    sortItems(rows, 'title.asc')
    expect(rows.map(r => r.title)).toEqual(before)
  })

  it('sorts titles with French collation, so accents are not exiled', () => {
    // A naive codepoint sort would put "Élysée" after "Zodiac".
    expect(titles('title.asc')).toEqual(['Arrival', 'Élysée', 'Zodiac'])
    expect(titles('title.desc')).toEqual(['Zodiac', 'Élysée', 'Arrival'])
  })

  it('sorts by year, rating and the library timestamps', () => {
    expect(titles('year.desc')).toEqual(['Arrival', 'Zodiac', 'Élysée'])
    expect(titles('year.asc')).toEqual(['Élysée', 'Zodiac', 'Arrival'])
    expect(titles('rating.desc')).toEqual(['Élysée', 'Zodiac', 'Arrival'])
    expect(titles('added.desc')).toEqual(['Zodiac', 'Élysée', 'Arrival'])
    expect(titles('watched.desc')).toEqual(['Arrival', 'Élysée', 'Zodiac'])
  })

  it('sorts rows with no value for the key last, not as zero', () => {
    const mixed = [
      { title: 'B', rating: undefined },
      { title: 'A', rating: 5 },
      { title: 'C', rating: 0 },
    ]
    expect(sortItems(mixed, 'rating.desc').map(r => r.title)).toEqual(['A', 'B', 'C'])
  })

  it('breaks ties by title so the order is reproducible', () => {
    const sameYear = [
      { title: 'Beta', year: 2020 },
      { title: 'Alpha', year: 2020 },
    ]
    expect(sortItems(sameYear, 'year.desc').map(r => r.title)).toEqual(['Alpha', 'Beta'])
  })
})

describe('surfaces', () => {
  it('defaults each surface to its first option', () => {
    expect(defaultSortFor('search')).toBe('natural')
    expect(defaultSortFor('saved')).toBe('added.desc')
    expect(defaultSortFor('watching')).toBe('watched.desc')
    expect(defaultSortFor('credits')).toBe('natural')
  })

  it('only offers keys the surface has data for', () => {
    // Search results carry no timestamps; the library's do not apply to credits.
    const search = SORTS_FOR.search.map(o => o.value)
    expect(search).not.toContain('added.desc')
    expect(search).not.toContain('watched.desc')
    expect(SORTS_FOR.credits.map(o => o.value)).not.toContain('added.desc')
    expect(SORTS_FOR.watching.map(o => o.value)).toContain('watched.desc')
  })

  it('validates keys against the surface offering them', () => {
    expect(isSortKey('added.desc', 'saved')).toBe(true)
    expect(isSortKey('added.desc', 'search')).toBe(false)
    expect(isSortKey('nonsense', 'search')).toBe(false)
  })
})
