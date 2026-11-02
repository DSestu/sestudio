import { describe, expect, it } from 'vitest'
import type { Health } from './api'
import { gbFree, issueFacts, okFacts } from './homeHealth'

const NOW = Date.parse('2026-11-01T12:00:00Z')
const at = (h: number, m: number) => new Date(2026, 10, 1, h, m).toISOString()

const health = (over: Partial<Health> = {}): Health => ({
  ok: true,
  checked_at: at(14, 30),
  sites: [
    { id: 'a', label: 'A', up: true, checked_at: at(14, 0), error: null },
    { id: 'kisskh', label: 'KissKH', up: false, checked_at: at(13, 5), error: 'timeout' },
  ],
  watchers: {
    count: 2,
    last_run_at: new Date(NOW - 20 * 60_000).toISOString(),
    failing: [{ id: 7, label: 'W', error: 'boom', since: at(9, 15) }],
  },
  disk: { path: '/d', free_bytes: 412e9, total_bytes: 1e12, low: false },
  issues: [],
  ...over,
})

describe('gbFree', () => {
  it('rounds above 10 GB, one decimal below', () => {
    expect(gbFree(412.6e9)).toBe('413 GB free')
    expect(gbFree(4.25e9)).toBe('4.3 GB free')
  })
})

describe('okFacts', () => {
  it('lists sites up, the last watcher run and free disk', () => {
    expect(okFacts(health(), NOW)).toBe('1 site up · watchers ran 20 min ago · 412 GB free')
  })

  it('leaves out what is missing', () => {
    const h = health({ sites: [], disk: { path: '/d', free_bytes: null, total_bytes: null, low: false } })
    expect(okFacts({ ...h, watchers: { ...h.watchers, last_run_at: null } }, NOW)).toBe('')
  })
})

describe('issueFacts', () => {
  it('says since when, from the issue it is about', () => {
    const h = health()
    expect(issueFacts(h, { kind: 'site', id: 'kisskh', message: '', retry: 'site' })).toBe('since 13:05 · 412 GB free')
    expect(issueFacts(h, { kind: 'watcher', id: '7', message: '', retry: 'watcher' })).toBe('since 09:15 · 412 GB free')
    expect(issueFacts(h, { kind: 'disk', id: null, message: '', retry: null })).toBe('since 14:30 · 412 GB free')
  })
})
