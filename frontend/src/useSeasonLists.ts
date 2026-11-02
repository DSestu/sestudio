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
 * The episodes of a show's other seasons. Once the page itself has loaded they
 * are all fetched in the background, two at a time, so the playlist can say how
 * many episodes each season has without anyone opening it; opening one before
 * its turn loads it straight away.
 * The open season is not here: it is the page's own `detail`.
 *
 * Reset when the show or the language changes, but not when only the current
 * season does: switching season keeps the lists already loaded.
 */
export function useSeasonLists(seasons: ShowSeason[], lang: string, ready: boolean) {
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
    return getSeasonCached(target.page_url, lang, target.source).then(
      d => setLists(prev => ({ ...prev, [n]: { status: 'ok', episodes: d.episodes } })),
      () => {
        seen.current.delete(n)
        setLists(prev => ({ ...prev, [n]: { status: 'error' } }))
      },
    )
  }, [seasons, lang])

  // Background preload: waits for the page's own season, then walks the others.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })
  const currentNumber = seasons.find(s => s.current)?.season_number
  useEffect(() => {
    if (!ready || currentNumber === undefined) return
    let cancelled = false
    const queue = seasons.map(s => s.season_number).filter(n => n !== currentNumber)
    const worker = async () => {
      for (let n = queue.shift(); n !== undefined && !cancelled; n = queue.shift()) await loadRef.current(n)
    }
    void Promise.all([worker(), worker()])
    return () => { cancelled = true }
    // `seasons` is rebuilt every render; its content is in showKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showKey, currentNumber])

  return { lists, load }
}
