import { useEffect, useMemo, useState } from 'react'
import type { SeasonCard, TmdbMeta } from './api'
import { matchKey, pickTopMatch, splitYear } from './topMatch'
import { lookupTmdb } from './useTmdb'

export interface TopMatch {
  hero: SeasonCard | null
  meta: TmdbMeta | null
  /** Votes still loading for several same-named results: keep the slot. */
  pending: boolean
}

/**
 * The search's top match, with its TMDB metadata. Only the results whose title
 * matches the query exactly are looked up (with their year, so Dune 1984 and
 * Dune 2021 get their own vote counts), which keeps this to a handful of calls.
 */
export function useTopMatch(
  cards: SeasonCard[],
  query: string,
  tmdb: boolean,
  onDisk: Set<string>,
  watching: Set<string>,
): TopMatch {
  const want = matchKey(splitYear(query).title)
  const candidates = useMemo(
    () => (want ? cards.filter(c => matchKey(c.series_name) === want) : []),
    [cards, want],
  )
  const batch = candidates.map(c => c.newsid).join('|')
  const [found, setFound] = useState<{ batch: string; metas: Map<string, TmdbMeta> }>(
    () => ({ batch: '', metas: new Map() }),
  )

  useEffect(() => {
    if (!tmdb || !candidates.length) return
    let cancelled = false
    void Promise.all(candidates.map(async c => [c.newsid, await lookupTmdb(c.series_name, c.year ?? 0, c.is_film)] as const))
      .then(pairs => {
        if (cancelled) return
        setFound({ batch, metas: new Map(pairs.filter((p): p is readonly [string, TmdbMeta] => p[1] !== null)) })
      })
    return () => { cancelled = true }
    // `batch` names the candidates; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, tmdb])

  const loaded = !tmdb || !candidates.length || found.batch === batch
  const metas = found.batch === batch ? found.metas : new Map<string, TmdbMeta>()
  // A lone exact match needs no votes: show it at once, its details fill in.
  const hero = loaded || candidates.length === 1
    ? pickTopMatch({
        cards: candidates,
        query,
        votes: new Map([...metas].map(([k, m]) => [k, m.vote_count])),
        years: new Map([...metas].map(([k, m]) => [k, m.year])),
        onDisk,
        watching,
      })
    : null
  return {
    hero,
    meta: hero ? metas.get(hero.newsid) ?? null : null,
    pending: !loaded && candidates.length > 1,
  }
}
