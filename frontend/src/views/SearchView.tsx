import { useState } from 'react'
import type {
  AppSettings, DownloadDestination, DownloadItem, DownloadJob, SeasonCard,
} from '../api'
import { checkDownloads, getSeason, postDownloads } from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import EmptyState from '../components/EmptyState'
import ResultsGrid from '../components/ResultsGrid'
import SearchBar from '../components/SearchBar'
import { downloadToDevice } from '../deviceDownloads'

interface Props {
  settings: AppSettings
  /** Externally-driven query (e.g. clicking a trending card on Home). */
  term: string | null
  onOpenDetail: (card: SeasonCard) => void
  onJobsCreated: () => void
  onSkipped: (jobs: DownloadJob[]) => void
}

/** Search view: query, results grid, and bulk season download. */
export default function SearchView({ settings, term, onOpenDetail, onJobsCreated, onSkipped }: Props) {
  const [results, setResults] = useState<SeasonCard[]>([])
  const [lastQuery, setLastQuery] = useState('')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

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
      <SearchBar onResults={handleSearchResults} term={term} />

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
        </div>
      )}

      {results.length === 0 && lastQuery !== '' ? (
        <EmptyState
          title={`No results for “${lastQuery}”`}
          message="Try a different title, or check the spelling."
        />
      ) : results.length === 0 ? (
        <EmptyState
          title="Search the catalogue"
          message="Type a series or film name above. Results can be played here, cast to a TV, or downloaded."
        />
      ) : (
        <ResultsGrid
          cards={results}
          checkedIds={checkedIds}
          onToggle={toggleCard}
          onOpenDetail={onOpenDetail}
          enrich={settings.tmdb_configured}
        />
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

function chunkBy<T>(items: T[], key: (i: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(item)
  }
  return [...groups.values()]
}
