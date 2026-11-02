import { useEffect, useState } from 'react'
import { getUpcoming, type UpcomingEpisode, type Watcher } from './api'
import { watcherForPage } from './watchers'

// Home's Upcoming widget: its data, and the words it shows. The wording is pure
// so it is tested without rendering.

/** Followed series' episodes airing this week; null while loading. */
export function useUpcoming(): UpcomingEpisode[] | null {
  const [episodes, setEpisodes] = useState<UpcomingEpisode[] | null>(null)
  useEffect(() => {
    let cancelled = false
    getUpcoming().then(e => { if (!cancelled) setEpisodes(e) })
    return () => { cancelled = true }
  }, [])
  return episodes
}

/** Whole days from *today* to *day*, both YYYY-MM-DD. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000)
}

/** "Frieren S2·E5" split in two, so the episode part can be muted. */
export function episodeLabel(e: UpcomingEpisode): string {
  return e.episode != null ? `S${e.season ?? 1}·E${e.episode}` : ''
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)

/** A row's muted line: when the VF follows, else which version comes first. */
export function upcomingNote(e: UpcomingEpisode): string {
  if (e.vf_delay_days != null) {
    return e.vf_delay_days ? `VF usually ~${days(e.vf_delay_days)} later` : 'VF usually the same day'
  }
  return e.lang !== 'vf' ? 'VOSTFR first' : e.name ?? ''
}

/** The one-episode layout's sentence. */
export function upcomingSentence(e: UpcomingEpisode, today: string): string {
  const n = daysUntil(e.air_date, today)
  const airs = n <= 0 ? 'Airs today.' : n === 1 ? 'Airs tomorrow.' : `Airs in ${days(n)}.`
  if (e.vf_delay_days == null) return airs
  return `${airs} The VF usually lands ${e.vf_delay_days ? `about ${days(e.vf_delay_days)} later` : 'the same day'}.`
}

/** The watcher already telling about this series' VF: one on its page for
 *  every language or for VF. */
export function vfWatcher(all: Watcher[], e: UpcomingEpisode): Watcher | undefined {
  const url = e.page_url
  if (!url) return undefined
  return all.find(w => {
    const langs = (w.config.langs as string[] | undefined) ?? []
    return w.kind !== 'film_available' && (!langs.length || langs.includes('vf')) && watcherForPage([w], url)
  })
}
