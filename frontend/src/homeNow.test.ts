import { describe, expect, it } from 'vitest'
import type { DownloadedTitle, DownloadJob, HealthIssue, LiveStream, UpcomingEpisode } from './api'
import { nowItems, type NowInput } from './homeNow'

const VISIT = 1_000_000_000_000 // ms
const BEFORE = VISIT / 1000 - 60 // s
const AFTER = VISIT / 1000 + 60

const live = { channel: 'Skyyart', page_url: 'https://twitch.tv/skyyart' } as LiveStream
const airs = (air_date: string): UpcomingEpisode => ({
  series: 'Frieren', tmdb_id: 1, season: 2, episode: 5, name: null, air_date, poster_url: null,
  vf_delay_days: null, page_url: null, source: null, lang: null,
})
const title = (mtimes: [number, number][]): DownloadedTitle => ({
  key: 'frieren-1', folder: 'Frieren', series: 'Frieren', season: 1, is_film: false, poster_url: '',
  page_url: '', source: '', langs: ['vostfr'], size: 0, mtime: 0,
  files: mtimes.map(([number, mtime]) => ({ path: `f/${number}`, number, title: '', lang: 'vostfr', size: 0, mtime })),
})
const failed = (episode_name: string, finished_at: number) =>
  ({ id: episode_name, episode_name, status: 'failed', finished_at } as DownloadJob)
const issue: HealthIssue = { kind: 'site', id: 'kisskh', message: 'KissKH is down', retry: 'site' }

const empty: NowInput = { live: [], upcoming: [], downloaded: [], jobs: [], issues: [], today: '2026-11-01' }
const texts = (input: Partial<NowInput>, lastVisit = VISIT) =>
  nowItems({ ...empty, ...input }, lastVisit).map(i => i.text)

describe('nowItems', () => {
  it('is empty when nothing needs you', () => {
    expect(nowItems(empty, VISIT)).toEqual([])
  })

  it('maps each source to a chip', () => {
    expect(texts({ live: [live] })).toEqual(['Skyyart is live'])
    expect(texts({ upcoming: [airs('2026-11-01')] })).toEqual(['Frieren S2·E5 airs today'])
    expect(texts({ downloaded: [title([[4, AFTER], [3, AFTER]])] })).toEqual(['Frieren E3, E4 ready'])
    expect(texts({ jobs: [failed('Frieren E6', AFTER)] })).toEqual(['Download failed: Frieren E6'])
    expect(texts({ issues: [issue] })).toEqual(['KissKH is down'])
  })

  it('plays the first new episode of a title', () => {
    const [item] = nowItems({ ...empty, downloaded: [title([[4, AFTER], [3, AFTER]])] }, VISIT)
    expect(item.kind === 'ready' && item.file.number).toBe(3)
  })

  it('groups several failures into one chip', () => {
    expect(texts({ jobs: [failed('a', AFTER), failed('b', AFTER)] })).toEqual(['2 downloads failed'])
  })

  it('keeps only episodes airing today', () => {
    expect(texts({ upcoming: [airs('2026-11-02')] })).toEqual([])
  })

  it('counts downloads only when they ended since the last visit', () => {
    expect(texts({
      downloaded: [title([[1, BEFORE], [2, AFTER]])],
      jobs: [failed('old', BEFORE), failed('running', null as unknown as number)],
    })).toEqual(['Frieren E2 ready'])
  })

  it('counts nothing on disk as new on a first visit', () => {
    expect(texts({ downloaded: [title([[1, AFTER]])], jobs: [failed('a', AFTER)] }, 0)).toEqual([])
  })

  it('orders live, airs today, ready, failed, then Health, capped at 6', () => {
    const all = {
      issues: [issue],
      jobs: [failed('Frieren E6', AFTER)],
      downloaded: [title([[3, AFTER]])],
      upcoming: [airs('2026-11-01')],
      live: [live],
    }
    expect(nowItems({ ...empty, ...all }, VISIT).map(i => i.kind))
      .toEqual(['live', 'airs', 'ready', 'failed', 'health'])
    expect(texts({ ...all, live: Array.from({ length: 5 }, (_, i) => ({ ...live, page_url: `${i}` })) }))
      .toHaveLength(6)
  })
})
