import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings, CatalogInfo, DownloadDestination, DownloadItem, DownloadJob,
  DownloadedFile, DownloadedTitle, PersonHit, SeasonCard, SourceReport,
} from '../api'
import { cachedSearchSources, checkDownloads, getSeason, postDownloads, retrySearchSources, searchPeople } from '../api'
import SourceChips from '../components/search/SourceChips'
import SourcesPanel from '../components/search/SourcesPanel'
import ResponsiveModal from '../components/ResponsiveModal'
import { countBySource, filterBySources, formatSources, parseSources } from '../sourceFilter'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import DiscoverPanel from '../components/DiscoverPanel'
import { pickHost } from '../downloadPrefs'
import EmptyState from '../components/EmptyState'
import LayoutToggle from '../components/LayoutToggle'
import ToolbarToggle from '../components/ToolbarToggle'
import WatchSearchButton from '../components/WatchSearchButton'
import PeopleResults from '../components/PeopleResults'
import ResultsGrid from '../components/ResultsGrid'
import ResultsList from '../components/ResultsList'
import KindRows from '../components/search/KindRows'
import DiskRail from '../components/search/DiskRail'
import EpisodeHits from '../components/search/EpisodeHits'
import { setLibraryLayout, useLibraryLayout } from '../libraryLayout'
import { useMergedCards } from '../useMergedCards'
import { useTitlesMeta, type TitleRef } from '../useTitlesMeta'
import type { SortKey } from '../sortItems'
import { SORTS_FOR, defaultSortFor, sortItems } from '../sortItems'
import SearchBar from '../components/SearchBar'
import { downloadToDevice } from '../deviceDownloads'
import { fmtSize, useDownloadedLibrary } from '../downloadedLibrary'
import { episodeCode, episodeHits, groupOnDisk, resumePoint } from '../diskShows'
import { patchParams } from '../nav'
import ReleaseFilter from '../components/ReleaseFilter'
import { isAnyDates, rangeLabel, yearOf } from '../releaseDates'
import { KINDS, type Kind, matchesKind, parseKind } from '../titleSearch'
import { KindSegments, OptionsButton } from '../components/search/SearchParts'
import { OPTIONS_ID, setSearchOptionsSummary, setSourcesPanel, useSearchOptions } from '../searchOptions'
import { useScrolledDown } from '../useScrolledDown'
import { useTopMatch } from '../useTopMatch'
import { matchKey, splitYear } from '../topMatch'
import { useWatchState } from '../watchState'
import TopMatchHero, { TopMatchSkeleton } from '../components/search/TopMatchHero'
import PersonHero from '../components/search/PersonHero'

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
  /** The catalogues to browse while the query is empty, and the open one. */
  catalogs: CatalogInfo[]
  catalogId: string
  /** Rerun the search narrowed to a kind (the phone's kind chips). */
  onSearch: (term: string, kind: Kind) => void
  /** Open a person's profile from the People band. */
  onOpenPerson: (id: number) => void
  /** Open a title already on disk, rather than a source listing. With a file,
   *  that exact file plays instead of the title's first. */
  onOpenDownloaded: (title: DownloadedTitle, file?: DownloadedFile) => void
  onJobsCreated: () => void
  onSkipped: (jobs: DownloadJob[]) => void
}

/** Does a card fall inside the release window?
 *
 *  Source listings carry a year and never a date, so a window can only be
 *  applied to the year it falls in: "last month" keeps this year's titles.
 *  Rounding outwards rather than dropping them is deliberate — a filter that
 *  hid every 2026 film because the month can't be checked would be worse than
 *  one that shows a few too many. A card with no year at all can't be placed,
 *  so a window excludes it, and the toolbar counts those separately. */
const optionsHeading = 'text-xs font-semibold uppercase tracking-wide text-base-content/50'

function inWindow(card: SeasonCard, from: string, to: string): boolean {
  const year = card.year || 0
  if (!year) return false
  const min = yearOf(from)
  const max = yearOf(to)
  return (!min || year >= min) && (!max || year <= max)
}

/** Search view: query, TMDB discovery, results grid, and bulk season download. */
export default function SearchView({ settings, params, onOpenDetail, onUpdateSettings, onSearchTerm, catalogs, catalogId, onSearch, onOpenPerson, onOpenDownloaded, onJobsCreated, onSkipped }: Props) {
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
  // Narrows typed-search results by year; seeded from the URL like the query.
  const [releaseWindow, setReleaseWindow] = useState(() => ({
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }))
  const [sort, setSort] = useState<SortKey>(defaultSortFor('search'))
  // How each source fared, and which ones the chips narrow the results to
  // (in the URL, like the other filters; a new query starts unfiltered).
  const [sources, setSources] = useState<SourceReport[]>([])
  const [picked, setPicked] = useState(() => parseSources(params.get('src')))
  const [retrying, setRetrying] = useState(false)
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
  // The kind chosen in the search bar (desktop) or the Discover menu (phone).
  const kind = parseKind(params.get('only'))
  const ofKind = useMemo(() => merged.filter(c => matchesKind(c, kind)), [merged, kind])
  // Shown under each kind on phones, so the row says where the results are.
  const kindCounts = useMemo(
    () => Object.fromEntries(KINDS.map(k => [k.value, merged.filter(c => matchesKind(c, k.value)).length])) as Record<Kind, number>,
    [merged],
  )
  const folded = useScrolledDown() && lastQuery !== ''
  const { open: optionsOpen, sourcesOpen } = useSearchOptions()
  // The phone has no room for a side panel: the same list opens as a sheet.
  const [sheetOpen, setSheetOpen] = useState(false)
  // What the Options button says while the fold is shut, so a filter hidden
  // inside it is never invisible.
  useEffect(() => {
    const parts: string[] = []
    if (sort !== defaultSortFor('search')) parts.push(SORTS_FOR.search.find(o => o.value === sort)?.label ?? '')
    if (!isAnyDates(releaseWindow)) parts.push(rangeLabel(releaseWindow))
    setSearchOptionsSummary(parts.join(' · '))
  }, [sort, releaseWindow])
  useEffect(() => () => setSearchOptionsSummary(''), [])
  const inWindowResults = useMemo(
    () => isAnyDates(releaseWindow)
      ? ofKind
      : ofKind.filter(c => inWindow(c, releaseWindow.from, releaseWindow.to)),
    [ofKind, releaseWindow],
  )
  const hiddenByYear = ofKind.length - inWindowResults.length
  // What each source would show if picked, then the results the picked ones have.
  const sourceCounts = useMemo(() => countBySource(inWindowResults), [inWindowResults])
  const results = useMemo(() => filterBySources(inWindowResults, picked), [inWindowResults, picked])

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

  // The one result that is clearly what was searched for, shown big above the
  // rest; what you have on disk or are watching counts as meaning it.
  const watchStore = useWatchState()
  const diskShows = useMemo(() => groupOnDisk(downloadedTitles), [downloadedTitles])
  const onDiskKeys = useMemo(() => new Set(diskShows.map(s => s.key)), [diskShows])
  const watchingKeys = useMemo(() => new Set(Object.values(watchStore).map(e => matchKey(e.series))), [watchStore])
  const topMatch = useTopMatch(results, lastQuery, settings.tmdb_configured, onDiskKeys, watchingKeys)
  // The hero on disk plays from there: where you left off, or the first episode.
  const heroDisk = useMemo(() => {
    const show = topMatch.hero && diskShows.find(s => s.key === matchKey(topMatch.hero!.series_name))
    const at = show && resumePoint(show, Object.values(watchStore))
    if (!show || !at) return undefined
    const copy = at.episode.copies[0]
    const film = show.seasons.length === 1 && show.seasons[0].label === 'Film'
    return {
      show,
      at,
      line: [
        show.seasons.length > 1 ? `${show.seasons.length} ${show.seasons[0].cut ? 'cuts' : 'seasons'}` : '',
        show.episodes > 1 ? `${show.episodes} episodes` : '',
        fmtSize(show.size),
      ].filter(Boolean).join(' · '),
      play: film ? 'Play · on disk' : `${at.resume ? 'Resume' : 'Play'} · ${episodeCode(at.season, at.episode)}`,
      onPlay: () => onOpenDownloaded(copy.title, copy.file),
    }
  }, [topMatch.hero, diskShows, watchStore, onOpenDownloaded])
  const gridCards = topMatch.hero ? sortedResults.filter(c => c !== topMatch.hero) : sortedResults

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
    setSources(cachedSearchSources(query))
    if (query !== lastQuery) setPicked(new Set())
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
  // A person is only worth showing with a face. When no title matches the
  // search exactly, TMDB's first person (its most popular) is who it meant,
  // and takes the hero slot ("villeneuve").
  const withPhoto = people.filter(p => p.profile_url)
  const exactTitle = results.some(c => matchKey(c.series_name) === matchKey(splitYear(lastQuery).title))
  const personHero = !exactTitle && !topMatch.hero && !topMatch.pending && people[0]?.profile_url ? people[0] : null
  const morePeople = personHero ? withPhoto.filter(p => p !== personHero) : withPhoto

  // On disk, matched in memory so the answer is instant: episodes whose own
  // title matches (E3), and shows the search names that neither those nor the hero cover.
  const hits = useMemo(() => episodeHits(diskShows, lastQuery), [diskShows, lastQuery])
  const namedOnDisk = useMemo(() => {
    const want = matchKey(lastQuery)
    return want.length < 2 ? [] : diskShows.filter(s => s.key.includes(want) && s !== heroDisk?.show && !hits.some(g => g.show === s))
  }, [diskShows, lastQuery, heroDisk, hits])

  // Persist query + filters into the current history entry, so browser back
  // (and reload) land on this exact search instead of an empty one.
  useEffect(() => {
    // Patched, not replaced: the discover panel keeps its filters in the same URL.
    patchParams({ q: lastQuery || undefined, from: releaseWindow.from || undefined, to: releaseWindow.to || undefined, src: formatSources(picked) })
  }, [lastQuery, releaseWindow, picked])

  function toggleSource(id: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function retrySources(ids: string[]) {
    setRetrying(true)
    try {
      const answer = await retrySearchSources(lastQuery, ids)
      setRawResults(answer.cards)
      setSources(answer.sources)
    } finally {
      setRetrying(false)
    }
  }

  // Drawn twice: inside the phone's sticky header, and above the page on desktop.
  const chips = (className: string) => (
    <SourceChips
      className={className}
      sources={sources}
      counts={sourceCounts}
      picked={picked}
      onToggle={toggleSource}
      onClear={() => setPicked(new Set())}
      onRetry={ids => void retrySources(ids)}
      retrying={retrying}
      onShowAll={() => (window.matchMedia('(min-width: 768px)').matches ? setSourcesPanel(!sourcesOpen) : setSheetOpen(true))}
    />
  )
  const panel = (onClose: () => void) => (
    <SourcesPanel
      sources={sources}
      counts={sourceCounts}
      picked={picked}
      onToggle={toggleSource}
      onOnly={id => setPicked(new Set([id]))}
      onClear={() => setPicked(new Set())}
      onRetry={ids => void retrySources(ids)}
      retrying={retrying}
      onClose={onClose}
    />
  )

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
    <div className="flex items-start">
    <div className="flex-1 min-w-0 flex flex-col gap-5">
      {/* Desktop searches from the bar pinned above every page; this one
          stays mounted there all the same, as it runs the page's search. */}
      {/* Phone: the search alone on one row, the kinds alone on the next.
          With a query the pair sticks under the top bar, and scrolling down
          folds the search away so only the kinds stay. */}
      <div
        className={`md:hidden flex flex-col ${lastQuery !== ''
          ? 'sticky top-14 z-20 -mx-4 -mt-5 px-4 pt-3 pb-3 border-b border-base-300 bg-base-100/95 backdrop-blur'
          : ''}`}
      >
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-[260ms] ease-smooth motion-reduce:transition-none ${
            folded ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]'}`}
          inert={folded}
        >
          {/* Padding inside the clip, so the field's focus ring isn't cut. */}
          <div className="min-h-0 overflow-hidden -m-1 p-1">
            <SearchBar onResults={handleSearchResults} term={params.get('q')} />
          </div>
        </div>
        {/* Desktop has these in the pinned bar. */}
        {lastQuery !== '' && (
          <div className={`flex items-center gap-2 transition-[margin] duration-[260ms] ease-smooth motion-reduce:transition-none ${folded ? 'mt-0' : 'mt-3'}`}>
            <div className="flex-1 min-w-0">
              <KindSegments
                value={kind}
                onChange={k => onSearch(lastQuery, k)}
                counts={resolvedQuery === lastQuery ? kindCounts : undefined}
              />
            </div>
            <OptionsButton square />
          </div>
        )}
        {lastQuery !== '' && chips('flex mt-3')}
      </div>
      {/* Desktop: the panel lists every source, so the row steps aside for it. */}
      {lastQuery !== '' && !sourcesOpen && chips('hidden md:flex')}

      {/* Every control the results have, folded behind the one Options button
          (in the pinned bar on desktop, beside the kinds on phones). Inline, so
          opening it pushes the page down instead of covering it. Not gated on
          having results: a window that filtered everything out still has to be
          undoable, and a search that found nothing is the best one to watch. */}
      {lastQuery !== '' && (
        <div
          id={OPTIONS_ID}
          className={`grid transition-[grid-template-rows,opacity,margin] duration-[240ms] ease-smooth motion-reduce:transition-none ${
            optionsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0 -mt-5'}`}
          inert={!optionsOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-4 rounded-box border border-base-300 bg-base-200/60 p-4">
              <div className="grid gap-5 md:grid-cols-3">
                <section aria-label="Sort" className="flex flex-col gap-2">
                  <h3 className={optionsHeading}>Sort</h3>
                  <div role="radiogroup" aria-label="Sort" className="flex flex-wrap gap-1.5">
                    {SORTS_FOR.search.map(o => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={o.value === sort}
                        onClick={() => setSort(o.value)}
                        className={`badge cursor-pointer transition-colors ${o.value === sort ? 'badge-primary' : 'badge-ghost hover:badge-outline'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </section>
                <section aria-label="Released" className="flex flex-col gap-2">
                  <h3 className={optionsHeading}>Released</h3>
                  <ReleaseFilter
                    hideLabel
                    value={releaseWindow}
                    onChange={setReleaseWindow}
                    // Sub-year precision is browse-only: the sources date a listing by
                    // year at best, so say so rather than look broken.
                    note={!isAnyDates(releaseWindow) ? 'results are dated by year only' : undefined}
                  />
                  {hiddenByYear > 0 && (
                    <span className="text-xs text-base-content/40">
                      {hiddenByYear} hidden by this window
                    </span>
                  )}
                </section>
                {/* The TMDB switches live here rather than in Settings because
                    they change what this list looks like; they are hidden
                    without a key, since neither can do anything without one. */}
                <section aria-label="Display" className="flex flex-col gap-2.5">
                  <h3 className={optionsHeading}>Display</h3>
                  <LayoutToggle layout={layout} onChange={next => setLibraryLayout('search', next)} />
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
                  <ToolbarToggle
                    label="Play on open"
                    title="Start playing as soon as a title is opened. Off, opening a title only shows its description and episodes, so whatever is already playing keeps running."
                    checked={settings.autoplay_on_open !== false}
                    onChange={v => void onUpdateSettings({ autoplay_on_open: v })}
                  />
                </section>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-base-300 pt-3">
                <span className="text-base-content/50 text-sm">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                </span>
                {results.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCheckedIds(allChecked ? new Set() : new Set(results.map(c => c.newsid)))}
                    className="btn btn-sm gap-2"
                  >
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
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
                )}
                <WatchSearchButton query={lastQuery} />
                {(sort !== defaultSortFor('search') || !isAnyDates(releaseWindow)) && (
                  <button
                    type="button"
                    onClick={() => { setSort(defaultSortFor('search')); setReleaseWindow({ from: '', to: '' }) }}
                    className="ml-auto text-sm text-primary hover:underline"
                  >
                    Reset all
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Above the remote results: a copy already on disk is the most
          actionable answer to a search, and it plays without resolving a host. */}
      {lastQuery !== '' && hits.length > 0 && (
        <EpisodeHits
          groups={hits}
          onPlay={copy => onOpenDownloaded(copy.title, copy.file)}
          onOpenShow={copy => onOpenDownloaded(copy.title)}
        />
      )}
      {/* Shows on disk the search names, beyond the one the hero already covers:
          their cards carry the pill, and the library lists them all. */}
      {lastQuery !== '' && namedOnDisk.length > 0 && (
        <p className="flex items-center gap-2 px-1 text-sm text-base-content/70">
          <svg className="w-4 h-4 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z" />
          </svg>
          <span className="truncate">On disk: {namedOnDisk.map(s => s.name).join(' · ')}</span>
          <a href={`#/downloaded?q=${encodeURIComponent(lastQuery)}`} className="ml-auto shrink-0 text-primary hover:underline">All on disk ›</a>
        </p>
      )}

      {lastQuery !== '' && resolvedQuery === lastQuery && (topMatch.pending
        ? <TopMatchSkeleton />
        : personHero ? (
          <PersonHero person={personHero} onOpen={onOpenPerson} onSearchTerm={onSearchTerm} />
        ) : topMatch.hero && (
          <TopMatchHero card={topMatch.hero} meta={topMatch.meta} disk={heroDisk} posters={settings.tmdb_posters} onOpen={onOpenDetail}>
            {heroDisk && heroDisk.show.episodes > 1 && (
              <DiskRail
                key={heroDisk.show.key}
                show={heroDisk.show}
                at={heroDisk.at}
                history={Object.values(watchStore)}
                onPlay={copy => onOpenDownloaded(copy.title, copy.file)}
              />
            )}
          </TopMatchHero>
        ))}

      {lastQuery !== '' && <PeopleResults people={morePeople} title={personHero ? `Also named “${lastQuery}”` : undefined} onOpen={onOpenPerson} />}

      {lastQuery === '' ? (
        // No query: browse a catalogue instead of a blank page, so discovery
        // and search flow into each other.
        catalogs.length > 0 ? (
          <DiscoverPanel
            // Remount per catalogue: its filters, schema and lists are its own.
            key={catalogId}
            catalogs={catalogs}
            catalogId={catalogId}
            onOpenCard={onOpenDetail}
            onSearchTerm={onSearchTerm}
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
            cards={gridCards}
            checkedIds={checkedIds}
            onToggle={toggleCard}
            onOpenDetail={onOpenDetail}
            enrich={settings.tmdb_configured}
            posters={settings.tmdb_posters}
          />
        ) : kind === 'all' && KINDS.filter(k => k.value !== 'all' && gridCards.some(c => matchesKind(c, k.value))).length > 1 ? (
          // A mixed result reads by kind: one row each, "See all" for the rest.
          <KindRows
            cards={gridCards}
            checkedIds={checkedIds}
            onToggle={toggleCard}
            onOpenDetail={onOpenDetail}
            enrich={settings.tmdb_configured}
            onDisk={onDiskKeys}
            posters={settings.tmdb_posters}
            onSeeAll={k => { onSearch(lastQuery, k); window.scrollTo({ top: 0 }) }}
          />
        ) : (
          <ResultsGrid
            cards={gridCards}
            checkedIds={checkedIds}
            onToggle={toggleCard}
            onOpenDetail={onOpenDetail}
            enrich={settings.tmdb_configured}
            posters={settings.tmdb_posters}
            onDisk={onDiskKeys}
          />
        )
      ) : inWindowResults.length > 0 ? (
        // Something matched; only the source chips are hiding it.
        <EmptyState
          title="Nothing from these sources"
          message={`${inWindowResults.length} result${inWindowResults.length !== 1 ? 's' : ''} came from other sources. Clear the source filter to see ${inWindowResults.length !== 1 ? 'them' : 'it'}.`}
        />
      ) : merged.length > 0 && ofKind.length === 0 ? (
        // Something matched the query, just not of the kind picked in the bar.
        <EmptyState
          title={`No ${kind} for “${lastQuery}”`}
          message={`${merged.length} other result${merged.length !== 1 ? 's' : ''} matched. Pick Everything to see ${merged.length !== 1 ? 'them' : 'it'}.`}
        />
      ) : merged.length > 0 ? (
        // Something matched the query — only the release window is hiding it.
        <EmptyState
          title={`Nothing released ${rangeLabel(releaseWindow)}`}
          message={`${merged.length} result${merged.length !== 1 ? 's' : ''} for “${lastQuery}” fall outside that window. Widen it, or pick Any.`}
        />
      ) : resolvedQuery === lastQuery ? (
        withPhoto.length > 0 ? (
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
        <div className="fixed z-40 left-1/2 -translate-x-1/2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6 max-md:translate-y-[calc(-1*var(--discover-lift,0px))] max-md:transition-transform max-md:duration-300 max-md:ease-out motion-reduce:transition-none flex items-center flex-wrap justify-between sm:justify-start gap-3 sm:gap-4 rounded-box border border-base-300 bg-base-200 shadow-xl px-4 sm:px-6 py-3 w-[calc(100%-2rem)] max-w-md sm:w-auto sm:max-w-none">
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

      {sheetOpen && (
        <ResponsiveModal onClose={() => setSheetOpen(false)} boxClassName="max-h-[80dvh] overflow-y-auto">
          {panel(() => setSheetOpen(false))}
        </ResponsiveModal>
      )}
    </div>

    {/* Desktop: every source as a histogram, beside the results. It pushes the
        grid narrower on wide windows and floats over it on narrower ones. */}
    {lastQuery !== '' && (
      <aside
        aria-label="Sources"
        inert={!sourcesOpen}
        className={`hidden md:block shrink-0 overflow-hidden rounded-box border-base-300 bg-base-200 transition-[width,margin,opacity] duration-[320ms] ease-smooth motion-reduce:transition-none
          fixed right-4 top-20 z-30 shadow-2xl min-[1100px]:sticky min-[1100px]:right-auto min-[1100px]:top-24 min-[1100px]:z-auto min-[1100px]:shadow-none min-[1100px]:bg-base-200/60
          ${sourcesOpen ? 'w-72 border opacity-100 min-[1100px]:ml-6' : 'w-0 opacity-0'}`}
      >
        <div className={`w-72 max-h-[calc(100dvh-7rem)] overflow-y-auto p-4 transition-transform duration-[320ms] ease-smooth motion-reduce:transition-none ${sourcesOpen ? 'translate-x-0' : 'translate-x-4'}`}>
          {panel(() => setSourcesPanel(false))}
        </div>
      </aside>
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
