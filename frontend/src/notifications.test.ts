import { describe, expect, it } from 'vitest'
import type { WatcherEvent } from './api'
import { newFindings } from './notifications'

const ev = (id: number, over: Partial<WatcherEvent> = {}): WatcherEvent => ({
  id, watcher_id: 1, watcher_kind: 'series_episodes', event_type: 'new_item', item_key: `k${id}`,
  title: `t${id}`, subtitle: '', poster_url: '', data: {}, created_at: 0, read_at: null,
  job_id: null, download_state: '', ...over,
})

describe('newFindings', () => {
  it('keeps unseen findings and drops channel videos, live streams and problems', () => {
    const events = [
      ev(1, { watcher_kind: 'channel', data: { kind: 'live' } }),
      ev(2),
      ev(3, { watcher_kind: 'channel', data: { kind: 'video' } }),
      ev(4, { event_type: 'watcher_error' }),
      ev(5, { read_at: 100 }),
      ev(6, { watcher_kind: 'film_available' }),
    ]
    expect(newFindings(events, new Set()).map(e => e.id)).toEqual([2, 6])
  })

  it('keeps a finding opened while on screen, now seen, in its place', () => {
    const shown = new Set<number>()
    newFindings([ev(1), ev(2)], shown)
    const after = newFindings([ev(1, { read_at: 100 }), ev(2)], shown)
    expect(after.map(e => [e.id, e.read_at])).toEqual([[1, 100], [2, null]])
  })

  it('is empty when nothing was unseen', () => {
    expect(newFindings([ev(1, { read_at: 5 })], new Set())).toEqual([])
  })
})
