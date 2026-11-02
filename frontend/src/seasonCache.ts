import type { SeasonDetail } from './api'
import { getSeason } from './api'

// A season page is fetched from a content site and is slow. The playlist loads
// a season when it is opened, and switching to it afterwards asks for the same
// page again, so the answer is kept for a few minutes: the switch is then
// instant. Failures are never kept.

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; promise: Promise<SeasonDetail> }>()

export function getSeasonCached(url: string, lang: string, source?: string): Promise<SeasonDetail> {
  const key = `${source ?? ''}|${url}|${lang}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = getSeason(url, lang, source)
  cache.set(key, { at: Date.now(), promise })
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key) })
  return promise
}

/** Forget everything (tests). */
export function clearSeasonCache(): void {
  cache.clear()
}
