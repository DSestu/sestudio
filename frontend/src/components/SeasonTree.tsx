import { useEffect, useState } from 'react'
import type { DownloadItem, EpisodeDetail, SeasonCard, SeasonDetail } from '../api'
import { checkDownloads, getSeason, postDownloads } from '../api'
import ConfirmDownloadModal from './ConfirmDownloadModal'

interface Props {
  card: SeasonCard
  lang: string
  outputRoot: string
  onClose: () => void
  onJobsCreated: () => void
}

type CheckState = 'all' | 'none' | 'partial'

function allChecked(eps: EpisodeDetail[], checked: Set<number>): CheckState {
  const n = eps.filter(e => checked.has(e.number)).length
  if (n === 0) return 'none'
  if (n === eps.length) return 'all'
  return 'partial'
}

export default function SeasonTree({ card, lang, outputRoot, onClose, onJobsCreated }: Props) {
  const [detail, setDetail] = useState<SeasonDetail | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState(true)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    getSeason(card.page_url, lang)
      .then(d => {
        setDetail(d)
        setChecked(new Set(d.episodes.map(e => e.number)))
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [card.page_url, lang])

  function toggleEpisode(num: number) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  function toggleAll() {
    if (!detail) return
    const state = allChecked(detail.episodes, checked)
    if (state === 'all') setChecked(new Set())
    else setChecked(new Set(detail.episodes.map(e => e.number)))
  }

  async function handleDownload() {
    if (!detail) return
    const items: DownloadItem[] = detail.episodes
      .filter(ep => checked.has(ep.number))
      .map(ep => ({
        embed_url: ep.embed_urls['uqload'] ?? ep.embed_urls['netu'] ?? Object.values(ep.embed_urls)[0] ?? '',
        provider: ep.embed_urls['uqload'] ? 'uqload' : ep.embed_urls['netu'] ? 'netu' : Object.keys(ep.embed_urls)[0] ?? '',
        all_providers: ep.embed_urls,
        episode_name: ep.filename,
        series_name: card.series_name,
        season: detail.season,
      }))
      .filter(i => i.embed_url)

    if (!items.length) return
    setSubmitting(true)
    try {
      const existing = await checkDownloads(items)
      setExistingFiles(new Set(existing))
      setPendingItems(items)
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDownload() {
    if (!pendingItems) return
    setSubmitting(true)
    try {
      await postDownloads(pendingItems)
      setPendingItems(null)
      onJobsCreated()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const seasonState = detail ? allChecked(detail.episodes, checked) : 'none'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
        <div
          className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
            <div>
              <h2 className="text-white font-semibold text-lg">{card.series_name}</h2>
              <p className="text-zinc-400 text-sm">Season {detail?.season ?? '…'}</p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-white text-xl">✕</button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-6 py-4">
            {loading && <p className="text-zinc-400">Loading episodes…</p>}
            {error && <p className="text-red-400">{error}</p>}
            {detail && (
              <>
                {/* Season row */}
                <div className="flex items-center gap-3 mb-2 cursor-pointer select-none" onClick={toggleAll}>
                  <input
                    type="checkbox"
                    checked={seasonState === 'all'}
                    ref={el => { if (el) el.indeterminate = seasonState === 'partial' }}
                    onChange={toggleAll}
                    className="accent-violet-500 w-4 h-4"
                    onClick={e => e.stopPropagation()}
                  />
                  <span
                    className="text-zinc-300 font-medium flex-1"
                    onClick={() => setExpanded(e => !e)}
                  >
                    {expanded ? '▾' : '▸'} Season {detail.season}
                    <span className="text-zinc-500 text-sm ml-2">
                      ({detail.episodes.length} episodes)
                    </span>
                  </span>
                  <div className="flex gap-1">
                    {detail.available_langs.map(l => (
                      <span key={l} className={`text-xs px-1.5 py-0.5 rounded font-mono uppercase ${l === lang ? 'bg-violet-600 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                        {l}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Episode rows */}
                {expanded && (
                  <div className="ml-7 space-y-1">
                    {detail.episodes.map(ep => (
                      <div key={ep.number} className="flex items-center gap-3 hover:bg-zinc-800 rounded px-2 py-1">
                        <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked.has(ep.number)}
                            onChange={() => toggleEpisode(ep.number)}
                            className="accent-violet-500 w-4 h-4 shrink-0"
                          />
                          <span className="text-zinc-400 text-sm font-mono w-10 shrink-0">
                            E{String(ep.number).padStart(2, '0')}
                          </span>
                          <span className="text-zinc-200 text-sm flex-1 truncate">{ep.title}</span>
                          <div className="flex gap-1 shrink-0">
                            {ep.providers.map(p => (
                              <span key={p} className="text-xs bg-zinc-700 text-zinc-400 rounded px-1">{p}</span>
                            ))}
                          </div>
                        </label>
                        <a
                          href={card.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open on fstream"
                          className="shrink-0 text-zinc-500 hover:text-violet-400 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-700">
            <span className="text-zinc-400 text-sm">
              {checked.size} episode{checked.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={handleDownload}
              disabled={checked.size === 0 || submitting || loading}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {submitting ? 'Checking…' : 'Download selected'}
            </button>
          </div>
        </div>
      </div>

      {pendingItems && (
        <ConfirmDownloadModal
          items={pendingItems}
          outputRoot={outputRoot}
          existingFiles={existingFiles}
          onConfirm={confirmDownload}
          onCancel={() => setPendingItems(null)}
        />
      )}
    </>
  )
}
