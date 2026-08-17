import { useEffect, useState } from 'react'
import type { SeasonCard } from './api'
import { searchSeasons } from './api'
import { normalize } from './useAlternateSources'

/** One season of the open show, as a place to switch the playlist to. */
export interface ShowSeason {
  season_number: number
  page_url: string
  source: string
  /** True for the season whose episodes are on screen. */
  current: boolean
}

/**
 * Every season of the open show, on the site it is being watched from.
 *
 * The site lists each season as its own title page, so they are found the same
 * way search finds them — by name — and then narrowed to the same site and the
 * same normalised title, since a search for "Naruto" also returns "Naruto
 * Shippuden". A film has no seasons, and neither does an empty name, so both
 * skip the request entirely.
 *
 * Only the current season is ever loaded; the others are links. Fetching all of
 * them up front would mean one page fetch per season for a playlist the viewer
 * may never open.
 */
export function useShowSeasons(
  seriesName: string,
  source: string,
  pageUrl: string,
  isFilm: boolean,
  season: number,
): ShowSeason[] {
  const [found, setFound] = useState<{ key: string; cards: SeasonCard[] }>(
    () => ({ key: '', cards: [] }),
  )
  const key = `${source}|${normalize(seriesName)}`

  useEffect(() => {
    if (!seriesName || isFilm) return
    let cancelled = false
    const wanted = normalize(seriesName)
    searchSeasons(seriesName)
      .then(cards => {
        if (cancelled) return
        setFound({
          key,
          cards: cards.filter(
            c =>
              !c.is_film &&
              (c.source ?? 'fstream') === source &&
              normalize(c.series_name) === wanted,
          ),
        })
      })
      .catch(() => { if (!cancelled) setFound({ key, cards: [] }) })
    return () => { cancelled = true }
  }, [key, seriesName, source, isFilm])

  // Tagged with the title it belongs to, so another show's list is never shown
  // against this one while its own lookup is still running.
  const cards = found.key === key ? found.cards : []

  const byNumber = new Map<number, ShowSeason>()
  for (const card of cards) {
    // The open page wins its own season, so switching away and back keeps the
    // same URL rather than an equivalent listing of it.
    const existing = byNumber.get(card.season_number)
    if (existing?.current) continue
    byNumber.set(card.season_number, {
      season_number: card.season_number,
      page_url: card.page_url,
      source: card.source ?? 'fstream',
      current: card.page_url === pageUrl,
    })
  }
  if (!byNumber.get(season)?.current) {
    byNumber.set(season, {
      season_number: season,
      page_url: pageUrl,
      source,
      current: true,
    })
  }

  const seasons = [...byNumber.values()].sort(
    (a, b) => a.season_number - b.season_number,
  )
  // One season is no tree — the playlist says which it is already.
  return seasons.length > 1 ? seasons : []
}
