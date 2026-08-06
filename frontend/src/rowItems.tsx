import type { SeasonCard } from './api'
import type { CollectionEntry, ListName } from './collections'
import { entries as collectionEntries, useCollections } from './collections'
import type { WatchingItem } from './watchState'
import SaveToggles from './components/SaveToggles'
import type { MediaCardItem } from './components/MediaCard'
import WatchingOverflow from './components/library/WatchingOverflow'
import { watchingContext } from './components/library/watchingLabels'

/** Opens a title's detail modal, optionally deep-linked to an episode. */
export type OpenTitle = (card: SeasonCard, episode: number, lang: string) => void

/** Synthesize a SeasonCard from stored identity so the library can reopen a
 * title without a fresh search. */
export function cardFor(series: string, season: number, posterUrl: string, pageUrl: string, source?: string): SeasonCard {
  return {
    newsid: pageUrl,
    title: series,
    series_name: series,
    season_number: season,
    poster_url: posterUrl,
    page_url: pageUrl,
    is_film: season === 0,
    is_anime: false,
    source,
  }
}

/** Strip the stored timestamp — SaveToggles sets a fresh one when re-saving. */
export function entryWithoutTimestamp(e: CollectionEntry): Omit<CollectionEntry, 'addedAt'> {
  return {
    series: e.series,
    season: e.season,
    label: e.label,
    poster_url: e.poster_url,
    page_url: e.page_url,
    lang: e.lang,
  }
}

export function minutesLeft(position: number, duration: number): string {
  const mins = Math.max(0, Math.round((duration - position) / 60))
  return `${mins} min left`
}

/** Coarse "when did I last touch this" label for library rows. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const days = Math.floor((now - timestamp) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? 'last week' : `${weeks} weeks ago`
  const months = Math.floor(days / 30)
  return months <= 1 ? 'last month' : `${months} months ago`
}

function seasonLabel(season: number, number: number): string {
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}

/** Open a Watching item at the episode it says to resume. */
export function openWatching(open: OpenTitle) {
  return (item: WatchingItem) =>
    open(
      cardFor(item.series, item.season, item.poster_url, item.page_url, item.source),
      item.resume.number,
      item.lang,
    )
}

/** Watching items as poster cards, for the grid layout of that tab. */
export function watchingItems(items: WatchingItem[], open: OpenTitle): MediaCardItem[] {
  const onOpen = openWatching(open)
  return items.map(item => ({
    key: `w-${item.series}-${item.season}`,
    title: item.series,
    subtitle: item.isNextUp
      ? `Up next · ${seasonLabel(item.season, item.resume.number)}`
      : item.season > 0
        ? `${seasonLabel(item.season, item.resume.number)} · ${minutesLeft(item.resume.position, item.resume.duration)}`
        : minutesLeft(item.resume.position, item.resume.duration),
    poster_url: item.poster_url,
    progress:
      item.resume.duration > 0 ? item.resume.position / item.resume.duration : undefined,
    onClick: () => onOpen(item),
    // One control rather than several: a poster card has no room for five, and
    // the sheet keeps a single definition of what those actions are.
    actions: <WatchingOverflow item={item} context={watchingContext(item)} onOpen={onOpen} />,
  }))
}

/** Saved titles as row items, opening the season they belong to. */
export function savedItems(
  list: ListName,
  state: ReturnType<typeof useCollections>,
  open: OpenTitle,
  fallbackLang: string,
): MediaCardItem[] {
  return collectionEntries(list, state).map(e => ({
    key: `${list}-${e.series}-${e.season}`,
    title: e.series,
    subtitle: e.season > 0 ? `S${String(e.season).padStart(2, '0')}` : 'Film',
    poster_url: e.poster_url,
    onClick: () => open(
      cardFor(e.series, e.season, e.poster_url, e.page_url, e.source),
      0,
      e.lang || fallbackLang,
    ),
    actions: <SaveToggles size="sm" entry={entryWithoutTimestamp(e)} />,
  }))
}
