import { useEffect, useState } from 'react'
import type { TmdbMeta } from './api'
import { lookupTmdb } from './useTmdb'

// Metadata for a whole list of titles at once, resolved at the view rather than
// in each row. The genre filter has to know every entry's genres before it can
// offer a chip or hide a row, so the lookups cannot be left to the rows.

export interface TitleRef {
  /** The caller's own key for this title, which the result map is keyed by. */
  key: string
  name: string
  isFilm: boolean
}

const EMPTY: Map<string, TmdbMeta> = new Map()

// A library can hold far more titles than a page of search results, and firing
// one request per entry at once would swamp the server on the first render.
const CONCURRENCY = 6

async function eachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * TMDB metadata per title, keyed by the caller's key. Missing entries are
 * titles TMDB had no match for, so callers fall back to what they already hold.
 *
 * Lookups share the enrichment cache, so titles already seen elsewhere in the
 * app are free. Returns an empty map while disabled, without clearing what was
 * resolved — re-enabling is then instant.
 */
export function useTitlesMeta(titles: TitleRef[], enabled: boolean): Map<string, TmdbMeta> {
  const [metas, setMetas] = useState<Map<string, TmdbMeta>>(EMPTY)
  const batch = titles.map(t => t.key).join('|')

  useEffect(() => {
    if (!enabled || !titles.length) return
    let cancelled = false
    const found = new Map<string, TmdbMeta>()
    void eachLimited(titles, CONCURRENCY, async title => {
      const meta = await lookupTmdb(title.name, 0, title.isFilm)
      if (meta) found.set(title.key, meta)
    }).then(() => { if (!cancelled) setMetas(found) })
    return () => { cancelled = true }
    // `batch` identifies `titles` for this purpose and is stable across the
    // re-renders that resolving causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, enabled])

  return enabled ? metas : EMPTY
}
