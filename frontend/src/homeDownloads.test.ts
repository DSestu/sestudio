import { describe, expect, it } from 'vitest'
import type { DownloadedTitle, DownloadJob } from './api'
import { parseSize } from './deviceDownloads'
import { downloadRows, queueFill } from './homeDownloads'

const VISIT = 1_000_000_000_000 // ms
const BEFORE = VISIT / 1000 - 60 // s
const AFTER = VISIT / 1000 + 60

const job = (status: DownloadJob['status'], progress: number, episode_name = 'S02E01 - Pilot.mp4') =>
  ({ id: `${status}-${progress}`, episode_name, status, progress, series: 'Frieren', poster_url: 'p.jpg' } as DownloadJob)
const title = (mtimes: [number, number][]): DownloadedTitle => ({
  key: 'frieren-2', folder: 'Frieren', series: 'Frieren', season: 2, is_film: false, poster_url: 'p.jpg',
  page_url: '', source: '', langs: ['vf'], size: 0, mtime: 0,
  files: mtimes.map(([number, mtime]) => ({ path: `f/${number}`, number, title: '', lang: 'vf', size: 0, mtime })),
})
const texts = (jobs: DownloadJob[], downloaded: DownloadedTitle[], lastVisit = VISIT) =>
  downloadRows(jobs, downloaded, lastVisit).map(r => r.text)

describe('downloadRows', () => {
  it('is empty with an idle queue and nothing new', () => {
    expect(texts([job('done', 100), job('failed', 30)], [title([[1, BEFORE]])])).toEqual([])
  })

  it('shows running jobs, then what finished since the last visit', () => {
    expect(texts([job('downloading', 63.6)], [title([[4, AFTER], [3, AFTER], [2, BEFORE]])]))
      .toEqual(['S2·E1 · 64%', 'S2·E3, E4 ready'])
  })

  it('counts nothing on disk as new on a first visit', () => {
    expect(texts([], [title([[3, AFTER]])], 0)).toEqual([])
  })

  it('leaves the episode out when the name has none', () => {
    expect(texts([job('queued', 0, 'Film.mp4')], [])).toEqual(['0%'])
  })
})

describe('queueFill', () => {
  it('is the mean progress of running jobs, and full when none run', () => {
    expect(queueFill([job('downloading', 80), job('queued', 0), job('done', 100)])).toBe(40)
    expect(queueFill([job('done', 100)])).toBe(100)
  })
})

describe('parseSize', () => {
  it("reads yt-dlp's sizes, and 0 when it can't", () => {
    expect(parseSize('412.5MiB')).toBe(412.5 * 1024 ** 2)
    expect(parseSize('1.5GiB')).toBe(1.5 * 1024 ** 3)
    expect(parseSize('')).toBe(0)
    expect(parseSize(undefined)).toBe(0)
  })
})
