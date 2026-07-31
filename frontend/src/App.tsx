import { useEffect, useState } from 'react'
import type { AppSettings, DownloadItem, DownloadJob, SeasonCard } from './api'
import { checkDownloads, getSeason, postDownloads } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import CastControls from './components/CastControls'
import DlnaControls from './components/DlnaControls'
import ConfirmDownloadModal from './components/ConfirmDownloadModal'
import DownloadQueue from './components/DownloadQueue'
import ResultsGrid from './components/ResultsGrid'
import SearchBar from './components/SearchBar'
import SeasonTree from './components/SeasonTree'
import SettingsPanel from './components/SettingsPanel'

export default function App() {
  const [results, setResults] = useState<SeasonCard[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<SeasonCard | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ output_root: '.', lang: 'vf' })
  const [downloadTick, setDownloadTick] = useState(0)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna() }, [])

  const cardMap = new Map(results.map(c => [c.newsid, c]))

  function toggleCard(newsid: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(newsid)) next.delete(newsid)
      else next.add(newsid)
      return next
    })
  }

  function handleSearchResults(cards: SeasonCard[]) {
    setResults(cards)
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

  async function confirmDownload() {
    if (!pendingItems) return
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
          fstream<span className="text-violet-400">-dl</span>
        </h1>
        <SettingsPanel onChange={setSettings} />
      </div>

      <SearchBar onResults={handleSearchResults} />

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
                ? 'bg-violet-600 border-violet-600'
                : results.some(c => checkedIds.has(c.newsid))
                ? 'bg-violet-900 border-violet-500'
                : 'border-base-content/30'
            }`}>
              {results.every(c => checkedIds.has(c.newsid)) && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!results.every(c => checkedIds.has(c.newsid)) && results.some(c => checkedIds.has(c.newsid)) && (
                <span className="w-2 h-0.5 bg-violet-400 block" />
              )}
            </span>
            {results.every(c => checkedIds.has(c.newsid)) ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-base-content/30 text-sm">{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      <ResultsGrid
        cards={results}
        checkedIds={checkedIds}
        onToggle={toggleCard}
        onOpenDetail={setSelected}
      />

      {/* Bulk download bar */}
      {checkedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 card card-bordered bg-base-200 shadow-xl px-6 py-3">
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
          onConfirm={confirmDownload}
          onCancel={() => setPendingItems(null)}
        />
      )}

      {selected && (
        <SeasonTree
          card={selected}
          lang={settings.lang}
          outputRoot={settings.output_root}
          onClose={() => setSelected(null)}
          onJobsCreated={() => setDownloadTick(t => t + 1)}
        />
      )}

      <CastControls />
      <DlnaControls />
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
