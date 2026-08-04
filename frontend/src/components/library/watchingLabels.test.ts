import { describe, expect, it } from 'vitest'
import type { WatchingItem } from '../../watchState'
import { episodeLabel, watchingContext } from './watchingLabels'

function item(over: Partial<WatchingItem> = {}): WatchingItem {
  return {
    series: 'Bleach',
    season: 1,
    poster_url: 'p.jpg',
    page_url: 'u',
    lang: 'vf',
    resume: { number: 4, title: 'The Cursed Sword', position: 500, duration: 1000 },
    isNextUp: false,
    watchedCount: 3,
    updatedAt: 1000,
    ...over,
  }
}

describe('episodeLabel', () => {
  it('zero-pads season and episode', () => {
    expect(episodeLabel(1, 4)).toBe('S01E04')
    expect(episodeLabel(12, 130)).toBe('S12E130')
  })
})

describe('watchingContext', () => {
  it('names the episode being resumed', () => {
    expect(watchingContext(item())).toBe('S01E04 · The Cursed Sword')
  })

  it('marks a fresh episode as up next, without a title it does not know', () => {
    const next = item({ isNextUp: true, resume: { number: 5, title: '', position: 0, duration: 0 } })
    expect(watchingContext(next)).toBe('Up next · S01E05')
  })

  it('omits the episode label for a film', () => {
    const film = item({ season: 0, resume: { number: 0, title: 'Dune', position: 10, duration: 100 } })
    expect(watchingContext(film)).toBe('Dune')
  })

  it('falls back to "Film" when a film has no title', () => {
    const film = item({ season: 0, resume: { number: 0, title: '', position: 10, duration: 100 } })
    expect(watchingContext(film)).toBe('Film')
  })

  it('drops the separator when an episode title is missing', () => {
    expect(watchingContext(item({ resume: { number: 4, title: '', position: 1, duration: 2 } })))
      .toBe('S01E04')
  })
})
