import { useEffect, useState } from 'react'
import type { AppSettings, DownloadDestination, DownloadItem, DownloadJob, SeasonCard } from './api'
import { checkDownloads, getSeason, postDownloads } from './api'
import { downloadToDevice } from './deviceDownloads'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import CastControls from './components/CastControls'
import DlnaControls from './components/DlnaControls'
import ConfirmDownloadModal from './components/ConfirmDownloadModal'
import DownloadQueue from './components/DownloadQueue'
import MediaRow from './components/MediaRow'
import ResultsGrid from './components/ResultsGrid'
import SearchBar from './components/SearchBar'
import SeasonTree from './components/SeasonTree'
import SettingsPanel from './components/SettingsPanel'
import { continueWatching, nextUp, removeEntry, useWatchState } from './watchState'
import { clearPullback, usePullback } from './pullback'
import PlayerModal from './components/PlayerModal'

/** Synthesize a SeasonCard from stored watch-state identity so the library
 * can reopen a title without a fresh search. */
function cardFor(series: string, season: number, posterUrl: string, pageUrl: string): SeasonCard {
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

function minutesLeft(position: number, duration: number): string {
  const mins = Math.max(0, Math.round((duration - position) / 60))
  return `${mins} min left`
}

export default function App() {
  const [results, setResults] = useState<SeasonCard[]>([])
  const [lastQuery, setLastQuery] = useState('')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<SeasonCard | null>(null)
  // Library deep-link: episode to auto-play and language override when a title
  // is opened from Continue Watching / Next Up rather than from search.
  const [autoPlayEpisode, setAutoPlayEpisode] = useState<number | undefined>(undefined)
  const [openLang, setOpenLang] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ output_root: '.', lang: 'vf', download_destination: 'server' })
  const [downloadTick, setDownloadTick] = useState(0)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna() }, [])

  // Library rows (home screen only). In-progress series take precedence over
  // their own "next up" suggestion.
  const watch = useWatchState()
  const pullback = usePullback()
  const cw = continueWatching(watch)
  const cwSeries = new Set(cw.map(e => e.series))
  const nu = nextUp(watch).filter(s => !cwSeries.has(s.series))

  function openFromLibrary(card: SeasonCard, episode: number, lang: string) {
    setOpenLang(lang)
    setAutoPlayEpisode(episode)
    setSelected(card)
  }

  function closeDetail() {
    setSelected(null)
    setAutoPlayEpisode(undefined)
    setOpenLang(null)
  }

  const cardMap = new Map(results.map(c => [c.newsid, c]))

  function toggleCard(newsid: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(newsid)) next.delete(newsid)
      else next.add(newsid)
      return next
    })
  }

  function handleSearchResults(cards: SeasonCard[], query: string) {
    setResults(cards)
    setLastQuery(query)
    setCheckedIds(prev => {
      const ids = new Set(cards.map(c => c.newsid))
      return new Set([...prev].filter(id => ids.has(id)))
    })
  }

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
          .filter(ep => ep.embed_urls['uqload'] || Object.keys(ep.embed_urls).length > 0)
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
      // Progress shows in the Downloads panel — directly for relayed MP4s, or
      // as a server job for HLS (which needs downloading first).
      const items = pendingItems
      setPendingItems(null)
      setCheckedIds(new Set())
      void downloadToDevice(items).then(queued => {
        if (queued) setDownloadTick(t => t + 1)
      })
      return
    }
    const newSkipped: DownloadJob[] = []
    for (const chunk of chunkBy(pendingItems, i => `${i.series_name}__${i.season}`)) {
      const results = await postDownloads(chunk)
      newSkipped.push(...results.filter(r => r.status === 'skipped'))
    }
    setSkippedJobs(prev => [...prev, ...newSkipped])
    setPendingItems(null)
    setCheckedIds(new Set())
    setDownloadTick(t => t + 1)
  }

  return (
    <div className="min-h-screen bg-base-100 p-6 flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          fstream<span className="text-primary">-dl</span>
        </h1>
        <SettingsPanel onChange={setSettings} />
      </div>

      <SearchBar onResults={handleSearchResults} />

      {/* Library rows — shown on the home screen (no active search) */}
      {lastQuery === '' && (cw.length > 0 || nu.length > 0) && (
        <div className="flex flex-col gap-6">
          <MediaRow
            title="Continue Watching"
            items={cw.map(e => ({
              key: `cw-${e.series}-${e.season}-${e.number}`,
              title: e.series,
              subtitle: e.season > 0
                ? `S${String(e.season).padStart(2, '0')}E${String(e.number).padStart(2, '0')} · ${minutesLeft(e.position, e.duration)}`
                : minutesLeft(e.position, e.duration),
              poster_url: e.poster_url,
              progress: e.duration > 0 ? e.position / e.duration : undefined,
              onClick: () => openFromLibrary(cardFor(e.series, e.season, e.poster_url, e.page_url), e.number, e.lang),
              onRemove: () => removeEntry(e),
            }))}
          />
          <MediaRow
            title="Next Up"
            items={nu.map(s => ({
              key: `nu-${s.series}-${s.season}-${s.nextNumber}`,
              title: s.series,
              subtitle: `Next: S${String(s.season).padStart(2, '0')}E${String(s.nextNumber).padStart(2, '0')}`,
              poster_url: s.poster_url,
              onClick: () => openFromLibrary(cardFor(s.series, s.season, s.poster_url, s.page_url), s.nextNumber, s.lang),
            }))}
          />
        </div>
      )}

      {results.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const allIds = new Set(results.map(c => c.newsid))
              const allChecked = results.every(c => checkedIds.has(c.newsid))
              setCheckedIds(allChecked ? new Set() : allIds)
            }}
            className="flex items-center gap-2 text-sm text-base-content/60 hover:text-base-content transition-colors"
          >
            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              results.every(c => checkedIds.has(c.newsid))
                ? 'bg-primary border-primary'
                : results.some(c => checkedIds.has(c.newsid))
                ? 'bg-primary/30 border-primary'
                : 'border-base-content/30'
            }`}>
              {results.every(c => checkedIds.has(c.newsid)) && (
                <svg className="w-3 h-3 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!results.every(c => checkedIds.has(c.newsid)) && results.some(c => checkedIds.has(c.newsid)) && (
                <span className="w-2 h-0.5 bg-primary block" />
              )}
            </span>
            {results.every(c => checkedIds.has(c.newsid)) ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-base-content/30 text-sm">{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {results.length === 0 && lastQuery !== '' ? (
        <div role="status" className="text-center py-12 text-base-content/60">
          <p className="text-lg font-medium">No results for “{lastQuery}”</p>
          <p className="text-sm mt-1">Try a different title or check the spelling.</p>
        </div>
      ) : (
        <ResultsGrid
          cards={results}
          checkedIds={checkedIds}
          onToggle={toggleCard}
          onOpenDetail={setSelected}
        />
      )}

      {/* Bulk download bar */}
      {checkedIds.size > 0 && (
        <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 flex items-center flex-wrap justify-between sm:justify-start gap-3 sm:gap-4 card card-bordered bg-base-200 shadow-xl px-4 sm:px-6 py-3 w-[calc(100%-1.5rem)] max-w-md sm:w-auto sm:max-w-none">
          <span className="text-base-content/80 text-sm">
            {checkedIds.size} season{checkedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setCheckedIds(new Set())} className="btn btn-ghost btn-sm">
            Clear
          </button>
          <button
            onClick={resolveChecked}
            disabled={bulkLoading}
            className="btn btn-primary btn-sm"
          >
            {bulkLoading ? 'Loading…' : 'Download all'}
          </button>
        </div>
      )}

      <DownloadQueue
        refreshTrigger={downloadTick}
        skippedJobs={skippedJobs}
        onClearHistory={() => setSkippedJobs([])}
      />

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

      {selected && (
        <SeasonTree
          card={selected}
          lang={openLang ?? settings.lang}
          outputRoot={settings.output_root}
          downloadDestination={settings.download_destination}
          onClose={closeDetail}
          onJobsCreated={() => setDownloadTick(t => t + 1)}
          autoPlayEpisode={autoPlayEpisode}
        />
      )}

      <CastControls />
      <DlnaControls />

      {/* TV → browser pull-back: play here, resuming from the saved position */}
      {pullback && (
        <PlayerModal
          episodes={pullback.episodes}
          startIndex={pullback.index}
          onClose={clearPullback}
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
