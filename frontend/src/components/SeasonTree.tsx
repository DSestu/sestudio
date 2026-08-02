import { useState } from 'react'
import type { DownloadItem, EpisodeDetail, SeasonCard } from '../api'
import { checkDownloads, postDownloads } from '../api'
import ConfirmDownloadModal from './ConfirmDownloadModal'
import PlayerModal from './PlayerModal'
import CastModal from './CastModal'
import { useModalBack } from '../useModalBack'
import type { PlayableEpisode } from '../providers'
import { useWatchState, watchKey } from '../watchState'
import ResponsiveModal from './ResponsiveModal'
import { useSeasonDetail } from './season/useSeasonDetail'
import EpisodeRow from './season/EpisodeRow'
import LangSwitcher from './season/LangSwitcher'

interface Props {
  card: SeasonCard
  lang: string
  outputRoot: string
  onClose: () => void
  onJobsCreated: () => void
  /** Open the player on this episode number as soon as the season loads. */
  autoPlayEpisode?: number
}

type CheckState = 'all' | 'none' | 'partial'

function allChecked(eps: EpisodeDetail[], checked: Set<number>): CheckState {
  const n = eps.filter(e => checked.has(e.number)).length
  if (n === 0) return 'none'
  if (n === eps.length) return 'all'
  return 'partial'
}

export default function SeasonTree({ card, lang, outputRoot, onClose, onJobsCreated, autoPlayEpisode }: Props) {
  useModalBack(true, onClose)
  const { detail, loading, error, setError, activeLang, setActiveLang } = useSeasonDetail(card.page_url, lang)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [initializedFor, setInitializedFor] = useState<typeof detail>(null)
  const [expanded, setExpanded] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())
  const [playing, setPlaying] = useState<{ episodes: PlayableEpisode[]; index: number } | null>(null)
  const [casting, setCasting] = useState<{ episodes: PlayableEpisode[]; index: number } | null>(null)

  // Select all episodes whenever a (re)fetched detail arrives (also on lang switch).
  if (detail && detail !== initializedFor) {
    setInitializedFor(detail)
    setChecked(new Set(detail.episodes.map(e => e.number)))
    // Library deep-link: jump straight into the player on the requested episode
    // (or the first playable one after it, e.g. when "next up" doesn't exist yet).
    if (autoPlayEpisode !== undefined && initializedFor === null) {
      const target = detail.episodes.find(e => e.number >= autoPlayEpisode && Object.keys(e.embed_urls).length > 0)
        ?? detail.episodes.find(e => Object.keys(e.embed_urls).length > 0)
      if (target) {
        const playable = detail.episodes
          .filter(e => Object.keys(e.embed_urls).length > 0)
          .map(e => toPlayable(e, detail))
        const idx = Math.max(0, playable.findIndex(e => e.number === target.number))
        setPlaying({ episodes: playable, index: idx })
      }
    }
  }

  // Attach the title identity (series/season/lang/…) to an episode so playback
  // and casting can record watch-state and the library can reopen the title.
  function toPlayable(e: EpisodeDetail, d: NonNullable<typeof detail>): PlayableEpisode {
    return {
      number: e.number,
      title: e.title,
      embed_urls: e.embed_urls,
      series_name: card.series_name,
      season: d.is_film ? 0 : d.season,
      poster_url: card.poster_url,
      page_url: card.page_url,
      lang: activeLang,
    }
  }

  // Ordered playlist of episodes with at least one provider, starting at the
  // clicked one, so both the player and cast can autoplay through the season.
  function playlistFrom(ep: EpisodeDetail): { episodes: PlayableEpisode[]; index: number } | null {
    if (!detail) return null
    const playable = detail.episodes
      .filter(e => Object.keys(e.embed_urls).length > 0)
      .map(e => toPlayable(e, detail))
    const index = Math.max(0, playable.findIndex(e => e.number === ep.number))
    return { episodes: playable, index }
  }
  function playFrom(ep: EpisodeDetail) { const p = playlistFrom(ep); if (p) setPlaying(p) }
  function castFrom(ep: EpisodeDetail) { const p = playlistFrom(ep); if (p) setCasting(p) }

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
  const watch = useWatchState()
  const isWatched = (epNumber: number) =>
    !!detail && !!watch[watchKey(card.series_name, detail.is_film ? 0 : detail.season, epNumber)]?.watched

  return (
    <>
      <ResponsiveModal
        onClose={onClose}
        boxClassName="w-full max-w-2xl h-[88dvh] sm:h-auto sm:max-h-[80dvh] flex flex-col p-0"
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
                  <button
                    type="button"
                    className="text-base-content/80 font-medium flex-1 text-left"
                    aria-expanded={expanded}
                    onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
                  >
                    {expanded ? '▾' : '▸'} Season {detail.season}
                    <span className="text-base-content/40 text-sm ml-2">
                      ({detail.episodes.length} episodes)
                    </span>
                  </button>
                  <LangSwitcher langs={detail.available_langs} active={activeLang} onSelect={setActiveLang} />
                </div>

                {/* Episode rows */}
                {expanded && (
                  <div className="ml-1 sm:ml-7 space-y-1">
                    {detail.episodes.map(ep => (
                      <EpisodeRow
                        key={ep.number}
                        ep={ep}
                        checked={checked.has(ep.number)}
                        onToggle={() => toggleEpisode(ep.number)}
                        onPlay={() => playFrom(ep)}
                        onCast={() => castFrom(ep)}
                        pageUrl={card.page_url}
                        showNumber
                        watched={isWatched(ep.number)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {detail && detail.is_film && detail.episodes.length > 0 && (
              <div className="space-y-3">
                <div className="mb-3">
                  <LangSwitcher langs={detail.available_langs} active={activeLang} onSelect={setActiveLang} />
                </div>
                {detail.episodes.map(ep => (
                  <EpisodeRow
                    key={ep.number}
                    ep={ep}
                    checked={checked.has(ep.number)}
                    onToggle={() => toggleEpisode(ep.number)}
                    onPlay={() => playFrom(ep)}
                    onCast={() => castFrom(ep)}
                    pageUrl={card.page_url}
                    showNumber={false}
                    watched={isWatched(ep.number)}
                  />
                ))}
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
      </ResponsiveModal>

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
