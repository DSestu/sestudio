import { describe, expect, it } from 'vitest'
import { foldToTitles, refKey } from './collections'

/** A pre-#26 episode-level entry. */
function legacyEpisode(number: number, addedAt: number, label = `E${number}`) {
  return {
    kind: 'episode',
    series: 'Bleach',
    season: 1,
    number,
    label,
    poster_url: 'p.jpg',
    page_url: 'u',
    lang: 'vf',
    addedAt,
  }
}

function titleEntry(addedAt: number, label = 'Bleach') {
  return {
    series: 'Bleach',
    season: 1,
    label,
    poster_url: 'p.jpg',
    page_url: 'u',
    lang: 'vf',
    addedAt,
  }
}

// Collections are title-only (#26), so every key is season-level. The episode
// form that used to exist here went away with `kind`/`number` in T3.

describe('refKey', () => {
  it('keys a whole title by series and season', () => {
    expect(refKey({ series: 'Bleach', season: 1 })).toBe('Bleach|S1')
  })

  it('keys a film by season 0', () => {
    expect(refKey({ series: 'Dune', season: 0 })).toBe('Dune|S0')
  })
})

describe('foldToTitles', () => {
  it('folds episode entries onto one title key', () => {
    const { entries, staleKeys } = foldToTitles({
      'Bleach|S1|E2': legacyEpisode(2, 100),
      'Bleach|S1|E5': legacyEpisode(5, 200),
    })
    expect(Object.keys(entries)).toEqual(['Bleach|S1'])
    expect(staleKeys.sort()).toEqual(['Bleach|S1|E2', 'Bleach|S1|E5'])
  })

  it('relabels a folded entry with the series, not the episode title', () => {
    const { entries } = foldToTitles({
      'Bleach|S1|E2': legacyEpisode(2, 100, 'The Cursed Sword'),
    })
    expect(entries['Bleach|S1'].label).toBe('Bleach')
  })

  it('keeps the earliest addedAt between folded siblings', () => {
    const { entries } = foldToTitles({
      'Bleach|S1|E5': legacyEpisode(5, 200),
      'Bleach|S1|E2': legacyEpisode(2, 100),
    })
    expect(entries['Bleach|S1'].addedAt).toBe(100)
  })

  it('lets an existing title entry win over folded ones', () => {
    const { entries } = foldToTitles({
      'Bleach|S1|E2': legacyEpisode(2, 100),
      'Bleach|S1': titleEntry(500, 'Bleach TYBW'),
    })
    expect(entries['Bleach|S1'].addedAt).toBe(500)
    expect(entries['Bleach|S1'].label).toBe('Bleach TYBW')
  })

  it('lets a title entry win regardless of iteration order', () => {
    const { entries } = foldToTitles({
      'Bleach|S1': titleEntry(500),
      'Bleach|S1|E2': legacyEpisode(2, 100),
    })
    expect(entries['Bleach|S1'].addedAt).toBe(500)
  })

  it('is a no-op on an already title-only list', () => {
    const input = { 'Bleach|S1': titleEntry(100), 'Dune|S0': { ...titleEntry(200), series: 'Dune', season: 0 } }
    const { entries, staleKeys } = foldToTitles(input)
    expect(staleKeys).toEqual([])
    expect(entries).toEqual(input)
  })

  it('drops the legacy kind and number fields', () => {
    const { entries } = foldToTitles({ 'Bleach|S1|E2': legacyEpisode(2, 100) })
    expect(entries['Bleach|S1']).not.toHaveProperty('kind')
    expect(entries['Bleach|S1']).not.toHaveProperty('number')
  })

  it('keeps distinct series and seasons apart', () => {
    const { entries } = foldToTitles({
      'Bleach|S1|E2': legacyEpisode(2, 100),
      'Bleach|S2|E1': { ...legacyEpisode(1, 150), season: 2 },
    })
    expect(Object.keys(entries).sort()).toEqual(['Bleach|S1', 'Bleach|S2'])
  })
})
