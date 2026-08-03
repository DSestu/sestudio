import { useState } from 'react'
import type {
  AppSettings, DownloadDestination, DownloadItem, EpisodeDetail, SeasonDetail,
} from '../api'
import { checkDownloads, postDownloads } from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import EmptyState from '../components/EmptyState'
import ProviderChips from '../components/ProviderChips'
import SaveToggles from '../components/SaveToggles'
import TitleHeader from '../components/season/TitleHeader'
import EpisodeList from '../components/watch/EpisodeList'
import OutputSwitcher from '../components/watch/OutputSwitcher'
import VideoPane from '../components/watch/VideoPane'
import { useSeasonDetail } from '../components/season/useSeasonDetail'
import { downloadToDevice } from '../deviceDownloads'
import type { Navigate } from '../nav'
import type { PlayableEpisode } from '../providers'
import { useProviderSources } from '../useProviderSources'
import { useTmdb } from '../useTmdb'
import { useWatchState, watchKey } from '../watchState'

/** Stable reference — useProviderSources resets on embedUrls identity change. */
const NO_EMBEDS: Record<string, string> = {}

const COLLAPSE_KEY = 'sestudio.playlist.collapsed'
const MOBILE_TABS = ['episodes', 'details', 'download'] as const
type MobileTab = (typeof MOBILE_TABS)[number]

interface Props {
  pageUrl: string
  /** Title identity - SeasonDetail carries neither, so the route supplies them. */
  seriesName: string
  posterUrl: string
  lang: string
  /** Episode to open on load (from a library deep-link). */
  episode?: number
  settings: AppSettings
  navigate: Navigate
  onJobsCreated: () => void
}

/**
 * The watch workspace: season playlist on the left, player on the right, and
 * the output (browser / Chromecast / DLNA) switchable in place. Replaces the
 * old stack of season → player → cast modals.
 */
export default function WatchView({
  pageUrl, seriesName, posterUrl, lang, episode, settings, navigate, onJobsCreated,
}: Props) {
  const { detail, loading, error, setError, activeLang, setActiveLang } = useSeasonDetail(pageUrl, lang)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [initializedFor, setInitializedFor] = useState<SeasonDetail | null>(null)
  const [currentNumber, setCurrentNumber] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [tab, setTab] = useState<MobileTab>('episodes')
  const [autoplay, setAutoplay] = useState(true)
  const [position, setPosition] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  const watch = useWatchState()

  // On a (re)fetched season: select everything for download and pick the
  // episode to play — the deep-linked one, else the first playable.
  if (detail && detail !== initializedFor) {
    setInitializedFor(detail)
    setChecked(new Set(detail.episodes.map(e => e.number)))
    const playableEps = detail.episodes.filter(e => Object.keys(e.embed_urls).length > 0)
    const target = (episode !== undefined
      ? playableEps.find(e => e.number >= episode)
      : undefined) ?? playableEps[0]
    setCurrentNumber(target?.number ?? null)
  }

  const season = detail?.is_film ? 0 : (detail?.season ?? 0)
  const meta = useTmdb(seriesName, 0, !!detail?.is_film, !!settings.tmdb_configured)

  /** Attach title identity so playback/casting can record watch-state. */
  function toPlayable(e: EpisodeDetail, d: SeasonDetail): PlayableEpisode {
    return {
      number: e.number,
      title: e.title,
      embed_urls: e.embed_urls,
      series_name: seriesName,
      season: d.is_film ? 0 : d.season,
      poster_url: posterUrl,
      page_url: pageUrl,
      lang: activeLang,
    }
  }

  const playlist: PlayableEpisode[] = detail
    ? detail.episodes.filter(e => Object.keys(e.embed_urls).length > 0).map(e => toPlayable(e, detail))
    : []
  const index = Math.max(0, playlist.findIndex(e => e.number === currentNumber))
  const current: PlayableEpisode | undefined = playlist[index]
  const nextEp = playlist[index + 1]

  const { providers, status, sources, active, select, markFailed, probing } =
    useProviderSources(current?.embed_urls ?? NO_EMBEDS)
  const source = active ? sources[active] : null

  function setCurrent(ep: EpisodeDetail) {
    setCurrentNumber(ep.number)
    setPosition(0)
  }

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
    const all = detail.episodes.every(e => checked.has(e.number))
    setChecked(all ? new Set() : new Set(detail.episodes.map(e => e.number)))
  }

  function toggleCollapsed() {
    setCollapsed(c => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      return !c
    })
  }

  async function handleDownload() {
    if (!detail) return
    // eslint-disable-next-line no-control-regex
    const sanitized = seriesName.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').trim()
    const filmFilename = detail.is_film ? sanitized + '.mp4' : null

    const items: DownloadItem[] = detail.episodes
      .filter(ep => checked.has(ep.number))
      .map(ep => ({
        embed_url: ep.embed_urls['uqload'] ?? ep.embed_urls['vidzy'] ?? ep.embed_urls['netu'] ?? Object.values(ep.embed_urls)[0] ?? '',
        provider: ep.embed_urls['uqload'] ? 'uqload' : ep.embed_urls['vidzy'] ? 'vidzy' : ep.embed_urls['netu'] ? 'netu' : Object.keys(ep.embed_urls)[0] ?? '',
        all_providers: ep.embed_urls,
        episode_name: filmFilename ?? ep.filename,
        series_name: seriesName,
        season: detail.is_film ? 0 : detail.season,
        lang: activeLang,
      }))
      .filter(i => i.embed_url)

    if (!items.length) {
      setError('No stream sources found for the selected items.')
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

  async function confirmDownload(destination: DownloadDestination) {
    if (!pendingItems) return
    setSubmitting(true)
    try {
      if (destination === 'device') {
        const items = pendingItems
        setPendingItems(null)
        void downloadToDevice(items).then(queued => { if (queued) onJobsCreated() })
        return
      }
      await postDownloads(pendingItems)
      onJobsCreated()
      setPendingItems(null)
    } finally {
      setSubmitting(false)
    }
  }

  const watchedNumbers = new Set(
    (detail?.episodes ?? [])
      .filter(e => watch[watchKey(seriesName, season, e.number)]?.watched)
      .map(e => e.number),
  )
  const progress: Record<number, number> = {}
  for (const e of detail?.episodes ?? []) {
    const w = watch[watchKey(seriesName, season, e.number)]
    if (w && w.duration > 0) progress[e.number] = w.position / w.duration
  }

  const list = detail && (
    <EpisodeList
      episodes={detail.episodes}
      currentNumber={currentNumber}
      checked={checked}
      watchedNumbers={watchedNumbers}
      progress={progress}
      langs={detail.available_langs}
      activeLang={activeLang}
      isFilm={detail.is_film}
      season={season}
      seriesName={seriesName}
      posterUrl={posterUrl}
      pageUrl={pageUrl}
      onSelect={setCurrent}
      onToggle={toggleEpisode}
      onToggleAll={toggleAll}
      onLang={setActiveLang}
    />
  )

  const downloadBar = (
    <div className="flex items-center justify-between gap-3 px-3 py-3 border-t border-base-300">
      <span className="text-base-content/60 text-sm shrink-0">{checked.size} selected</span>
      <button
        onClick={handleDownload}
        disabled={checked.size === 0 || submitting || loading}
        className="btn btn-primary btn-sm flex-1 sm:flex-none"
      >
        {submitting ? 'Checking…' : 'Download'}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Title bar */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('search')} aria-label="Back" className="btn btn-ghost btn-sm btn-square">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg truncate">{seriesName}</h2>
          <p className="text-base-content/50 text-xs">
            {detail ? (detail.is_film ? 'Film' : `Season ${detail.season}`) : ''}
            {current && !detail?.is_film && ` · E${String(current.number).padStart(2, '0')} — ${current.title}`}
          </p>
        </div>
        {detail && (
          <SaveToggles
            entry={{
              kind: 'title',
              series: seriesName,
              season,
              label: seriesName,
              poster_url: posterUrl,
              page_url: pageUrl,
              lang: activeLang,
            }}
          />
        )}
      </div>

      {loading && <p className="text-base-content/60">Loading…</p>}
      {error && <p role="alert" className="text-error">{error}</p>}

      {detail && detail.episodes.length === 0 && (
        <EmptyState
          title="No version available"
          message="There is no VF / VOSTFR / VO version of this title to play or download."
        />
      )}

      {detail && detail.episodes.length > 0 && (
        <div className="lg:flex lg:gap-4 lg:items-start">
          {/* Desktop playlist column — collapsible */}
          <aside
            className={`hidden lg:flex lg:flex-col rounded-box border border-base-300 bg-base-200 overflow-hidden transition-[width] ${
              collapsed ? 'lg:w-12' : 'lg:w-80'
            } lg:h-[calc(100dvh-9rem)] lg:sticky lg:top-4 shrink-0`}
          >
            <div className={`flex items-center gap-2 px-2 py-2 border-b border-base-300 ${collapsed ? 'justify-center' : 'justify-between'}`}>
              {!collapsed && <span className="text-xs uppercase tracking-wide text-base-content/40 pl-1">Episodes</span>}
              <button
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-label={collapsed ? 'Expand playlist' : 'Collapse playlist'}
                title={collapsed ? 'Expand playlist' : 'Collapse playlist'}
                className="btn btn-ghost btn-xs btn-square"
              >
                {collapsed ? '›' : '‹'}
              </button>
            </div>
            {collapsed ? (
              <button
                onClick={toggleCollapsed}
                className="flex-1 flex items-start justify-center pt-3 text-base-content/40 hover:text-base-content"
                aria-label="Expand playlist"
              >
                <span className="[writing-mode:vertical-rl] text-xs tracking-wide">
                  {detail.episodes.length} episodes
                </span>
              </button>
            ) : (
              <>
                <div className="flex-1 min-h-0">{list}</div>
                {downloadBar}
              </>
            )}
          </aside>

          {/* Player pane */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {/* Sticky on mobile so the list scrolls under it; static on desktop.
                The browser always plays the browsed episode; casting to a TV is
                a separate, non-disruptive action (see OutputSwitcher). */}
            <div className="sticky top-14 z-20 -mx-4 px-4 py-2 bg-base-100 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent">
              {current ? (
                <VideoPane
                  ep={current}
                  source={source}
                  probing={probing}
                  nextTitle={nextEp?.title ?? null}
                  autoplay={autoplay}
                  onSourceError={() => { if (active) markFailed(active) }}
                  onAdvance={() => nextEp && setCurrentNumber(nextEp.number)}
                  onPosition={setPosition}
                />
              ) : (
                <div className="aspect-video rounded-box bg-base-200 flex items-center justify-center text-base-content/40 text-sm">
                  Select an episode to start
                </div>
              )}
            </div>

            {/* Output + providers + autoplay */}
            {current && (
              <div className="flex flex-col gap-3">
                <OutputSwitcher
                  episodes={playlist}
                  index={index}
                  source={source}
                  autoplay={autoplay}
                  handoffAt={position}
                  onSourceFailed={() => { if (active) markFailed(active) }}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <ProviderChips providers={providers} active={active} status={status} onSelect={select} />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-base-content/70 ml-auto">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={autoplay}
                      onChange={e => setAutoplay(e.target.checked)}
                    />
                    Autoplay next
                  </label>
                </div>
              </div>
            )}

            {/* Mobile: tabs for everything the desktop shows alongside */}
            <div className="lg:hidden">
              <div role="tablist" className="tabs tabs-box">
                {MOBILE_TABS.map(t => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`tab flex-1 capitalize ${tab === t ? 'tab-active' : ''}`}
                  >
                    {t === 'download' ? `Download (${checked.size})` : t}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-box border border-base-300 bg-base-200 overflow-hidden">
                {tab === 'episodes' && list}
                {tab === 'details' && (
                  <div className="p-3">
                    {meta ? <TitleHeader meta={meta} /> : (
                      <p className="text-sm text-base-content/50">
                        No extra metadata — add a TMDB key in Settings for synopsis, cast and artwork.
                      </p>
                    )}
                  </div>
                )}
                {tab === 'download' && downloadBar}
              </div>
            </div>

            {/* Desktop: metadata sits under the player */}
            <div className="hidden lg:block">
              <TitleHeader meta={meta} />
            </div>
          </div>
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
