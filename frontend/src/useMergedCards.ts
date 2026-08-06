import { useEffect, useMemo, useState } from 'react'
import type { SeasonCard } from './api'
import { mergeCards, titleKey } from './mergeResults'
import { lookupTmdb } from './useTmdb'

/**
 * Resolve a TMDB id per card, then let a miss borrow its siblings' id.
 *
 * A lookup that finds nothing would otherwise fall back to the title key and
 * strand that card in its own group — the toggle would *un*-merge results. So a
 * card with no id joins its same-name siblings whenever they agree on exactly
 * one id; where they disagree (a genuine remake) it keeps no id, and the year
 * and poster rules place it.
 */
async function resolveIds(cards: SeasonCard[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  await Promise.all(
    cards.map(async card => {
      const meta = await lookupTmdb(card.series_name, card.year ?? 0, card.is_film)
      if (meta?.tmdb_id) ids.set(card.newsid, meta.tmdb_id)
    }),
  )

  const perTitle = new Map<string, Set<number>>()
  for (const card of cards) {
    const id = ids.get(card.newsid)
    if (!id) continue
    const key = titleKey(card)
    const seen = perTitle.get(key)
    if (seen) seen.add(id)
    else perTitle.set(key, new Set([id]))
  }
  for (const card of cards) {
    if (ids.has(card.newsid)) continue
    const seen = perTitle.get(titleKey(card))
    if (seen?.size === 1) ids.set(card.newsid, [...seen][0])
  }
  return ids
}

/**
 * Search results collapsed into one card per title, plus whether TMDB ids are
 * still being resolved.
 *
 * Merging is synchronous and immediate; when `tmdbIdentity` is on the ids arrive
 * afterwards and the results re-merge once, so the grid never waits on the
 * network. Lookups share the enrichment cache, so with enrichment already on
 * they usually cost nothing — and re-enabling the setting for a result set
 * already resolved is instant.
 */
export function useMergedCards(
  cards: SeasonCard[],
  tmdbIdentity: boolean,
  preferredSource?: string,
): [SeasonCard[], boolean] {
  // The batch the ids belong to is tracked alongside them, because "resolved"
  // cannot be read off the map itself: a card TMDB has no match for never gets
  // an entry, so waiting for one per card would wait forever.
  const [resolved, setResolved] = useState<{ batch: string; ids: Map<string, number> }>(
    () => ({ batch: '', ids: EMPTY_IDS }),
  )
  const batch = cards.map(c => c.newsid).join(',')

  useEffect(() => {
    if (!tmdbIdentity || !cards.length) return
    let cancelled = false
    void resolveIds(cards).then(ids => { if (!cancelled) setResolved({ batch, ids }) })
    return () => { cancelled = true }
    // `batch` identifies `cards` for this purpose, and is stable across the
    // re-renders that re-merging causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, tmdbIdentity])

  const pending = tmdbIdentity && cards.length > 0 && resolved.batch !== batch
  const active = tmdbIdentity ? resolved.ids : EMPTY_IDS
  const merged = useMemo(
    () => mergeCards(cards, active, preferredSource),
    [cards, active, preferredSource],
  )
  return [merged, pending]
}

/** Shared so the merge memo stays stable while the setting is off. */
const EMPTY_IDS: Map<string, number> = new Map()
