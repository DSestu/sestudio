import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogCard, CatalogInfo, CatalogValues, FilterField, SeasonCard, Shelf } from '../api'
import { discoverCatalog, getCatalogSchema, getShelves } from '../api'
import type { MediaCardItem } from './MediaCard'
import { setLibraryLayout, useLibraryLayout } from '../libraryLayout'
import { useTitlesMeta, type TitleRef } from '../useTitlesMeta'
import { currentParams, patchParams } from '../nav'
import BrowseList from './BrowseList'
import CatalogFilters from './discover/CatalogFilters'
import SourcePicker from './discover/SourcePicker'
import { withValue } from './discover/values'
import LayoutToggle from './LayoutToggle'
import MediaRow from './MediaRow'
import PosterGrid from './PosterGrid'

/** URL params the search view owns; every other one is a catalogue filter. */
const RESERVED = new Set(['q', 'from', 'to', 'cat', 'all', 'only'])

interface Props {
  catalogs: CatalogInfo[]
  catalogId: string
  /** A site's own title: open it directly. */
  onOpenCard: (card: SeasonCard) => void
  /** A title only described by the catalogue: search the sites for it. */
  onSearchTerm: (term: string, year?: number) => void
}

/** A badge date as read on a card: the hour for a time later today (an
 *  episode airing), else "Nov 3", with the year only when it isn't this one. */
function day(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  if (iso.length > 10 && d.toDateString() === now.toDateString()) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

interface Fetched {
  /** The values these cards belong to — stale results are never shown. */
  key: string
  cards: CatalogCard[]
  page: number
  hasMore: boolean
  note: string
}

/**
 * Discovery for one catalogue, drawn from the filters it declares: shelves
 * while nothing is chosen, a filtered grid once anything is. Filters live in
 * the URL, so back, reload and deep links land on the same list.
 */
export default function DiscoverPanel({ catalogs, catalogId, onOpenCard, onSearchTerm }: Props) {
  const [values, setValues] = useState<CatalogValues>(() => {
    const seeded: CatalogValues = {}
    currentParams().forEach((v, k) => { if (!RESERVED.has(k)) seeded[k] = v })
    return seeded
  })
  // "See all" on a shelf whose filters are all defaults still means the grid.
  const [seeAll, setSeeAll] = useState(() => currentParams().has('all'))
  const browsing = seeAll || Object.keys(values).length > 0

  const [schema, setSchema] = useState<{ key: string; fields: FilterField[] } | null>(null)
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [error, setError] = useState('')
  // Bumped by Retry, to re-run whichever fetch failed.
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const layout = useLibraryLayout().browse

  const open = useCallback((c: CatalogCard) => {
    if (c.open.card) onOpenCard(c.open.card)
    else if (c.open.search) onSearchTerm(c.open.search.term, c.open.search.year || undefined)
  }, [onOpenCard, onSearchTerm])

  const item = (c: CatalogCard): MediaCardItem => ({
    key: c.key,
    title: c.title,
    // An announced title is dated to the day: the year alone would not say how far off it is.
    subtitle: c.badge ? day(c.badge) : c.year ? String(c.year) : undefined,
    rating: c.rating || undefined,
    genres: c.genres,
    poster_url: c.poster_url,
    onClick: () => open(c),
  })

  // Only the fields marked `reload` change the schema itself (TMDB's genres
  // differ between films and series); every other change keeps it.
  const reloadKeys = schema?.fields.filter(f => f.reload).map(f => f.key) ?? []
  const schemaKey = reloadKeys.map(k => values[k] ?? '').join('|')
  useEffect(() => {
    let cancelled = false
    getCatalogSchema(catalogId, values)
      .then(fields => {
        if (cancelled) return
        setSchema({ key: schemaKey, fields })
        // Drop what the catalogue no longer offers (a genre of the other kind,
        // a parameter left over from another catalogue).
        setValues(prev => {
          const next: CatalogValues = {}
          for (const f of fields) {
            const v = prev[f.key]
            if (v === undefined) continue
            const kept = f.type === 'multi'
              ? v.split(',').filter(x => f.options.some(o => o.value === x)).join(',')
              : v
            if (kept !== '' || f.type !== 'multi') next[f.key] = kept
          }
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
        })
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
    // values are read for the reload fields only, which schemaKey captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogId, schemaKey, attempt])

  // Persist into the URL, clearing the keys this panel set before.
  const written = useRef<string[]>([])
  useEffect(() => {
    const patch: Record<string, string | undefined> = Object.fromEntries(written.current.map(k => [k, undefined]))
    Object.assign(patch, values, { cat: catalogId, all: seeAll ? '1' : undefined })
    patchParams(patch)
    written.current = Object.keys(values)
    // Closing the filters sheet steps back over the history entry it pushed,
    // which restores the URL from before the sheet opened: write it again.
    const reassert = () => {
      const params = currentParams()
      // Switching catalogue also fires popstate, before this panel unmounts:
      // writing back then would undo the switch.
      const onThisCatalog = window.location.hash.startsWith('#/search') && !params.get('q')
        && (params.get('cat') ?? catalogId) === catalogId
      if (onThisCatalog) patchParams(patch)
    }
    window.addEventListener('popstate', reassert)
    return () => window.removeEventListener('popstate', reassert)
  }, [values, seeAll, catalogId])

  useEffect(() => {
    if (browsing || shelves) return
    let cancelled = false
    getShelves(catalogId)
      .then(s => { if (!cancelled) setShelves(s) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [catalogId, browsing, shelves, attempt])

  const valuesKey = JSON.stringify(values)
  useEffect(() => {
    if (!browsing) return
    let cancelled = false
    discoverCatalog(catalogId, values, 1)
      .then(res => {
        if (!cancelled) setFetched({ key: valuesKey, cards: res.cards, page: res.page, hasMore: res.has_more, note: res.note })
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
    // valuesKey captures every field of values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogId, valuesKey, browsing, attempt])
  const current = fetched?.key === valuesKey ? fetched : null

  // A site's own cards are matched on TMDB, whose rating then leads: the
  // sites rate titles on scales of their own, when at all. TMDB's catalogue
  // exists exactly when a key is set, and its cards are TMDB's already.
  const matchOnTmdb = catalogId !== 'tmdb' && catalogs.some(c => c.id === 'tmdb')
  const shown = browsing ? current?.cards ?? [] : shelves?.flatMap(s => s.cards) ?? []
  const refs: TitleRef[] = shown.flatMap(c =>
    c.open.card ? [{ key: c.key, name: c.open.card.series_name, isFilm: c.open.card.is_film }] : [],
  )
  const metas = useTitlesMeta(refs, matchOnTmdb, true)
  const enrich = (c: CatalogCard): CatalogCard => {
    const meta = metas.get(c.key)
    if (!meta) return c
    return {
      ...c,
      rating: meta.rating || c.rating,
      genres: c.genres.length ? c.genres : meta.genres,
      overview: c.overview || meta.overview,
    }
  }

  const inflight = useRef(false)
  async function loadMore() {
    if (!current?.hasMore || inflight.current) return
    inflight.current = true
    setLoadingMore(true)
    try {
      const res = await discoverCatalog(catalogId, values, current.page + 1)
      setFetched(prev => prev && prev.key === valuesKey
        ? { ...prev, cards: [...prev.cards, ...res.cards], page: res.page, hasMore: res.has_more }
        : prev)
    } catch {
      // The sentinel retries on the next scroll.
    } finally {
      inflight.current = false
      setLoadingMore(false)
    }
  }
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore })

  // Infinite scroll: the sentinel below the grid triggers the next page as it
  // approaches the viewport.
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

  function change(next: CatalogValues) {
    setError('')
    setValues(next)
  }

  function showShelves() {
    setSeeAll(false)
    change({})
  }

  const fields = schema?.fields ?? []
  const label = catalogs.find(c => c.id === catalogId)?.label ?? catalogId

  return (
    <section aria-label={`Discover ${label}`} className="flex flex-col gap-4">
      {/* Phones have no rail to list catalogues in, so they switch here. */}
      <SourcePicker catalogs={catalogs} catalogId={catalogId} />

      {fields.length > 0 && (
        <CatalogFilters
          fields={fields}
          values={values}
          onChange={(f, v) => change(withValue(values, f, v))}
          onClear={() => change({})}
        />
      )}

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-sm text-base-content/60">
          Couldn't load {label}: {error}
          <button onClick={() => { setError(''); setAttempt(a => a + 1) }} className="btn btn-sm">
            Retry
          </button>
        </div>
      ) : !browsing ? (
        shelves === null ? (
          <Spinner />
        ) : (
          <div className="flex flex-col gap-8">
            {shelves.map(s => (
              <MediaRow
                key={s.id}
                title={s.title}
                items={s.cards.map(c => item(enrich(c)))}
                onSeeAll={() => { setSeeAll(true); change(s.values) }}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button onClick={showShelves} className="btn btn-ghost btn-sm -ml-2">
              <span aria-hidden="true">←</span> Shelves
            </button>
            {current?.note && <p className="text-xs text-base-content/50 mr-auto">{current.note}</p>}
            <div className="ml-auto">
              <LayoutToggle layout={layout} onChange={next => setLibraryLayout('browse', next)} />
            </div>
          </div>
          {!current ? (
            <Spinner />
          ) : current.cards.length === 0 ? (
            <p role="status" className="text-sm text-base-content/50 py-8 text-center">
              Nothing matches these filters.
            </p>
          ) : layout === 'detail' ? (
            <BrowseList cards={current.cards.map(enrich)} onSelect={open} />
          ) : (
            <PosterGrid items={current.cards.map(c => item(enrich(c)))} />
          )}
          {current?.hasMore && current.cards.length > 0 && (
            <div ref={sentinelRef} className="flex justify-center py-4" aria-hidden="true">
              {loadingMore && <span className="loading loading-spinner loading-sm text-base-content/40" />}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-12" aria-busy="true" aria-label="Loading titles">
      <span className="loading loading-spinner loading-md text-base-content/40" />
    </div>
  )
}
