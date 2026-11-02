import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeasonDetail } from './api'

vi.mock('./api', () => ({ getSeason: vi.fn() }))
import { getSeason } from './api'
import { clearSeasonCache, getSeasonCached } from './seasonCache'

const detail = { episodes: [] } as unknown as SeasonDetail

describe('getSeasonCached', () => {
  beforeEach(() => {
    clearSeasonCache()
    vi.mocked(getSeason).mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('answers the same page from one request', async () => {
    vi.mocked(getSeason).mockResolvedValue(detail)
    const a = getSeasonCached('u', 'vf', 's')
    const b = getSeasonCached('u', 'vf', 's')
    expect(a).toBe(b)
    expect(getSeason).toHaveBeenCalledTimes(1)
    await a
  })

  it('keys on language and source too', async () => {
    vi.mocked(getSeason).mockResolvedValue(detail)
    await getSeasonCached('u', 'vf', 's')
    await getSeasonCached('u', 'vostfr', 's')
    await getSeasonCached('u', 'vf', 'other')
    expect(getSeason).toHaveBeenCalledTimes(3)
  })

  it('forgets a failure so the next ask retries', async () => {
    vi.mocked(getSeason).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(detail)
    await expect(getSeasonCached('u', 'vf', 's')).rejects.toThrow('down')
    await Promise.resolve()
    await expect(getSeasonCached('u', 'vf', 's')).resolves.toBe(detail)
    expect(getSeason).toHaveBeenCalledTimes(2)
  })

  it('expires after five minutes', async () => {
    vi.mocked(getSeason).mockResolvedValue(detail)
    await getSeasonCached('u', 'vf', 's')
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    await getSeasonCached('u', 'vf', 's')
    expect(getSeason).toHaveBeenCalledTimes(2)
  })
})
