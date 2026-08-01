import { useEffect, useState } from 'react'
import type { DownloadItem, EpisodeDetail, SeasonCard, SeasonDetail } from '../api'
import { checkDownloads, getSeason, postDownloads } from '../api'
import ConfirmDownloadModal from './ConfirmDownloadModal'
import PlayerModal from './PlayerModal'
import CastModal from './CastModal'
import { useModalBack } from '../useModalBack'

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
  useModalBack(true, onClose)
  const [detail, setDetail] = useState<SeasonDetail | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState(true)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())
  const [activeLang, setActiveLang] = useState(lang)
  const [playing, setPlaying] = useState<{ episodes: EpisodeDetail[]; index: number } | null>(null)
  const [casting, setCasting] = useState<{ episodes: EpisodeDetail[]; index: number } | null>(null)

  // Big, clearly-tappable icon actions for an episode row (play / cast / open).
  const iconBtn = 'btn btn-ghost btn-sm sm:btn-md btn-square text-base-content/50 hover:text-violet-400'

  // Ordered playlist of episodes with at least one provider, starting at the
  // clicked one, so both the player and cast can autoplay through the season.
  function playlistFrom(ep: EpisodeDetail): { episodes: EpisodeDetail[]; index: number } | null {
    if (!detail) return null
    const playable = detail.episodes.filter(e => Object.keys(e.embed_urls).length > 0)
    const index = Math.max(0, playable.findIndex(e => e.number === ep.number))
    return { episodes: playable, index }
  }
  function playFrom(ep: EpisodeDetail) { const p = playlistFrom(ep); if (p) setPlaying(p) }
  function castFrom(ep: EpisodeDetail) { const p = playlistFrom(ep); if (p) setCasting(p) }

  function rowActions(ep: EpisodeDetail) {
    const hasProviders = Object.keys(ep.embed_urls).length > 0
    return (
      <div className="flex items-center gap-0.5 shrink-0">
        {hasProviders && (
          <>
            <button
              onClick={e => { e.stopPropagation(); playFrom(ep) }}
              title="Play in browser"
              aria-label="Play in browser"
              className={iconBtn}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              onClick={e => { e.stopPropagation(); castFrom(ep) }}
              title="Cast to a device"
              aria-label="Cast to a device"
              className={iconBtn}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01" />
              </svg>
            </button>
          </>
        )}
        <a
          href={card.page_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on fstream"
          aria-label="Open on fstream"
          className={iconBtn}
          onClick={e => e.stopPropagation()}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    )
  }

  useEffect(() => {
    let cancelled = false
    getSeason(card.page_url, activeLang)
      .then(d => {
        if (cancelled) return
        // Requested language absent but another exists: switch and let the
        // refetch load it — keep "Loading…" so the empty-state doesn't flash.
        if (d.available_langs.length > 0 && !d.available_langs.includes(activeLang)) {
          setActiveLang(d.available_langs[0])
          return
        }
        setDetail(d)
        setChecked(new Set(d.episodes.map(e => e.number)))
        setError(null)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [card.page_url, activeLang])

  function toggleEpisode(num: number) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
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
    // eslint-disable-next-line no-control-regex
    const sanitizedName = card.series_name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').trim()
    const filmFilename = detail.is_film ? sanitizedName + '.mp4' : null

    const items: DownloadItem[] = detail.episodes
      .filter(ep => checked.has(ep.number))
      .map(ep => ({
        embed_url: ep.embed_urls['uqload'] ?? ep.embed_urls['vidzy'] ?? ep.embed_urls['netu'] ?? Object.values(ep.embed_urls)[0] ?? '',
        provider: ep.embed_urls['uqload'] ? 'uqload' : ep.embed_urls['vidzy'] ? 'vidzy' : ep.embed_urls['netu'] ? 'netu' : Object.keys(ep.embed_urls)[0] ?? '',
        all_providers: ep.embed_urls,
        episode_name: filmFilename ?? ep.filename,
        series_name: card.series_name,
        season: detail.is_film ? 0 : detail.season,
        lang: activeLang,
      }))
      .filter(i => i.embed_url)

    if (!items.length) {
      setError('No stream sources found for this film. The provider may be unsupported.')
      return
    }
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
      <div className="modal modal-open" onClick={onClose}>
        <div
          className="modal-box w-full max-w-2xl h-[88dvh] sm:h-auto sm:max-h-[80dvh] flex flex-col p-0"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-base-300">
            <div className="min-w-0">
              <h2 className="font-semibold text-lg truncate">{card.series_name}</h2>
              <p className="text-base-content/60 text-sm">
                {detail ? (detail.is_film ? 'Film' : `Season ${detail.season}`) : '…'}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="btn btn-circle btn-ghost shrink-0">✕</button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-2 sm:px-6 py-4">
            {loading && <p className="text-base-content/60">Loading…</p>}
            {error && <p className="text-error">{error}</p>}

            {/* No playable version — shown like an unavailable source, so the
                user sees it immediately instead of an empty list. */}
            {detail && detail.episodes.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <svg className="w-8 h-8 text-error/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-error text-sm">No VF / VOSTFR / VO version available for this title.</p>
                <p className="text-base-content/40 text-xs">There are no episodes to play or download.</p>
              </div>
            )}

            {detail && !detail.is_film && detail.episodes.length > 0 && (
              <>
                {/* Season row */}
                <div className="flex items-center gap-3 mb-2 px-2 sm:px-3 py-2 cursor-pointer select-none" onClick={toggleAll}>
                  <input
                    type="checkbox"
                    checked={seasonState === 'all'}
                    ref={el => { if (el) el.indeterminate = seasonState === 'partial' }}
                    onChange={toggleAll}
                    className="checkbox checkbox-primary"
                    onClick={e => e.stopPropagation()}
                  />
                  <span
                    className="text-base-content/80 font-medium flex-1"
                    onClick={() => setExpanded(e => !e)}
                  >
                    {expanded ? '▾' : '▸'} Season {detail.season}
                    <span className="text-base-content/40 text-sm ml-2">
                      ({detail.episodes.length} episodes)
                    </span>
                  </span>
                  <div className="flex gap-1">
                    {detail.available_langs.map(l => (
                      <button
                        key={l}
                        onClick={e => { e.stopPropagation(); setActiveLang(l) }}
                        className={`btn btn-sm font-mono uppercase ${l === activeLang ? 'btn-primary' : 'btn-ghost'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Episode rows */}
                {expanded && (
                  <div className="ml-1 sm:ml-7 space-y-1">
                    {detail.episodes.map(ep => {
                      const hasProviders = Object.keys(ep.embed_urls).length > 0
                      return (
                      <div key={ep.number} className="flex items-center gap-2 sm:gap-3 hover:bg-base-300 rounded-lg px-2 sm:px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked.has(ep.number)}
                          onChange={() => toggleEpisode(ep.number)}
                          aria-label={`Select episode ${ep.number}`}
                          className="checkbox checkbox-primary shrink-0 cursor-pointer"
                        />
                        <div
                          className={`flex items-center gap-3 flex-1 min-w-0 ${hasProviders ? 'cursor-pointer' : ''}`}
                          onClick={() => hasProviders && playFrom(ep)}
                          title={hasProviders ? 'Play in browser' : undefined}
                        >
                          <span className="text-base-content/50 text-xs sm:text-sm font-mono w-8 shrink-0">
                            E{String(ep.number).padStart(2, '0')}
                          </span>
                          <span className="text-sm sm:text-base flex-1 truncate">{ep.title}</span>
                        </div>
                        {rowActions(ep)}
                      </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {detail && detail.is_film && detail.episodes.length > 0 && (
              <div className="space-y-3">
                <div className="flex gap-1 mb-3">
                  {detail.available_langs.map(l => (
                    <button
                      key={l}
                      onClick={() => setActiveLang(l)}
                      className={`btn btn-sm font-mono uppercase ${l === activeLang ? 'btn-primary' : 'btn-ghost'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {detail.episodes.map(ep => {
                  const hasProviders = Object.keys(ep.embed_urls).length > 0
                  return (
                  <div key={ep.number} className="flex items-center gap-2 sm:gap-3 hover:bg-base-300 rounded-lg px-2 sm:px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checked.has(ep.number)}
                      onChange={() => toggleEpisode(ep.number)}
                      aria-label={`Select ${ep.title}`}
                      className="checkbox checkbox-primary shrink-0 cursor-pointer"
                    />
                    <div
                      className={`flex items-center gap-3 flex-1 min-w-0 ${hasProviders ? 'cursor-pointer' : ''}`}
                      onClick={() => hasProviders && playFrom(ep)}
                      title={hasProviders ? 'Play in browser' : undefined}
                    >
                      <span className="text-sm sm:text-base flex-1 truncate font-medium">{ep.title}</span>
                    </div>
                    {rowActions(ep)}
                  </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer — hidden when there are no episodes to download */}
          {(!detail || detail.episodes.length > 0) && (
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-base-300">
              <span className="text-base-content/60 text-sm shrink-0">
                {checked.size} selected
              </span>
              <button
                onClick={handleDownload}
                disabled={checked.size === 0 || submitting || loading}
                className="btn btn-primary flex-1 sm:flex-none"
              >
                {submitting ? 'Checking…' : 'Download selected'}
              </button>
            </div>
          )}
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

      {playing && (
        <PlayerModal
          episodes={playing.episodes}
          startIndex={playing.index}
          onClose={() => setPlaying(null)}
        />
      )}

      {casting && (
        <CastModal
          episodes={casting.episodes}
          startIndex={casting.index}
          onClose={() => setCasting(null)}
        />
      )}
    </>
  )
}
