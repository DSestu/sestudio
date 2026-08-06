/**
 * Client-side sorting for the in-memory lists — library tabs, a person's
 * filmography, and search results.
 *
 * Distinct from the browse panel's sort, which is a TMDB query parameter: these
 * lists are already in hand, so they are ordered here. Each view offers only
 * the keys its data can actually support (a search result has no "added" date,
 * a credit has no "watched" date), which SORTS_FOR encodes.
 */

/** The fields any sortable row exposes; all but `title` are optional. */
export interface Sortable {
  title: string
  year?: number
  /** 0–10, typically from TMDB. Rows without one sort last. */
  rating?: number
  /** When the user saved the row (library). */
  addedAt?: number
  /** When the user last watched it (library). */
  updatedAt?: number
}

export type SortKey =
  | 'natural'
  | 'title.asc'
  | 'title.desc'
  | 'year.desc'
  | 'year.asc'
  | 'rating.desc'
  | 'added.desc'
  | 'watched.desc'

export interface SortOption {
  value: SortKey
  label: string
}

const OPTIONS: Record<SortKey, string> = {
  'natural': 'Default order',
  'title.asc': 'Title A–Z',
  'title.desc': 'Title Z–A',
  'year.desc': 'Newest',
  'year.asc': 'Oldest',
  'rating.desc': 'Top rated',
  'added.desc': 'Recently added',
  'watched.desc': 'Recently watched',
}

function options(...keys: SortKey[]): SortOption[] {
  return keys.map(value => ({ value, label: OPTIONS[value] }))
}

/** Which sorts each surface offers, and therefore what its default is. */
export const SORTS_FOR = {
  /** Relevance is meaningful here, so it stays the default. */
  search: options('natural', 'title.asc', 'title.desc', 'year.desc', 'year.asc', 'rating.desc'),
  /** Saved lists have no inherent order; most recently saved is the useful one. */
  saved: options('added.desc', 'title.asc', 'title.desc', 'year.desc', 'year.asc', 'rating.desc'),
  /** Continue-watching is already ordered by recency; keep that as default. */
  watching: options('watched.desc', 'title.asc', 'title.desc', 'rating.desc'),
  /** TMDB returns credits roughly by billing/relevance — worth preserving. */
  credits: options('natural', 'year.desc', 'year.asc', 'title.asc', 'title.desc', 'rating.desc'),
} satisfies Record<string, SortOption[]>

export type SortSurface = keyof typeof SORTS_FOR

export function defaultSortFor(surface: SortSurface): SortKey {
  return SORTS_FOR[surface][0].value
}

export function isSortKey(value: string, surface: SortSurface): value is SortKey {
  return SORTS_FOR[surface].some(o => o.value === value)
}

/** Locale-aware, so accented French titles collate as a reader expects. */
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/** Missing values sort last in every ordering rather than pretending to be 0. */
function byNumberDesc(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0
  if (a === undefined || a === 0) return 1
  if (b === undefined || b === 0) return -1
  return b - a
}

/**
 * Sort a copy of `items` by `key`.
 *
 * Ties fall back to title so the order is stable and reproducible rather than
 * dependent on how the list happened to arrive.
 */
export function sortItems<T extends Sortable>(items: T[], key: SortKey): T[] {
  if (key === 'natural') return items
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title)
  const sorted = [...items]
  sorted.sort((a, b) => {
    switch (key) {
      case 'title.asc': return byTitle(a, b)
      case 'title.desc': return byTitle(b, a)
      case 'year.desc': return byNumberDesc(a.year, b.year) || byTitle(a, b)
      case 'year.asc': return byNumberDesc(b.year, a.year) || byTitle(a, b)
      case 'rating.desc': return byNumberDesc(a.rating, b.rating) || byTitle(a, b)
      case 'added.desc': return byNumberDesc(a.addedAt, b.addedAt) || byTitle(a, b)
      case 'watched.desc': return byNumberDesc(a.updatedAt, b.updatedAt) || byTitle(a, b)
      default: return 0
    }
  })
  return sorted
}
