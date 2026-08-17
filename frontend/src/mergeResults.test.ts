import { describe, expect, it } from 'vitest'
import type { SeasonCard } from './api'
import { mergeCards } from './mergeResults'

function card(over: Partial<SeasonCard> = {}): SeasonCard {
  return {
    newsid: '1',
    title: 'Bleach : Fade to Black',
    series_name: 'Bleach : Fade to Black',
    season_number: 0,
    poster_url: 'p.jpg',
    page_url: 'https://fs16.lol/1.html',
    is_film: true,
    is_anime: false,
    ...over,
  }
}

describe('mergeCards', () => {
  it('collapses the same title into one card carrying the other pages', () => {
    const merged = mergeCards([
      card({ newsid: '1', page_url: 'a' }),
      card({ newsid: '2', page_url: 'b' }),
      card({ newsid: '3', page_url: 'c' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].newsid).toBe('1')
    expect(merged[0].alt_page_urls).toEqual(['b', 'c'])
  })

  it('keeps distinct titles apart', () => {
    const merged = mergeCards([
      card({ series_name: 'Bleach', page_url: 'a' }),
      card({ series_name: 'Frieren', page_url: 'b' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('keeps different seasons of one series apart', () => {
    const merged = mergeCards([
      card({ series_name: 'Bleach', is_film: false, season_number: 1, page_url: 'a' }),
      card({ series_name: 'Bleach', is_film: false, season_number: 2, page_url: 'b' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('does not merge a film into a season of the same name', () => {
    const merged = mergeCards([
      card({ is_film: true, season_number: 0, page_url: 'a' }),
      card({ is_film: false, season_number: 1, page_url: 'b' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('matches titles that differ only by case or padding', () => {
    const merged = mergeCards([
      card({ series_name: 'Bleach : Fade to Black', page_url: 'a' }),
      card({ series_name: '  bleach : fade to black ', page_url: 'b' }),
    ])
    expect(merged).toHaveLength(1)
  })

  it('prefers a card that has a poster as the primary', () => {
    const merged = mergeCards([
      card({ newsid: '1', poster_url: '', page_url: 'a' }),
      card({ newsid: '2', poster_url: 'has.jpg', page_url: 'b' }),
    ])
    expect(merged[0].newsid).toBe('2')
    expect(merged[0].alt_page_urls).toEqual(['a'])
  })

  it('borrows a year from an alternate when the primary lacks one', () => {
    const merged = mergeCards([
      card({ page_url: 'a', year: 0 }),
      card({ page_url: 'b', poster_url: '', year: 2008 }),
    ])
    expect(merged[0].year).toBe(2008)
  })

  it('leaves a lone card untouched, with no alt_page_urls', () => {
    const merged = mergeCards([card({ page_url: 'a' })])
    expect(merged[0].alt_page_urls).toBeUndefined()
  })

  it('preserves first-appearance order, so ranking survives', () => {
    const merged = mergeCards([
      card({ series_name: 'Zeta', page_url: 'a' }),
      card({ series_name: 'Alpha', page_url: 'b' }),
      card({ series_name: 'Zeta', page_url: 'c' }),
    ])
    expect(merged.map(c => c.series_name)).toEqual(['Zeta', 'Alpha'])
  })

  it('handles an empty result set', () => {
    expect(mergeCards([])).toEqual([])
  })

  it('carries the alternates whole, not just their urls', () => {
    const merged = mergeCards([
      card({ newsid: '1', page_url: 'a' }),
      card({ newsid: '2', page_url: 'b', poster_url: '' }),
    ])
    expect(merged[0].alts?.map(c => c.newsid)).toEqual(['2'])
  })

  describe('same name, different title', () => {
    it('keeps two years of one name apart', () => {
      const merged = mergeCards([
        card({ series_name: 'Dune', page_url: 'a', year: 1984 }),
        card({ series_name: 'Dune', page_url: 'b', year: 2021 }),
      ])
      expect(merged).toHaveLength(2)
      expect(merged.map(c => c.year)).toEqual([1984, 2021])
    })

    it('still merges mirrors when only one year is known', () => {
      const merged = mergeCards([
        card({ page_url: 'a', year: 2008 }),
        card({ page_url: 'b', poster_url: '', year: 0 }),
        card({ page_url: 'c', poster_url: '', year: 0 }),
      ])
      expect(merged).toHaveLength(1)
      expect(merged[0].alt_page_urls).toEqual(['b', 'c'])
    })

    it('leaves yearless cards alone rather than guessing which remake they are', () => {
      const merged = mergeCards([
        card({ series_name: 'Dune', page_url: 'a', year: 1984 }),
        card({ series_name: 'Dune', page_url: 'b', year: 2021 }),
        card({ series_name: 'Dune', page_url: 'c', poster_url: '', year: 0 }),
      ])
      expect(merged).toHaveLength(3)
      expect(merged.find(c => c.page_url === 'a')?.alt_page_urls).toBeUndefined()
    })

    it('splits yearless cards that carry different posters', () => {
      const merged = mergeCards([
        card({ series_name: 'Reborn', page_url: 'a', poster_url: '/u/one.jpg' }),
        card({ series_name: 'Reborn', page_url: 'b', poster_url: '/u/two.jpg' }),
      ])
      expect(merged).toHaveLength(2)
    })

    it('treats the same poster on different hosts as one title', () => {
      const merged = mergeCards([
        card({ page_url: 'a', poster_url: 'https://m1.lol/u/one.jpg' }),
        card({ page_url: 'b', poster_url: 'https://m2.lol/uploads/one.jpg?v=2' }),
      ])
      expect(merged).toHaveLength(1)
    })

    it('does not let the poster overrule a known year', () => {
      const merged = mergeCards([
        card({ page_url: 'a', poster_url: '/u/one.jpg', year: 2008 }),
        card({ page_url: 'b', poster_url: '/u/two.jpg', year: 2008 }),
      ])
      expect(merged).toHaveLength(1)
    })

    it('keeps an anime season apart from a live-action one of the same name', () => {
      const merged = mergeCards([
        card({ series_name: 'Bleach', is_film: false, season_number: 1, is_anime: true, page_url: 'a' }),
        card({ series_name: 'Bleach', is_film: false, season_number: 1, is_anime: false, page_url: 'b' }),
      ])
      expect(merged).toHaveLength(2)
    })
  })

  describe('TMDB identity', () => {
    it('merges differently-spelled listings that share an id', () => {
      const merged = mergeCards(
        [
          card({ newsid: '1', series_name: 'Bleach', page_url: 'a' }),
          card({ newsid: '2', series_name: 'Bleach VF', page_url: 'b', poster_url: '' }),
        ],
        new Map([['1', 30984], ['2', 30984]]),
      )
      expect(merged).toHaveLength(1)
      expect(merged[0].alt_page_urls).toEqual(['b'])
    })

    it('never folds two seasons of one series together', () => {
      const merged = mergeCards(
        [
          card({ newsid: '1', series_name: 'Bleach', is_film: false, season_number: 1, page_url: 'a' }),
          card({ newsid: '2', series_name: 'Bleach', is_film: false, season_number: 2, page_url: 'b' }),
        ],
        new Map([['1', 30984], ['2', 30984]]),
      )
      expect(merged).toHaveLength(2)
    })

    it('splits titles whose ids differ', () => {
      const merged = mergeCards(
        [
          card({ newsid: '1', series_name: 'Reborn', page_url: 'a' }),
          card({ newsid: '2', series_name: 'Reborn', page_url: 'b', poster_url: '' }),
        ],
        new Map([['1', 111], ['2', 222]]),
      )
      expect(merged).toHaveLength(2)
    })

    it('falls back to the title for cards with no id', () => {
      const merged = mergeCards(
        [
          card({ newsid: '1', page_url: 'a' }),
          card({ newsid: '2', page_url: 'b', poster_url: '' }),
        ],
        new Map(),
      )
      expect(merged).toHaveLength(1)
    })
  })

  describe('source sites', () => {
    it('never merges same-name titles from different sites by name alone', () => {
      const merged = mergeCards([
        card({ newsid: '1', page_url: 'a', source: 'fstream' }),
        card({ newsid: '2', page_url: 'b', source: 'other-site' }),
      ])
      expect(merged).toHaveLength(2)
    })

    it('merges cards across sites through a shared TMDB id, keeping their sources', () => {
      const merged = mergeCards(
        [
          card({ newsid: '1', page_url: 'a', source: 'fstream' }),
          card({ newsid: '2', page_url: 'b', source: 'other-site', poster_url: '' }),
        ],
        new Map([['1', 111], ['2', 111]]),
      )
      expect(merged).toHaveLength(1)
      expect(merged[0].alts?.[0].source).toBe('other-site')
    })
  })
  describe('collapsing seasons', () => {
    const s = (n: number, over: Partial<SeasonCard> = {}) =>
      card({
        newsid: `s${n}`,
        series_name: 'Naruto',
        is_film: false,
        season_number: n,
        page_url: `s${n}.html`,
        ...over,
      })

    it('leaves seasons apart unless asked to fold them', () => {
      expect(mergeCards([s(1), s(2), s(3)])).toHaveLength(3)
    })

    it('folds a show into its lowest season, listing the rest under seasons', () => {
      const merged = mergeCards([s(3), s(1), s(2)], undefined, undefined, true)
      expect(merged).toHaveLength(1)
      expect(merged[0].season_number).toBe(1)
      expect(merged[0].seasons?.map(c => c.season_number)).toEqual([2, 3])
    })

    it('keeps another show, and a film, out of the fold', () => {
      const merged = mergeCards(
        [s(1), s(2), s(1, { series_name: 'Bleach', newsid: 'b1' }), card({ newsid: 'f' })],
        undefined,
        undefined,
        true,
      )
      expect(merged).toHaveLength(3)
    })

    it('never folds a remake into the original', () => {
      const merged = mergeCards(
        [s(1, { year: 2002 }), s(2, { year: 2002 }), s(1, { newsid: 'r1', year: 2017 })],
        undefined,
        undefined,
        true,
      )
      expect(merged).toHaveLength(2)
    })
  })
})
