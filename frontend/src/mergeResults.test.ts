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
})
