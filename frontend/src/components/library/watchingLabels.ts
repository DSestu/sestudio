import type { WatchingItem } from '../../watchState'

// Label helpers for the Watching surfaces. Kept out of the component files so
// they can be shared between the detail row and the poster card without
// tripping the fast-refresh rule (component files may only export components).

export function episodeLabel(season: number, number: number): string {
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}

/** The line describing what to play next, reused as the action sheet's subtitle. */
export function watchingContext(item: WatchingItem): string {
  if (item.isNextUp) return `Up next · ${episodeLabel(item.season, item.resume.number)}`
  if (item.season === 0) return item.resume.title || 'Film'
  return [episodeLabel(item.season, item.resume.number), item.resume.title]
    .filter(Boolean)
    .join(' · ')
}

/** The collection entry a Watching series stands for, for the save toggles. */
export function entryFor(item: WatchingItem) {
  return {
    series: item.series,
    season: item.season,
    label: item.series,
    poster_url: item.poster_url,
    page_url: item.page_url,
    lang: item.lang,
    source: item.source,
  }
}
