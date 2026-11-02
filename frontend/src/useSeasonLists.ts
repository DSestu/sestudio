import { useCallback, useEffect, useRef, useState } from 'react'
import type { EpisodeDetail } from './api'
import { getSeasonCached } from './seasonCache'
import type { ShowSeason } from './useShowSeasons'

/** One season's episodes as the playlist shows them: on their way, here, or lost. */
export type SeasonList =
  | { status: 'loading' }
  | { status: 'ok'; episodes: EpisodeDetail[] }
  | { status: 'error' }

/**
 * The episodes of a show's other seasons, fetched when the playlist opens one.
 * The open season is not here: it is the page's own `detail`.
 *
 * Reset when the show or the language changes, but not when only the current
 * season does: switching season keeps the lists already loaded.
 */
export function useSeasonLists(seasons: ShowSeason[], lang: string) {
  const [lists, setLists] = useState<Record<number, SeasonList>>({})
  const showKey = seasons.map(s => s.page_url).join('|') + '#' + lang
  const [forKey, setForKey] = useState(showKey)
  if (forKey !== showKey) {
    setForKey(showKey)
    setLists({})
  }

  // Keyed in a ref too: `load` must see the latest lists without being rebuilt,
  // so a click on an already-loading season does nothing.
  const seen = useRef(new Set<number>())
  useEffect(() => { seen.current = new Set() }, [showKey])

  const load = useCallback((n: number, retry = false) => {
    if (!retry && seen.current.has(n)) return
    const target = seasons.find(s => s.season_number === n)
    if (!target) return
    seen.current.add(n)
    setLists(prev => ({ ...prev, [n]: { status: 'loading' } }))
    getSeasonCached(target.page_url, lang, target.source).then(
      d => setLists(prev => ({ ...prev, [n]: { status: 'ok', episodes: d.episodes } })),
      () => {
        seen.current.delete(n)
        setLists(prev => ({ ...prev, [n]: { status: 'error' } }))
      },
    )
  }, [seasons, lang])

  return { lists, load }
}
