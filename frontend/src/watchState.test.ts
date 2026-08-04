import { beforeEach, describe, expect, it } from 'vitest'
import type { PlayableEpisode } from './providers'
import type { WatchEntry } from './watchState'
import {
  dismissSeries,
  getProgress,
  saveProgress,
  setWatched,
  watchKey,
  watching,
} from './watchState'

function entry(over: Partial<WatchEntry> = {}): WatchEntry {
  return {
    series: 'Bleach',
    season: 1,
    number: 4,
    title: 'The Cursed Sword',
    poster_url: 'p.jpg',
    page_url: 'u',
    lang: 'vf',
    position: 500,
    duration: 1000,
    watched: false,
    updatedAt: 1000,
    ...over,
  }
}

/** A state keyed the way the store keys it, from a list of entries. */
function stateOf(...entries: WatchEntry[]): Record<string, WatchEntry> {
  return Object.fromEntries(
    entries.map(e => [watchKey(e.series, e.season, e.number), e]),
  )
}

function playable(over: Partial<PlayableEpisode> = {}): PlayableEpisode {
  return {
    number: 4,
    title: 'The Cursed Sword',
    embed_urls: {},
    series_name: 'Bleach',
    season: 1,
    poster_url: 'p.jpg',
    page_url: 'u',
    lang: 'vf',
    ...over,
  }
}

describe('watching() — resume target per series', () => {
  it('resumes a partially-watched episode', () => {
    const [item] = watching(stateOf(entry({ position: 500, duration: 1000 })))
    expect(item.resume.number).toBe(4)
    expect(item.isNextUp).toBe(false)
    expect(item.resume.position).toBe(500)
  })

  it('offers the next episode once the latest is watched', () => {
    const [item] = watching(
      stateOf(entry({ watched: true, seasonEpisodes: 20 })),
    )
    expect(item.resume.number).toBe(5)
    expect(item.isNextUp).toBe(true)
  })

  it('omits a series whose season is finished', () => {
    const state = stateOf(
      entry({ number: 20, watched: true, seasonEpisodes: 20 }),
    )
    expect(watching(state)).toEqual([])
  })

  it('offers the next episode when the season length is unknown', () => {
    const [item] = watching(
      stateOf(entry({ number: 20, watched: true, seasonEpisodes: undefined })),
    )
    expect(item.resume.number).toBe(21)
    expect(item.isNextUp).toBe(true)
  })

  it('omits a watched film, which has no next episode', () => {
    const state = stateOf(entry({ season: 0, number: 0, watched: true }))
    expect(watching(state)).toEqual([])
  })

  it('omits a dismissed series until there is newer activity', () => {
    const dismissed = stateOf(entry({ updatedAt: 1000, dismissedAt: 2000 }))
    expect(watching(dismissed)).toEqual([])

    // Playback after the dismissal brings the series back.
    const resumed = stateOf(entry({ updatedAt: 3000, dismissedAt: 2000 }))
    expect(watching(resumed)).toHaveLength(1)
  })
})

describe('watching() — grouping', () => {
  it('collapses several in-progress episodes of one series into one item', () => {
    const state = stateOf(
      entry({ number: 2, watched: true, updatedAt: 1000 }),
      entry({ number: 3, watched: true, updatedAt: 2000 }),
      entry({ number: 4, watched: false, updatedAt: 3000 }),
    )
    const items = watching(state)
    expect(items).toHaveLength(1)
    expect(items[0].resume.number).toBe(4)
    expect(items[0].watchedCount).toBe(2)
  })

  it('keeps separate series separate, newest first', () => {
    const state = {
      ...stateOf(entry({ series: 'Bleach', updatedAt: 1000 })),
      ...stateOf(entry({ series: 'Frieren', updatedAt: 2000 })),
    }
    expect(watching(state).map(i => i.series)).toEqual(['Frieren', 'Bleach'])
  })

  it('treats different seasons of one series as separate items', () => {
    const state = {
      ...stateOf(entry({ season: 1, updatedAt: 1000 })),
      ...stateOf(entry({ season: 2, updatedAt: 2000 })),
    }
    expect(watching(state)).toHaveLength(2)
  })
})

describe('un-watching is not re-stuck by the next progress tick', () => {
  const ep = playable()

  beforeEach(() => {
    // Establish a watched episode with a known duration to rewind from.
    saveProgress(ep, 500, 1000)
    setWatched(ep, true)
  })

  it('holds the manual clear while playback is still past the threshold', () => {
    setWatched(ep, false)
    // 96% is above WATCHED_THRESHOLD — the old code re-marked it here.
    saveProgress(ep, 960, 1000)
    expect(getProgress(ep)?.watched).toBe(false)
  })

  it('resumes auto-marking once playback drops back below the threshold', () => {
    setWatched(ep, false)
    saveProgress(ep, 400, 1000) // below the threshold — releases the hold
    expect(getProgress(ep)?.watched).toBe(false)

    saveProgress(ep, 960, 1000) // past it again, so it counts as watched
    expect(getProgress(ep)?.watched).toBe(true)
  })

  it('rewinds to the start, so the episode is offered up again', () => {
    setWatched(ep, false)
    expect(getProgress(ep)?.position).toBe(0)
  })
})

describe('seasonEpisodes and dismissal round-trip through the store', () => {
  it('keeps a known season length when a later write omits it', () => {
    saveProgress(playable({ seasonEpisodes: 20 }), 500, 1000)
    saveProgress(playable(), 600, 1000) // no playlist to hand
    expect(getProgress(playable())?.seasonEpisodes).toBe(20)
  })

  it('dismissSeries does not bump updatedAt, or the watermark would be stale', () => {
    const ep = playable()
    saveProgress(ep, 500, 1000)
    const before = getProgress(ep)!.updatedAt

    dismissSeries('Bleach', 1)
    const after = getProgress(ep)!
    expect(after.updatedAt).toBe(before)
    expect(after.dismissedAt).toBeGreaterThanOrEqual(before)
  })
})
