import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiscoverFilters, TmdbGenre, TmdbKind, TrendingCard } from '../api'
import { discoverTitles, getGenres } from '../api'
import type { Layout } from '../libraryLayout'
import { setLibraryLayout, useLibraryLayout } from '../libraryLayout'
import BrowseList from './BrowseList'
import LayoutToggle from './LayoutToggle'
import PosterGrid from './PosterGrid'
import ReleaseFilter from './ReleaseFilter'
import { isUpcoming } from '../releaseDates'

interface Props {
  filters: DiscoverFilters
  onChange: (filters: DiscoverFilters) => void
  /** A discover card isn't playable directly — clicking searches the sources. */
  onSelect: (card: TrendingCard) => void
}

const SORTS = [
  { value: 'popularity.desc', label: 'Most popular' },
  { value: 'vote_average.desc', label: 'Top rated' },
  { value: 'vote_average.asc', label: 'Lowest rated' },
  { value: 'date.desc', label: 'Newest' },
  { value: 'date.asc', label: 'Oldest' },
  { value: 'title.asc', label: 'Title A–Z' },
] as const

const VOTE_STEPS = [0, 50, 100, 200, 500, 1000] as const

// Genre lists are static per kind — fetched once per session.
const genreCache = new Map<TmdbKind, TmdbGenre[]>()

/** One band of browse results, in whichever layout is selected. Shared so the
 *  incoming section is the same list as the main one, not a lesser copy. */
function cardsAs(
  // Any layout, but only `detail` is distinguished: browse offers no folder
  // view — it lists a catalogue, not files — so everything else is a grid.
  layout: Layout,
  cards: TrendingCard[],
  genres: TmdbGenre[],
  onSelect: (card: TrendingCard) => void,
) {
  if (layout === 'detail') {
    return <BrowseList cards={cards} genres={genres} onSelect={onSelect} />
  }
  return (
    <PosterGrid
      items={cards.map(c => ({
        key: `${c.kind}-${c.tmdb_id}`,
        // An announced title is dated to the day: the year alone would not say
        // how far off it is, which is the only thing worth knowing about it.
        subtitle: isUpcoming(c.release_date)
          ? c.release_date
          : c.year ? String(c.year) : undefined,
        title: c.title,
        rating: c.rating,
        poster_url: c.poster_url,
        onClick: () => onSelect(c),
      }))}
    />
  )
}

interface Fetched {
  /** The filters these cards belong to — stale results are never shown. */
  key: string
  cards: TrendingCard[]
  page: number
  totalPages: number
}

/**
 * Browse the TMDB catalogue with the sorts and filters the TMDB website
 * offers: media type, sort order, genres, minimum score and minimum votes.
 * Shown in the search view while the query is empty, so browsing and
 * searching flow into each other.
 */
export default function DiscoverPanel({ filters, onChange, onSelect }: Props) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Bumped when a genre list lands in the module cache, to re-render.
  const [, setGenreTick] = useState(0)

  const filtersKey = JSON.stringify(filters)
  const current = fetched?.key === filtersKey ? fetched : null
  const genres = genreCache.get(filters.kind) ?? []
  const layout = useLibraryLayout().browse

  // A discover page mixes what is out with what is only announced, and only
  // the full date tells them apart. Split per page rather than server-side, so
  // paging keeps working and the count stays honest as more pages append.
  const cards = current?.cards ?? []
  const announced = cards.filter(c => isUpcoming(c.release_date))
  const out = cards.filter(c => !isUpcoming(c.release_date))
  const shownCount = filters.releaseState === 'upcoming' ? announced.length
    : filters.releaseState === 'out' ? out.length
    : cards.length

  useEffect(() => {
    if (genreCache.has(filters.kind)) return
    let cancelled = false
    getGenres(filters.kind).then(g => {
      genreCache.set(filters.kind, g)
      if (!cancelled) setGenreTick(t => t + 1)
    })
    return () => { cancelled = true }
  }, [filters.kind])

  // Any filter change restarts from page 1; "Show more" appends further pages.
  useEffect(() => {
    let cancelled = false
    discoverTitles(filters, 1).then(res => {
      if (cancelled) return
      setFetched({
        key: filtersKey,
        cards: res.results,
        page: res.page,
        totalPages: res.total_pages,
      })
    })
    return () => { cancelled = true }
    // filtersKey captures every field of filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  const inflight = useRef(false)
  async function loadMore() {
    if (!current || inflight.current) return
    inflight.current = true
    setLoadingMore(true)
    try {
      const res = await discoverTitles(filters, current.page + 1)
      setFetched(prev => prev && prev.key === filtersKey ? {
        ...prev,
        cards: [...prev.cards, ...res.results],
        page: res.page,
        totalPages: res.total_pages,
      } : prev)
    } finally {
      inflight.current = false
      setLoadingMore(false)
    }
  }
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore })

  // Infinite scroll: the sentinel below the grid triggers the next page as it
  // approaches the viewport. A callback ref, so (dis)connection follows the
  // sentinel's mount/unmount exactly.
  const observer = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    observer.current = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) void loadMoreRef.current() },
      { rootMargin: '600px' },
    )
    observer.current.observe(el)
  }, [])

  function set<K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]) {
    const next = { ...filters, [key]: value }
    // TMDB's own rating-sorted views imply a vote floor — without one the list
    // is all obscure 10/10s (or 0/10s). Applied once; the user can lower it.
    if (key === 'sortBy' && String(value).startsWith('vote_average.') && filters.minVotes === 0) {
      next.minVotes = 200
    }
    // Genre ids differ between movies and TV, so they don't carry across.
    if (key === 'kind') next.genres = []
    // Keep the score window well-formed: moving one bound pushes the other.
    if (key === 'minScore') next.maxScore = Math.max(next.maxScore, next.minScore)
    if (key === 'maxScore') next.minScore = Math.min(next.minScore, next.maxScore)
    onChange(next)
  }

  function toggleGenre(id: number) {
    set('genres', filters.genres.includes(id)
      ? filters.genres.filter(g => g !== id)
      : [...filters.genres, id])
  }

  return (
    <section aria-label="Browse the catalogue" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight mr-auto">Browse</h2>
        <div className="join" role="group" aria-label="Media type">
          {(['movie', 'tv'] as const).map(k => (
            <button
              key={k}
              onClick={() => set('kind', k)}
              aria-pressed={filters.kind === k}
              className={`join-item btn btn-sm ${filters.kind === k ? 'btn-primary' : 'btn-ghost border-base-300'}`}
            >
              {k === 'movie' ? 'Films' : 'Series'}
            </button>
          ))}
        </div>
        <select
          value={filters.sortBy}
          onChange={e => set('sortBy', e.target.value)}
          aria-label="Sort by"
          className="select select-bordered select-sm"
        >
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {/* Its own preference, not the results list's: the two lists are browsed
            differently, and the store keeps one layout per surface. */}
        <LayoutToggle layout={layout} onChange={next => setLibraryLayout('browse', next)} />
      </div>

      {genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genres">
          {genres.map(g => {
            const active = filters.genres.includes(g.id)
            return (
              <button
                key={g.id}
                onClick={() => toggleGenre(g.id)}
                aria-pressed={active}
                className={`badge badge-lg cursor-pointer transition-colors ${
                  active ? 'badge-primary' : 'badge-ghost hover:badge-outline'
                }`}
              >
                {g.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-3 text-sm text-base-content/70">
          <span className="whitespace-nowrap">Min score</span>
          <input
            type="range"
            min={0}
            max={9}
            step={0.5}
            value={filters.minScore}
            onChange={e => set('minScore', Number(e.target.value))}
            className="range range-primary range-xs w-36 sm:w-44"
            aria-label="Minimum score"
          />
          <span className="w-8 font-mono text-xs">
            {filters.minScore > 0 ? `≥ ${filters.minScore}` : 'Any'}
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm text-base-content/70">
          <span className="whitespace-nowrap">Max score</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={filters.maxScore}
            onChange={e => set('maxScore', Number(e.target.value))}
            className="range range-primary range-xs w-36 sm:w-44"
            aria-label="Maximum score"
          />
          <span className="w-8 font-mono text-xs">
            {filters.maxScore < 10 ? `≤ ${filters.maxScore}` : 'Any'}
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-base-content/70">
          <span className="whitespace-nowrap">Min votes</span>
          <select
            value={filters.minVotes}
            onChange={e => set('minVotes', Number(e.target.value))}
            aria-label="Minimum number of votes"
            className="select select-bordered select-sm"
          >
            {VOTE_STEPS.map(v => (
              <option key={v} value={v}>{v === 0 ? 'Any' : `${v}+`}</option>
            ))}
          </select>
        </label>
        <ReleaseFilter
          value={{ from: filters.fromDate, to: filters.toDate }}
          onChange={r => onChange({ ...filters, fromDate: r.from, toDate: r.to })}
          state={filters.releaseState}
          onStateChange={s => onChange({ ...filters, releaseState: s })}
        />
      </div>

      {!current ? (
        <div className="flex justify-center py-12" aria-busy="true" aria-label="Loading titles">
          <span className="loading loading-spinner loading-md text-base-content/40" />
        </div>
      ) : shownCount === 0 ? (
        <p role="status" className="text-sm text-base-content/50 py-8 text-center">
          Nothing matches these filters.
        </p>
      ) : filters.releaseState !== 'all' ? (
        // One side of the line only — the request was already bounded to it,
        // so there is nothing to separate out and no section to fold away.
        cardsAs(layout, filters.releaseState === 'upcoming' ? announced : out, genres, onSelect)
      ) : (
        <>
          {out.length > 0 && cardsAs(layout, out, genres, onSelect)}
          {/* Announced titles are not watchable, and under a "Newest" sort they
              would otherwise crowd out everything that actually is. Folded away
              rather than dropped: what's coming is worth knowing about. */}
          {announced.length > 0 && (
            <details open={out.length === 0} className="rounded-box bg-base-200/40 ring-1 ring-base-300">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                Incoming
                <span className="text-base-content/50 font-normal">
                  {' '}— {announced.length} not released yet
                </span>
              </summary>
              <div className="px-4 pb-4">
                {cardsAs(layout, announced, genres, onSelect)}
              </div>
            </details>
          )}
        </>
      )}

      {current && current.page < current.totalPages && current.cards.length > 0 && (
        <div ref={sentinelRef} className="flex justify-center py-4" aria-hidden="true">
          {loadingMore && (
            <span className="loading loading-spinner loading-sm text-base-content/40" />
          )}
        </div>
      )}
    </section>
  )
}
