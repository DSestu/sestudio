import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings, DiscoverFilters, DownloadDestination, DownloadItem, DownloadJob,
  DownloadedFile, DownloadedTitle, PersonHit, SeasonCard,
} from '../api'
import { checkDownloads, getSeason, postDownloads, searchPeople } from '../api'
import { DEFAULT_DISCOVER_FILTERS } from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import DiscoverPanel from '../components/DiscoverPanel'
import { pickHost } from '../downloadPrefs'
import EmptyState from '../components/EmptyState'
import LayoutToggle from '../components/LayoutToggle'
import SortSelect from '../components/SortSelect'
import ToolbarToggle from '../components/ToolbarToggle'
import WatchSearchButton from '../components/WatchSearchButton'
import PeopleResults from '../components/PeopleResults'
import ResultsGrid from '../components/ResultsGrid'
import ResultsList from '../components/ResultsList'
import { setLibraryLayout, useLibraryLayout } from '../libraryLayout'
import { useMergedCards } from '../useMergedCards'
import { useTitlesMeta, type TitleRef } from '../useTitlesMeta'
import type { SortKey } from '../sortItems'
import { SORTS_FOR, defaultSortFor, sortItems } from '../sortItems'
import SearchBar from '../components/SearchBar'
import { downloadToDevice } from '../deviceDownloads'
import DownloadedTree from '../components/downloaded/DownloadedTree'
import { buildFolders } from '../downloadedFolders'
import { useDownloadedLibrary } from '../downloadedLibrary'
import { replaceParams } from '../nav'
import ReleaseFilter from '../components/ReleaseFilter'
import type { ReleaseState } from '../releaseDates'
import { isAnyDates, rangeLabel, yearOf } from '../releaseDates'

interface Props {
  settings: AppSettings
  /** The route's params — query and discover filters live in the URL, so the
   *  view restores itself after a reload or browser back. */
  params: URLSearchParams
  onOpenDetail: (card: SeasonCard) => void
  /** Save a setting — the results toolbar owns the TMDB-grouping toggle. */
  onUpdateSettings: (patch: Partial<AppSettings>) => void | Promise<void>
  /** Run a fresh source search for a title (a TMDB discover card). */
  onSearchTerm: (term: string, year?: number) => void
  /** Open a person's profile from the People band. */
  onOpenPerson: (id: number) => void
  /** Open a title already on disk, rather than a source listing. With a file,
   *  that exact file plays instead of the title's first. */
  onOpenDownloaded: (title: DownloadedTitle, file?: DownloadedFile) => void
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
    fromDate: params.get('from') ?? '',
    toDate: params.get('to') ?? '',
    releaseState: RELEASE_STATES.includes(params.get('rel') as ReleaseState)
      ? (params.get('rel') as ReleaseState)
      : DEFAULT_DISCOVER_FILTERS.releaseState,
  }
}

const RELEASE_STATES: ReleaseState[] = ['out', 'upcoming', 'all']

/** Non-default filters only, so the URL stays clean. */
function filterParams(f: DiscoverFilters): Record<string, string | number | undefined> {
  return {
    kind: f.kind === 'tv' ? 'tv' : undefined,
    sort: f.sortBy !== DEFAULT_DISCOVER_FILTERS.sortBy ? f.sortBy : undefined,
    g: f.genres.length ? f.genres.join(',') : undefined,
    score: f.minScore > 0 ? f.minScore : undefined,
    max: f.maxScore < 10 ? f.maxScore : undefined,
    votes: f.minVotes > 0 ? f.minVotes : undefined,
    from: f.fromDate || undefined,
    to: f.toDate || undefined,
    rel: f.releaseState !== DEFAULT_DISCOVER_FILTERS.releaseState ? f.releaseState : undefined,
  }
}

/** Does a card fall inside the release window?
 *
 *  Source listings carry a year and never a date, so a window can only be
 *  applied to the year it falls in: "last month" keeps this year's titles.
 *  Rounding outwards rather than dropping them is deliberate — a filter that
 *  hid every 2026 film because the month can't be checked would be worse than
 *  one that shows a few too many. A card with no year at all can't be placed,
 *  so a window excludes it, and the toolbar counts those separately. */
function inWindow(card: SeasonCard, from: string, to: string): boolean {
  const year = card.year || 0
  if (!year) return false
  const min = yearOf(from)
  const max = yearOf(to)
  return (!min || year >= min) && (!max || year <= max)
}

/** Search view: query, TMDB discovery, results grid, and bulk season download. */
export default function SearchView({ settings, params, onOpenDetail, onUpdateSettings, onSearchTerm, onOpenPerson, onOpenDownloaded, onJobsCreated, onSkipped }: Props) {
  // Raw, as scraped: merging is derived, so flipping the TMDB-identity setting
  // regroups what is already on screen without re-searching.
  const [rawResults, setRawResults] = useState<SeasonCard[]>([])
  // The query being searched for; seeded from the URL so back/reload restores.
  const [lastQuery, setLastQuery] = useState(params.get('q') ?? '')
  // Copies on disk match instantly — they are already in memory, so they show
  // while the sites are still being queried.
  const downloadedTitles = useDownloadedLibrary()
  // The query the current `results` belong to — '' until the first response.
  const [resolvedQuery, setResolvedQuery] = useState('')
  const [filters, setFilters] = useState<DiscoverFilters>(() => filtersFrom(params))
  const [sort, setSort] = useState<SortKey>(defaultSortFor('search'))
  // Tagged with the query they belong to, so a stale set is never shown and
  // no synchronous reset is needed when the query changes.
  const [peopleFor, setPeopleFor] = useState<{ q: string; hits: PersonHit[] }>(
    () => ({ q: '', hits: [] }),
  )
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const layout = useLibraryLayout().search
  const [bulkLoading, setBulkLoading] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  // Same title listed per language and per mirror collapses to one result.
  const [merged, regrouping] = useMergedCards(
    rawResults,
    settings.tmdb_configured && settings.tmdb_merge,
    settings.preferred_site,
    settings.collapse_seasons !== false,
  )

  // The release window narrows what is already on screen — no re-search, since
  // the sources take no date. Cards whose year is unknown drop out while a
  // window is set; the toolbar says how many, so they aren't lost silently.
  const releaseWindow = { from: filters.fromDate, to: filters.toDate }
  const results = useMemo(
    () => isAnyDates(releaseWindow)
      ? merged
      : merged.filter(c => inWindow(c, filters.fromDate, filters.toDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [merged, filters.fromDate, filters.toDate],
  )
  const hiddenByYear = merged.length - results.length

  // Ratings are only fetched when a sort actually needs them, so the default
  // relevance ordering costs no extra lookups. They share the enrichment
  // cache, so with TMDB posters already on they are usually free.
  const needsRatings = settings.tmdb_configured && sort === 'rating.desc'
  const titleRefs: TitleRef[] = needsRatings
    ? results.map(c => ({ key: c.newsid, name: c.series_name, isFilm: c.is_film }))
    : []
  const ratings = useTitlesMeta(titleRefs, needsRatings)

  const sortedResults = useMemo(
    () =>
      sortItems(
        results.map(card => ({
          card,
          title: card.series_name,
          year: card.year,
          rating: ratings.get(card.newsid)?.rating,
        })),
        sort,
      ).map(row => row.card),
    [results, sort, ratings],
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

  // People are looked up per query, in parallel with the source search: a
  // name like "tarantino" matches no title, so without this the search
  // simply looks empty. Failures are silent — this is an extra, not the
  // result set.
  useEffect(() => {
    if (!lastQuery || !settings.tmdb_configured) return
    let cancelled = false
    void searchPeople(lastQuery).then(hits => {
      if (!cancelled) setPeopleFor({ q: lastQuery, hits })
    })
    return () => { cancelled = true }
  }, [lastQuery, settings.tmdb_configured])

  const people = peopleFor.q === lastQuery ? peopleFor.hits : []

  // Matched on the file *paths*, so an episode whose name carries the query
  // counts even when its folder does not. The answer has to be instant, so it
  // filters what is already in memory rather than asking the server.
  const downloadedMatches = useMemo(
    () => buildFolders(downloadedTitles, lastQuery.trim().toLowerCase()).count,
    [downloadedTitles, lastQuery],
  )

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
        const detail = await getSeason(card.page_url, settings.lang, card.source)
        const items = detail.episodes
          .filter(ep => Object.keys(ep.embed_urls).length > 0)
          .map((ep): DownloadItem => ({
            ...pickHost(ep.embed_urls, settings.preferred_hosts),
            all_providers: ep.embed_urls,
            episode_name: ep.filename,
            series_name: card.series_name,
            season: detail.season,
            lang: settings.lang,
            source: detail.source ?? card.source,
            // Kept next to the file so the local library can show a poster and
            // reopen the title; the path itself records neither.
            poster_url: card.poster_url,
            page_url: card.page_url,
          }))
          .filter(i => Boolean(i.embed_url))
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

      {/* Outside the results toolbar below: a search that found nothing is the
          best reason to watch it, so this cannot be gated on having results. */}
      {lastQuery !== '' && (
        <div className="flex">
          <WatchSearchButton query={lastQuery} />
        </div>
      )}

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

          {/* View controls, right-aligned as one group. The TMDB switches live
              here rather than in Settings because they change what this list
              looks like, so they belong next to the list they change; they are
              hidden without a key, since neither can do anything without one.
              The layout choice works either way. */}
          <div className="ml-auto flex items-center gap-3 flex-wrap justify-end">
            <SortSelect options={SORTS_FOR.search} value={sort} onChange={setSort} />
            <ToolbarToggle
              label="Play on open"
              title="Start playing as soon as a title is opened. Off, opening a title only shows its description and episodes, so whatever is already playing keeps running."
              checked={settings.autoplay_on_open !== false}
              onChange={v => void onUpdateSettings({ autoplay_on_open: v })}
            />
            <ToolbarToggle
              label="One card per show"
              title="Fold a show's seasons into a single result, with the season count on the card. Off lists every season separately."
              checked={settings.collapse_seasons !== false}
              onChange={v => void onUpdateSettings({ collapse_seasons: v })}
            />
            {settings.tmdb_configured && (
              <>
                <ToolbarToggle
                  label="TMDB posters"
                  title="Let TMDB artwork stand in for the source's own posters. Ratings, years, genres and synopses come from TMDB either way."
                  checked={settings.tmdb_posters}
                  onChange={v => void onUpdateSettings({ tmdb_posters: v })}
                />
                <ToolbarToggle
                  label="Group by TMDB match"
                  title="Identify a title by its TMDB match rather than its name, so differently-spelled listings of one title group together. Costs a lookup per result."
                  checked={settings.tmdb_merge}
                  onChange={v => void onUpdateSettings({ tmdb_merge: v })}
                  // Regrouping waits on a lookup per result, so it is not instant
                  busy={regrouping}
                />
              </>
            )}
            <LayoutToggle layout={layout} onChange={next => setLibraryLayout('search', next)} />
          </div>
        </div>
      )}

      {/* Outside the toolbar above, which only exists while something matched:
          a window that filtered everything out still has to be undoable. */}
      {lastQuery !== '' && merged.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ReleaseFilter
            value={releaseWindow}
            onChange={r => setFilters(f => ({ ...f, fromDate: r.from, toDate: r.to }))}
            // Sub-year precision is browse-only: the sources date a listing by
            // year at best, so say so rather than look broken.
            note={!isAnyDates(releaseWindow) ? 'results are dated by year only' : undefined}
          />
          {hiddenByYear > 0 && (
            <span className="text-xs text-base-content/40">
              {hiddenByYear} hidden by this window
            </span>
          )}
        </div>
      )}

      {/* Above the remote results: a copy already on disk is the most
          actionable answer to a search, and it plays without resolving a host. */}
      {downloadedMatches > 0 && (
        // Shut by default: the search is usually aimed at the sites, and local
        // copies are a sidebar to that. The count on the summary is what makes
        // it worth opening, so it has to be readable without opening it.
        <details className="group rounded-box border border-base-300">
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none hover:bg-base-200 rounded-box">
            <svg
              className="w-3.5 h-3.5 shrink-0 text-base-content/40 transition-transform group-open:rotate-90"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
              On disk
            </span>
            <span className="text-xs text-base-content/40">
              {downloadedMatches} file{downloadedMatches === 1 ? '' : 's'}
            </span>
          </summary>
          <div className="px-2 pb-2">
            {/* Folders shut too: a series match can be hundreds of episodes, and
                the useful answer is which folder holds them. No delete here —
                this is a search result, not the library. */}
            <DownloadedTree
              titles={downloadedTitles}
              filter={lastQuery}
              expandMatches={false}
              onPlay={(title, file) => onOpenDownloaded(title, file)}
            />
          </div>
        </details>
      )}

      {lastQuery !== '' && <PeopleResults people={people} onOpen={onOpenPerson} />}

      {lastQuery === '' ? (
        // No query: browse the TMDB catalogue instead of a blank page, so
        // suggestions and search flow into each other.
        settings.tmdb_configured ? (
          <DiscoverPanel
            filters={filters}
            onChange={setFilters}
            onSelect={card => onSearchTerm(card.title, card.year)}
          />
        ) : (
          <EmptyState
            title="Search the catalogue"
            message="Type a series or film name above. Results can be played here, cast to a TV, or downloaded."
          />
        )
      ) : results.length > 0 ? (
        layout === 'detail' ? (
          <ResultsList
            cards={sortedResults}
            checkedIds={checkedIds}
            onToggle={toggleCard}
            onOpenDetail={onOpenDetail}
            enrich={settings.tmdb_configured}
            posters={settings.tmdb_posters}
          />
        ) : (
          <ResultsGrid
            cards={sortedResults}
            checkedIds={checkedIds}
            onToggle={toggleCard}
            onOpenDetail={onOpenDetail}
            enrich={settings.tmdb_configured}
            posters={settings.tmdb_posters}
          />
        )
      ) : merged.length > 0 ? (
        // Something matched the query — only the release window is hiding it.
        <EmptyState
          title={`Nothing released ${rangeLabel(releaseWindow)}`}
          message={`${merged.length} result${merged.length !== 1 ? 's' : ''} for “${lastQuery}” fall outside that window. Widen it, or pick Any.`}
        />
      ) : resolvedQuery === lastQuery ? (
        people.length > 0 ? (
          <EmptyState
            title={`No titles match “${lastQuery}”`}
            message="That looks like a person's name — open one above to browse their filmography."
          />
        ) : (
          <EmptyState
            title={`No results for “${lastQuery}”`}
            message="Try a different title, or check the spelling."
          />
        )
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
          preferredHosts={settings.preferred_hosts}
          hostOptions={settings.known_hosts}
          defaultHosts={settings.default_hosts}
          onPreferences={patch => void onUpdateSettings(patch)}
          onConfirm={confirmDownload}
          onCancel={() => setPendingItems(null)}
        />
      )}
    </div>
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
