import { useEffect, useState } from 'react'
import type { TmdbMeta } from './api'
import { enrichTitle } from './api'

// Metadata lookups are shared process-wide: the same title appears in search
// results, the season header and the library rows, and the server caches them
// anyway — this just avoids duplicate in-flight requests.
const cache = new Map<string, TmdbMeta | null>()
const inflight = new Map<string, Promise<TmdbMeta | null>>()

function key(title: string, year: number, isFilm: boolean): string {
  return `${isFilm ? 'movie' : 'tv'}:${title.toLowerCase()}:${year}`
}

function lookup(title: string, year: number, isFilm: boolean): Promise<TmdbMeta | null> {
  const k = key(title, year, isFilm)
  if (cache.has(k)) return Promise.resolve(cache.get(k) ?? null)
  const existing = inflight.get(k)
  if (existing) return existing
  const p = enrichTitle(title, year, isFilm)
    .catch(() => null)
    .then(meta => {
      cache.set(k, meta)
      inflight.delete(k)
      return meta
    })
  inflight.set(k, p)
  return p
}

/**
 * Metadata for a title, fetched lazily. Returns null until it resolves and
 * stays null when TMDB is disabled or has no match, so callers can simply
 * fall back to the source's own poster/title.
 */
export function useTmdb(
  title: string | null,
  year = 0,
  isFilm = false,
  enabled = true,
): TmdbMeta | null {
  const [meta, setMeta] = useState<TmdbMeta | null>(
    () => (title && enabled ? cache.get(key(title, year, isFilm)) ?? null : null),
  )

  useEffect(() => {
    if (!title || !enabled) return
    let cancelled = false
    lookup(title, year, isFilm).then(m => { if (!cancelled) setMeta(m) })
    return () => { cancelled = true }
  }, [title, year, isFilm, enabled])

  // Disabled or no title: report nothing without touching state in an effect.
  if (!title || !enabled) return null
  return meta
}
