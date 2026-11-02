import { describe, expect, it } from 'vitest'
import type { UpcomingEpisode, Watcher } from './api'
import { daysUntil, episodeLabel, upcomingNote, upcomingSentence, vfWatcher } from './upcoming'

const ep = (over: Partial<UpcomingEpisode> = {}): UpcomingEpisode => ({
  series: 'Frieren', tmdb_id: 1, season: 2, episode: 5, name: 'The Journey', air_date: '2026-11-03',
  poster_url: null, vf_delay_days: null, page_url: '/frieren-s2', source: 'fstream', lang: 'vostfr', ...over,
})

const watcher = (kind: Watcher['kind'], config: Record<string, unknown>): Watcher => ({
  id: 1, kind, label: '', config, enabled: true, auto_download: false, interval_seconds: 3600, created_at: 0,
  next_poll_at: 0, last_polled_at: null, last_ok_at: null, last_error: null, consecutive_failures: 0, baselined_at: null,
})

describe('upcoming wording', () => {
  it('counts days across a month end', () => {
    expect(daysUntil('2026-11-02', '2026-10-31')).toBe(2)
  })

  it('labels the episode, or nothing when TMDB has no number', () => {
    expect(episodeLabel(ep())).toBe('S2·E5')
    expect(episodeLabel(ep({ episode: null }))).toBe('')
  })

  it('notes the VF delay, else VOSTFR first, else the episode name', () => {
    expect(upcomingNote(ep({ vf_delay_days: 7 }))).toBe('VF usually ~7 days later')
    expect(upcomingNote(ep({ vf_delay_days: 1 }))).toBe('VF usually ~1 day later')
    expect(upcomingNote(ep({ lang: null }))).toBe('VOSTFR first')
    expect(upcomingNote(ep({ lang: 'vf' }))).toBe('The Journey')
  })

  it('says when it airs, and the VF clause only when known', () => {
    expect(upcomingSentence(ep(), '2026-11-01')).toBe('Airs in 2 days.')
    expect(upcomingSentence(ep({ vf_delay_days: 6 }), '2026-11-02'))
      .toBe('Airs tomorrow. The VF usually lands about 6 days later.')
    expect(upcomingSentence(ep(), '2026-11-03')).toBe('Airs today.')
  })
})

describe('vfWatcher', () => {
  it('finds a watcher on the page covering VF or every language', () => {
    expect(vfWatcher([watcher('title_lang', { page_url: '/frieren-s2', langs: [] })], ep())).toBeTruthy()
    expect(vfWatcher([watcher('series_episodes', { page_url: '/frieren-s2', langs: ['vf'] })], ep())).toBeTruthy()
  })

  it('ignores one for another language or another page', () => {
    expect(vfWatcher([watcher('series_episodes', { page_url: '/frieren-s2', langs: ['vostfr'] })], ep())).toBeUndefined()
    expect(vfWatcher([watcher('title_lang', { page_url: '/other', langs: [] })], ep())).toBeUndefined()
    expect(vfWatcher([watcher('title_lang', { page_url: '/frieren-s2', langs: [] })], ep({ page_url: null }))).toBeUndefined()
  })
})
