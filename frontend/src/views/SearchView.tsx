import { useEffect, useState } from 'react'
import type {
  AppSettings, DiscoverFilters, DownloadDestination, DownloadItem, DownloadJob, SeasonCard,
} from '../api'
import { checkDownloads, getSeason, postDownloads } from '../api'
import { DEFAULT_DISCOVER_FILTERS } from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import DiscoverPanel from '../components/DiscoverPanel'
import EmptyState from '../components/EmptyState'
import ResultsGrid from '../components/ResultsGrid'
import { useMergedCards } from '../useMergedCards'
import SearchBar from '../components/SearchBar'
import { downloadToDevice } from '../deviceDownloads'
import { replaceParams } from '../nav'

interface Props {
  settings: AppSettings
  /** The route's params — query and discover filters live in the URL, so the
   *  view restores itself after a reload or browser back. */
  params: URLSearchParams
  onOpenDetail: (card: SeasonCard) => void
  /** Save a setting — the results toolbar owns the TMDB-grouping toggle. */
  onUpdateSettings: (patch: Partial<AppSettings>) => void | Promise<void>
  /** Run a fresh source search for a title (a TMDB discover card). */
  onSearchTerm: (term: string) => void
  onJobsCreated: () => void
  onSkipped: (jobs: DownloadJob[]) => void
}

function filtersFrom(params: URLSearchParams): DiscoverFilters {
  return {
    kind: params.get('kind') === 'tv' ? 'tv' : 'movie',
    sortBy: params.get('sort') ?? DEFAULT_DISCOVER_FILTERS.sortBy,
    genres: (params.get('g') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
    minScore: Number(params.get('score')) || 0,
    maxScore: Number(params.get('max')) || 10,
    minVotes: Number(params.get('votes')) || 0,
  }
}

/** Non-default filters only, so the URL stays clean. */
function filterParams(f: DiscoverFilters): Record<string, string | number | undefined> {
  return {
    kind: f.kind === 'tv' ? 'tv' : undefined,
    sort: f.sortBy !== DEFAULT_DISCOVER_FILTERS.sortBy ? f.sortBy : undefined,
    g: f.genres.length ? f.genres.join(',') : undefined,
    score: f.minScore > 0 ? f.minScore : undefined,
    max: f.maxScore < 10 ? f.maxScore : undefined,
    votes: f.minVotes > 0 ? f.minVotes : undefined,
  }
}

/** Search view: query, TMDB discovery, results grid, and bulk season download. */
export default function SearchView({ settings, params, onOpenDetail, onUpdateSettings, onSearchTerm, onJobsCreated, onSkipped }: Props) {
  // Raw, as scraped: merging is derived, so flipping the TMDB-identity setting
  // regroups what is already on screen without re-searching.
  const [rawResults, setRawResults] = useState<SeasonCard[]>([])
  // The query being searched for; seeded from the URL so back/reload restores.
  const [lastQuery, setLastQuery] = useState(params.get('q') ?? '')
  // The query the current `results` belong to — '' until the first response.
  const [resolvedQuery, setResolvedQuery] = useState('')
  const [filters, setFilters] = useState<DiscoverFilters>(() => filtersFrom(params))
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  // Same title listed per language and per mirror collapses to one result.
  const [results, regrouping] = useMergedCards(
    rawResults,
    settings.tmdb_configured && settings.tmdb_merge,
  )

  const cardMap = new Map(results.map(c => [c.newsid, c]))
  const allChecked = results.length > 0 && results.every(c => checkedIds.has(c.newsid))
  const someChecked = results.some(c => checkedIds.has(c.newsid))

  function toggleCard(newsid: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(newsid)) next.delete(newsid)
      else next.add(newsid)
      return next
    })
  }

  function handleSearchResults(cards: SeasonCard[], query: string) {
    setRawResults(cards)
    setLastQuery(query)
    setResolvedQuery(query)
    setCheckedIds(prev => {
      const ids = new Set(cards.map(c => c.newsid))
      return new Set([...prev].filter(id => ids.has(id)))
    })
  }

  // Persist query + filters into the current history entry, so browser back
  // (and reload) land on this exact search instead of an empty one.
  useEffect(() => {
    replaceParams('search', { q: lastQuery || undefined, ...filterParams(filters) })
  }, [lastQuery, filters])

  async function resolveChecked() {
    if (!checkedIds.size) return
    setBulkLoading(true)
    try {
      const allItems: DownloadItem[] = []
      for (const newsid of checkedIds) {
        const card = cardMap.get(newsid)
        if (!card) continue
        const detail = await getSeason(card.page_url, settings.lang)
        const items = detail.episodes
          .filter(ep => Object.keys(ep.embed_urls).length > 0)
          .map(ep => ({
            embed_url: ep.embed_urls['uqload'] ?? ep.embed_urls['vidzy'] ?? ep.embed_urls['netu'] ?? Object.values(ep.embed_urls)[0] ?? '',
            provider: ep.embed_urls['uqload'] ? 'uqload' : ep.embed_urls['vidzy'] ? 'vidzy' : ep.embed_urls['netu'] ? 'netu' : Object.keys(ep.embed_urls)[0] ?? '',
            all_providers: ep.embed_urls,
            episode_name: ep.filename,
            series_name: card.series_name,
            season: detail.season,
            lang: settings.lang,
          }))
          .filter((i): i is DownloadItem => Boolean(i.embed_url))
        allItems.push(...items)
      }
      if (allItems.length) {
        const existing = await checkDownloads(allItems)
        setExistingFiles(new Set(existing))
        setPendingItems(allItems)
      }
    } finally {
      setBulkLoading(false)
    }
  }

  async function confirmDownload(destination: DownloadDestination) {
    if (!pendingItems) return
    if (destination === 'device') {
      // Progress shows in Downloads — directly for relayed MP4s, or as a
      // server job for HLS (which needs downloading first).
      const items = pendingItems
      setPendingItems(null)
      setCheckedIds(new Set())
      void downloadToDevice(items).then(queued => { if (queued) onJobsCreated() })
      return
    }
    const newSkipped: DownloadJob[] = []
    for (const chunk of chunkBy(pendingItems, i => `${i.series_name}__${i.season}`)) {
      const jobs = await postDownloads(chunk)
      newSkipped.push(...jobs.filter(r => r.status === 'skipped'))
    }
    onSkipped(newSkipped)
    setPendingItems(null)
    setCheckedIds(new Set())
    onJobsCreated()
  }

  return (
    <div className="flex flex-col gap-5">
      <SearchBar onResults={handleSearchResults} term={params.get('q')} />

      {results.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCheckedIds(allChecked ? new Set() : new Set(results.map(c => c.newsid)))}
            className="flex items-center gap-2 text-sm text-base-content/60 hover:text-base-content transition-colors"
          >
            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              allChecked ? 'bg-primary border-primary'
                : someChecked ? 'bg-primary/30 border-primary'
                : 'border-base-content/30'
            }`}>
              {allChecked && (
                <svg className="w-3 h-3 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!allChecked && someChecked && <span className="w-2 h-0.5 bg-primary block" />}
            </span>
            {allChecked ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-base-content/40 text-sm">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>

          {/* The TMDB switches live here, not in Settings: they change what this
              list looks like, so they belong next to the list they change.
              Hidden without a key, since neither can do anything without one. */}
          {settings.tmdb_configured && (
            <div className="ml-auto flex items-center gap-3 flex-wrap">
              <ToolbarToggle
                label="TMDB artwork"
                title="Show TMDB posters, ratings and years on cards. Off shows the source's own posters."
                checked={settings.tmdb_cards}
                onChange={v => void onUpdateSettings({ tmdb_cards: v })}
              />
              <ToolbarToggle
                label="Group by TMDB match"
                title="Identify a title by its TMDB match rather than its name, so differently-spelled listings of one title group together. Costs a lookup per result."
                checked={settings.tmdb_merge}
                onChange={v => void onUpdateSettings({ tmdb_merge: v })}
                // Regrouping waits on a lookup per result, so it is not instant
                busy={regrouping}
              />
            </div>
          )}
        </div>
      )}

      {lastQuery === '' ? (
        // No query: browse the TMDB catalogue instead of a blank page, so
        // suggestions and search flow into each other.
        settings.tmdb_configured ? (
          <DiscoverPanel
            filters={filters}
            onChange={setFilters}
            onSelect={card => onSearchTerm(card.title)}
          />
        ) : (
          <EmptyState
            title="Search the catalogue"
            message="Type a series or film name above. Results can be played here, cast to a TV, or downloaded."
          />
        )
      ) : results.length > 0 ? (
        <ResultsGrid
          cards={results}
          checkedIds={checkedIds}
          onToggle={toggleCard}
          onOpenDetail={onOpenDetail}
          enrich={settings.tmdb_configured && settings.tmdb_cards}
        />
      ) : resolvedQuery === lastQuery ? (
        <EmptyState
          title={`No results for “${lastQuery}”`}
          message="Try a different title, or check the spelling."
        />
      ) : (
        // Restored from the URL and still fetching — the bar shows a spinner.
        <div className="flex justify-center py-12" aria-busy="true" aria-label="Searching">
          <span className="loading loading-spinner loading-md text-base-content/40" />
        </div>
      )}

      {/* Bulk download bar — clears the mobile tab bar */}
      {checkedIds.size > 0 && (
        <div className="fixed z-40 left-1/2 -translate-x-1/2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6 flex items-center flex-wrap justify-between sm:justify-start gap-3 sm:gap-4 rounded-box border border-base-300 bg-base-200 shadow-xl px-4 sm:px-6 py-3 w-[calc(100%-2rem)] max-w-md sm:w-auto sm:max-w-none">
          <span className="text-base-content/80 text-sm">
            {checkedIds.size} season{checkedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setCheckedIds(new Set())} className="btn btn-ghost btn-sm">Clear</button>
          <button onClick={resolveChecked} disabled={bulkLoading} className="btn btn-primary btn-sm">
            {bulkLoading ? 'Loading…' : 'Download all'}
          </button>
        </div>
      )}

      {pendingItems && (
        <ConfirmDownloadModal
          items={pendingItems}
          outputRoot={settings.output_root}
          existingFiles={existingFiles}
          destination={settings.download_destination}
          onConfirm={confirmDownload}
          onCancel={() => setPendingItems(null)}
        />
      )}
    </div>
  )
}

/** A labelled switch for the results toolbar, with an optional busy spinner. */
function ToolbarToggle({ label, title, checked, onChange, busy }: {
  label: string
  title: string
  checked: boolean
  onChange: (checked: boolean) => void
  busy?: boolean
}) {
  return (
    <label
      className="flex items-center gap-2 text-sm text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
      title={title}
    >
      <input
        type="checkbox"
        className="toggle toggle-xs toggle-primary"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      {label}
      {busy && <span className="loading loading-spinner loading-xs" aria-label="Working" />}
    </label>
  )
}

function chunkBy<T>(items: T[], key: (i: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(item)
  }
  return [...groups.values()]
}
