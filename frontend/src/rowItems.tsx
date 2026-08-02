import type { SeasonCard } from './api'
import type { CollectionEntry, ListName } from './collections'
import { entries as collectionEntries, useCollections } from './collections'
import type { NextUpSuggestion, WatchEntry } from './watchState'
import { removeEntry } from './watchState'
import SaveToggles from './components/SaveToggles'
import type { MediaRowItem } from './components/MediaRow'

/** Opens a title's detail modal, optionally deep-linked to an episode. */
export type OpenTitle = (card: SeasonCard, episode: number, lang: string) => void

/** Synthesize a SeasonCard from stored identity so the library can reopen a
 * title without a fresh search. */
export function cardFor(series: string, season: number, posterUrl: string, pageUrl: string): SeasonCard {
  return {
    newsid: pageUrl,
    title: series,
    series_name: series,
    season_number: season,
    poster_url: posterUrl,
    page_url: pageUrl,
    is_film: season === 0,
    is_anime: false,
  }
}

/** Strip the stored timestamp — SaveToggles sets a fresh one when re-saving. */
export function entryWithoutTimestamp(e: CollectionEntry): Omit<CollectionEntry, 'addedAt'> {
  return {
    kind: e.kind,
    series: e.series,
    season: e.season,
    number: e.number,
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

function seasonLabel(season: number, number: number): string {
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}

export function continueWatchingItems(entries: WatchEntry[], open: OpenTitle): MediaRowItem[] {
  return entries.map(e => ({
    key: `cw-${e.series}-${e.season}-${e.number}`,
    title: e.series,
    subtitle: e.season > 0
      ? `${seasonLabel(e.season, e.number)} · ${minutesLeft(e.position, e.duration)}`
      : minutesLeft(e.position, e.duration),
    poster_url: e.poster_url,
    progress: e.duration > 0 ? e.position / e.duration : undefined,
    onClick: () => open(cardFor(e.series, e.season, e.poster_url, e.page_url), e.number, e.lang),
    onRemove: () => removeEntry(e),
    actions: (
      <SaveToggles
        size="sm"
        entry={{
          kind: 'episode',
          series: e.series,
          season: e.season,
          number: e.number,
          label: e.title,
          poster_url: e.poster_url,
          page_url: e.page_url,
          lang: e.lang,
        }}
      />
    ),
  }))
}

export function nextUpItems(suggestions: NextUpSuggestion[], open: OpenTitle): MediaRowItem[] {
  return suggestions.map(s => ({
    key: `nu-${s.series}-${s.season}-${s.nextNumber}`,
    title: s.series,
    subtitle: `Next: ${seasonLabel(s.season, s.nextNumber)}`,
    poster_url: s.poster_url,
    onClick: () => open(cardFor(s.series, s.season, s.poster_url, s.page_url), s.nextNumber, s.lang),
    actions: (
      <SaveToggles
        size="sm"
        entry={{
          kind: 'title',
          series: s.series,
          season: s.season,
          label: s.series,
          poster_url: s.poster_url,
          page_url: s.page_url,
          lang: s.lang,
        }}
      />
    ),
  }))
}

/** Saved entries as row items: episodes deep-link to themselves, titles open the season. */
export function savedItems(
  list: ListName,
  state: ReturnType<typeof useCollections>,
  open: OpenTitle,
  fallbackLang: string,
): MediaRowItem[] {
  return collectionEntries(list, state).map(e => ({
    key: `${list}-${e.series}-${e.season}-${e.number ?? 'title'}`,
    title: e.series,
    subtitle: e.kind === 'episode'
      ? `${seasonLabel(e.season, e.number!)} · ${e.label}`
      : (e.season > 0 ? `S${String(e.season).padStart(2, '0')}` : 'Film'),
    poster_url: e.poster_url,
    onClick: () => open(
      cardFor(e.series, e.season, e.poster_url, e.page_url),
      e.number ?? 0,
      e.lang || fallbackLang,
    ),
    actions: <SaveToggles size="sm" entry={entryWithoutTimestamp(e)} />,
  }))
}
