import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SeasonCard } from './api'
import { cachedSearch, searchSeasonsCached } from './api'
import { useMergedCards } from './useMergedCards'
import { useTitlesMeta, type TitleRef } from './useTitlesMeta'

// The one title search behind the desktop bar and the phone's Discover menu:
// the same query, merge, kind filter and ratings, so both show the same rows.

export type Kind = 'all' | 'films' | 'series' | 'anime' | 'people'

export const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'films', label: 'Films' },
  { value: 'series', label: 'Series' },
  { value: 'anime', label: 'Anime' },
  { value: 'people', label: 'People' },
]

/** The kinds a title list can be narrowed to: people come from TMDB, not the sources. */
export const TITLE_KINDS = KINDS.filter(k => k.value !== 'people')

/** The kind in a URL's `only` param; anything else means everything. */
export function parseKind(value: string | null): Kind {
  return KINDS.some(k => k.value === value) ? (value as Kind) : 'all'
}

/** Search can't filter by kind, so its results are narrowed afterwards. Anime
 *  is its own kind even for anime films: that is how the anime sites list them. */
export function matchesKind(card: SeasonCard, kind: Kind): boolean {
  if (kind === 'anime') return card.is_anime
  if (kind === 'films') return card.is_film && !card.is_anime
  if (kind === 'series') return !card.is_film && !card.is_anime
  return kind !== 'people'
}

/** Classes for the search field, wherever it is drawn: accent ring, so it reads
 *  as the place to type rather than an empty box. */
export const SEARCH_FIELD =
  'flex items-center gap-2 w-full rounded-box border-2 border-primary/80 bg-base-100 px-3 h-11 ' +
  'ring-4 ring-primary/15 focus-within:border-primary'

export interface MergeOptions {
  preferredSite?: string
  mergeByTmdb?: boolean
  collapseSeasons?: boolean
}

export interface TitleSearch {
  status: 'idle' | 'loading' | 'failed' | 'done'
  /** Merged, kind-filtered, best first. */
  cards: SeasonCard[]
  /** TMDB rating per card, filled in as matches land. */
  ratings: Map<string, number>
}

interface Answer {
  query: string
  cards: SeasonCard[]
  failed: boolean
}

// A preview names a few titles and counts the rest: the details are the page's.
const SHOWN = 4

/** Search every source for `query` as it is typed (debounced), merged into one
 *  card per title. A query already searched this session answers at once. */
export function useTitleSearch(query: string, kind: Kind, merge: MergeOptions, rate: boolean): TitleSearch {
  const [answer, setAnswer] = useState<Answer | null>(null)
  useEffect(() => {
    if (!query) return
    let cancelled = false
    const hit = cachedSearch(query)
    const timer = setTimeout(() => {
      searchSeasonsCached(query)
        .then(cards => { if (!cancelled) setAnswer({ query, cards, failed: false }) })
        .catch(() => { if (!cancelled) setAnswer({ query, cards: [], failed: true }) })
    }, hit ? 0 : 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  const current = query && answer?.query === query ? answer : null
  const [merged] = useMergedCards(
    current?.cards ?? [],
    merge.mergeByTmdb ?? false,
    merge.preferredSite,
    merge.collapseSeasons ?? true,
  )
  const cards = merged.filter(c => matchesKind(c, kind))
  const refs: TitleRef[] = cards.slice(0, SHOWN).map(c => ({ key: c.newsid, name: c.series_name, isFilm: c.is_film }))
  const metas = useTitlesMeta(refs, rate, true)
  const ratings = new Map([...metas].map(([k, m]) => [k, m.rating]))

  const status = !query ? 'idle' : !current ? 'loading' : current.failed ? 'failed' : 'done'
  return { status, cards, ratings }
}

/** How many result rows a preview shows before "See all". */
export const PREVIEW_ROWS = SHOWN

// --- Recent searches -------------------------------------------------------
// The last searches that reached the results page, newest first, kept in this
// browser only, so a search can be gone back to without retyping it.

export interface RecentSearch {
  term: string
  kind: Kind
}

const RECENT_KEY = 'sestudio.searches.recent'
const RECENT_MAX = 5
const recentListeners = new Set<() => void>()
let recentCache: RecentSearch[] | null = null

function readRecent(): RecentSearch[] {
  if (recentCache) return recentCache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    recentCache = Array.isArray(parsed)
      ? parsed.filter((r): r is RecentSearch => typeof r?.term === 'string').map(r => ({ term: r.term, kind: parseKind(r.kind) }))
      : []
  } catch {
    recentCache = []
  }
  return recentCache
}

function writeRecent(list: RecentSearch[]) {
  recentCache = list
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* private mode */ }
  recentListeners.forEach(l => l())
}

export function rememberSearch(term: string, kind: Kind) {
  const t = term.trim()
  if (!t) return
  const rest = readRecent().filter(r => r.term.toLowerCase() !== t.toLowerCase())
  writeRecent([{ term: t, kind }, ...rest].slice(0, RECENT_MAX))
}

export const clearRecentSearches = () => writeRecent([])

export function useRecentSearches(): RecentSearch[] {
  return useSyncExternalStore(
    l => { recentListeners.add(l); return () => recentListeners.delete(l) },
    readRecent,
  )
}

/** A kind's label for a recent search, or '' for everything. */
export function kindLabel(kind: Kind): string {
  return kind === 'all' ? '' : KINDS.find(k => k.value === kind)?.label ?? ''
}
