import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { togglePlaylistCollapsed, usePlaylistCollapsed } from '../playlistCollapsed'
import type {
  AppSettings, DownloadDestination, DownloadItem, EpisodeDetail, SeasonDetail,
} from '../api'
import { checkDownloads, DOWNLOADED_SOURCE, downloadedFileUrl, postDownloads } from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import { pickHost } from '../downloadPrefs'
import EmptyState from '../components/EmptyState'
import SaveToggles from '../components/SaveToggles'
import TitleHeader from '../components/season/TitleHeader'
import EpisodeList from '../components/watch/EpisodeList'
import OutputSwitcher from '../components/watch/OutputSwitcher'
import SourcesPanel from '../components/watch/SourcesPanel'
import VideoPane from '../components/watch/VideoPane'
import { useAlternateSources } from '../useAlternateSources'
import type { SourceListing } from '../useSourceListings'
import { useSourceListings } from '../useSourceListings'
import type { ShowSeason } from '../useShowSeasons'
import { useShowSeasons } from '../useShowSeasons'
import { InPortal, OutPortal } from '../reversePortal'
import { isDocumentPiPSupported, openDocumentPiP } from '../documentPiP'
import { closePiP, usePiPWindow } from '../pipSession'
import type { PortalNode } from '../portalNode'
import { useSeasonDetail } from '../components/season/useSeasonDetail'
import { downloadToDevice } from '../deviceDownloads'
import type { Navigate } from '../nav'
import { DOWNLOADED_PROVIDER, playbackOrder, type PlayableEpisode } from '../providers'
import { useProviderSources } from '../useProviderSources'
import {
  fileFor, fmtSize, langsFor, sanitizeName, titleFor, useDownloadedLibrary,
} from '../downloadedLibrary'
import { useTmdb } from '../useTmdb'
import { setWatched, useWatchState, watchKey } from '../watchState'

/** Stable reference — useProviderSources resets on embedUrls identity change. */
const NO_EMBEDS: Record<string, string> = {}

// Details is not among them: the TMDB metadata sits above the player on every
// breakpoint now, so a tab for it would duplicate what is already on screen.
const MOBILE_TABS = ['episodes', 'download'] as const
type MobileTab = (typeof MOBILE_TABS)[number]

interface Props {
  pageUrl: string
  /** Id of the content site serving pageUrl; absent means 'fstream'. */
  source?: string
  /** Other source pages for this title (other languages or mirrors). */
  altPageUrls?: string[]
  /** Site ids paired positionally with altPageUrls; missing entries mean 'fstream'. */
  altSources?: string[]
  /** Title identity - SeasonDetail carries neither, so the route supplies them. */
  seriesName: string
  posterUrl: string
  lang: string
  /** Episode to open on load (from a library deep-link). */
  episode?: number
  settings: AppSettings
  /** Persist a settings change made from here (the download preference). */
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<unknown> | void
  navigate: Navigate
  onJobsCreated: () => void
  /** False while the mini-player owns the video (this view is kept mounted but
   *  hidden). The video is only shown in the pane when visible. */
  visible: boolean
  /** Persistent host for the video element, shared with the mini-player, or
   *  null when this title is only being browsed — another title owns the
   *  player, or nothing is playing yet (settings.autoplay_on_open). */
  playerNode: PortalNode | null
  /** Ask to take over the player and start playing, optionally at an episode.
   *  Only called while browsing (playerNode === null). */
  onRequestPlayback: (episode?: number) => void
}

/**
 * The watch workspace: season playlist on the left, player on the right, and
 * the output (browser / Chromecast / DLNA) switchable in place. Replaces the
 * old stack of season → player → cast modals.
 */
export default function WatchView({
  pageUrl, source: sourceProp, altPageUrls, altSources, seriesName, posterUrl, lang, episode,
  settings, onUpdateSettings, navigate, onJobsCreated, visible, playerNode,
  onRequestPlayback,
}: Props) {
  // Browsing vs playing: without the shared player node this view shows the
  // title and its episodes only, and probes nothing, so opening a title never
  // disturbs what is already playing.
  const playing = playerNode !== null
  // The player node is still owned by this view while popped out — the PiP
  // window only borrows where it is *mounted*. Keeping `playing` true is what
  // stops source probing and the output controls from tearing down.
  const pipWindow = usePiPWindow()
  const {
    detail, loading, error, setError, activeLang, setActiveLang, langs,
    sourceUrl, sourceId, epLangs, epTitles,
  } = useSeasonDetail(pageUrl, lang, altPageUrls, sourceProp ?? 'fstream', altSources)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [initializedFor, setInitializedFor] = useState<SeasonDetail | null>(null)
  const [currentNumber, setCurrentNumber] = useState<number | null>(null)
  /** Episode the user asked for in another language, honoured once its season
   *  lands. Null outside a language switch. */
  const [pendingNumber, setPendingNumber] = useState<number | null>(null)
  const collapsed = usePlaylistCollapsed()
  const [tab, setTab] = useState<MobileTab>('episodes')
  const [autoplay, setAutoplay] = useState(true)
  const [position, setPosition] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [pendingItems, setPendingItems] = useState<DownloadItem[] | null>(null)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())
  // The route carries alternates as parallel lists, so pair them back up here.
  // Keyed on strings: the arrays are rebuilt on every render by the router.
  const altKey = (altPageUrls ?? []).join('|')
  const altSrcKey = (altSources ?? []).join('|')
  const mergedSources = useMemo(() => {
    const urls = altKey ? altKey.split('|') : []
    const srcs = altSrcKey ? altSrcKey.split('|') : []
    return urls.map((url, i) => ({
      page_url: url,
      source: srcs[i] || 'fstream',
      series_name: seriesName,
      poster_url: '',
      year: 0,
    }))
  }, [altKey, altSrcKey, seriesName])

  const watch = useWatchState()
  const season = detail?.is_film ? 0 : (detail?.season ?? 0)

  // What is on disk for this title. Read before anything decides what is
  // playable: a title opened from the downloaded library carries no embeds at
  // all, so the file *is* the only source it has.
  const downloadedTitles = useDownloadedLibrary()
  const downloadedTitle = titleFor(downloadedTitles, seriesName, season)

  /** Playable in the language on screen: a host to resolve, or a file on disk. */
  const playableIn = (number: number, embeds: Record<string, string>, lang: string) =>
    Object.keys(embeds).length > 0 || langsFor(downloadedTitle, number).includes(lang)
  const playableHere = (e: EpisodeDetail) => playableIn(e.number, e.embed_urls, activeLang)

  // On a (re)fetched season: select everything for download and pick the
  // episode to play — the deep-linked one, else the first playable.
  if (detail && detail !== initializedFor) {
    setInitializedFor(detail)
    const playableEps = detail.episodes.filter(playableHere)
    // Only what can actually be fetched: an episode this language lacks has
    // nothing to download, and one already on disk needs nothing.
    setChecked(new Set(
      detail.episodes.filter(e => Object.keys(e.embed_urls).length > 0).map(e => e.number),
    ))
    const wanted = pendingNumber ?? episode
    const target = (wanted !== undefined && wanted !== null
      ? playableEps.find(e => e.number >= wanted)
      : undefined) ?? playableEps[0]
    setCurrentNumber(target?.number ?? null)
    if (pendingNumber !== null) setPendingNumber(null)
  }

  const meta = useTmdb(seriesName, 0, !!detail?.is_film, !!settings.tmdb_configured)

  const {
    sources: siteSources,
    loading: siteSourcesLoading,
    ensureLoaded: loadSiteSources,
  } = useAlternateSources({
    seriesName,
    season,
    isFilm: !!detail?.is_film,
    source: sourceId,
    pageUrl: sourceUrl,
    tmdbId: meta?.tmdb_id,
    merged: mergedSources,
  })

  // Every site's listing is looked up as soon as the title opens, not on demand:
  // the sources panel is always on screen, and its whole job is to show what the
  // other sites have before you go looking.
  //
  // `season` is a dependency and not an afterthought: it is 0 until the page
  // loads, and candidates are matched on it, so a lookup fired before then finds
  // nothing and — being remembered as done — never retries. That is what left
  // every season past the first showing its own site alone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSiteSources() }, [seriesName, sourceId, sourceUrl, season, detail])
  // The copy on disk is not a site, and it already has its own row in the
  // sources panel. It reaches this list because a title opened from the
  // downloaded library *is* the open source, and the open source is always
  // listed — so it would otherwise appear twice. Dropping it here also spares
  // a season fetch for a listing nothing would render.
  const siteListings = useMemo(
    () => siteSources.filter(s => s.source !== DOWNLOADED_SOURCE),
    [siteSources],
  )
  const listings = useSourceListings(siteListings, activeLang)

  // Languages belong to the title, not to the site you happen to be on: senpai
  // carries VF only for most anime, so a VOSTFR that exists elsewhere would stay
  // invisible until you switched sites by hand. Every listing's answer is folded
  // in here, and picking one of those languages moves to the site that has it.
  const allLangs = useMemo(
    () => [...new Set([...langs, ...listings.flatMap(l => l.langs)])],
    [langs, listings],
  )
  const [allEpLangs, allEpTitles] = useMemo(() => {
    const map: Record<number, string[]> = {}
    const titles: Record<number, string> = { ...epTitles }
    const add = (number: number, codes: string[]) => {
      const seen = (map[number] ??= [])
      for (const code of codes) if (!seen.includes(code)) seen.push(code)
    }
    for (const [number, codes] of Object.entries(epLangs)) add(Number(number), codes)
    for (const listing of listings) {
      for (const [number, codes] of Object.entries(listing.epLangs)) {
        add(Number(number), codes)
      }
      for (const [number, title] of Object.entries(listing.epTitles)) {
        titles[Number(number)] ??= title
      }
    }
    // Switcher order first, so the chips read the same on every row.
    for (const codes of Object.values(map)) {
      codes.sort((a, b) => allLangs.indexOf(a) - allLangs.indexOf(b))
    }
    return [map, titles] as const
  }, [epLangs, epTitles, listings, allLangs])

  // The show's other seasons, for the playlist's season tree.
  const showSeasons = useShowSeasons(
    seriesName, sourceId, sourceUrl, !!detail?.is_film, season,
  )

  /** Move to another site's listing from the sources panel, optionally in a
   *  given language. The open episode travels; a listing that lacks that exact
   *  number falls back to the nearest one on load. */
  function switchListing(
    next: SourceListing, nextLang?: string, episodeNumber?: number,
  ) {
    // Carry the alternates across, and fold in the listing being left so it is
    // reachable from the other side. Without this the route arrives with no
    // `alt`, the panel rebuilds from the new page alone, and every other site
    // vanishes until an async re-lookup happens to find it again — switching to
    // one site looked like it deleted the others.
    const carried = [
      ...(altPageUrls ?? []).map((url, i) => ({
        url,
        src: (altSources ?? [])[i] || 'fstream',
      })),
      { url: sourceUrl, src: sourceId },
    ]
    const kept: { url: string; src: string }[] = []
    const seen = new Set<string>([next.page_url])
    for (const alt of carried) {
      if (!alt.url || seen.has(alt.url)) continue
      seen.add(alt.url)
      kept.push(alt)
    }

    navigate('watch', {
      u: next.page_url,
      t: seriesName,
      p: posterUrl,
      lang: nextLang ?? activeLang,
      ep: (episodeNumber ?? currentNumber) || undefined,
      src: next.source,
      alt: kept.length ? kept.map(a => a.url).join('|') : undefined,
      altsrc: kept.length ? kept.map(a => a.src).join('|') : undefined,
    })
  }

  /** The listing that can play an episode in a language, the open one first.
   *
   *  Falls back to the listing's own languages for a site that cannot answer
   *  per episode, and for films, which have no episode to ask about. */
  function listingWith(wanted: string, number: number | null): SourceListing | undefined {
    const has = (l: SourceListing) =>
      (number !== null && l.epLangs[number] ? l.epLangs[number] : l.langs).includes(wanted)
    return listings.find(l => l.current && has(l)) ?? listings.find(has)
  }

  /** Switch language, moving to whichever site actually has it. */
  function selectLang(next: string) {
    if (next === activeLang) return
    const target = listingWith(next, currentNumber)
    if (target && !target.current) {
      switchListing(target, next, currentNumber ?? undefined)
      return
    }
    setActiveLang(next)
  }

  /** Open another season of this show, keeping the title identity so the
   *  watch-state key and the poster survive the move. No episode travels: a
   *  different season's numbering means nothing here, so it opens at its own
   *  first playable episode. */
  function switchSeason(next: ShowSeason) {
    navigate('watch', {
      u: next.page_url,
      t: seriesName,
      p: posterUrl,
      lang: activeLang,
      src: next.source,
    })
  }

  // Language first: when the open episode has nothing to play in the chosen
  // language but another site carries it, move there rather than silently
  // falling back to a language nobody asked for. Each (episode, language) is
  // tried once, so a site that turns out not to have it either cannot start a
  // ping-pong between listings.
  const autoSwitched = useRef('')
  useEffect(() => {
    if (!detail || currentNumber === null) return
    const here = detail.episodes.find(e => e.number === currentNumber)
    // A copy on disk is a source, so don't go hunting other sites for it.
    if (here && playableHere(here)) return
    const attempt = `${sourceUrl}|${currentNumber}|${activeLang}`
    if (autoSwitched.current === attempt) return
    const rescue = listings.find(
      l => !l.current && (l.epLangs[currentNumber] ?? []).includes(activeLang),
    )
    if (!rescue) return
    autoSwitched.current = attempt
    switchListing(rescue)
    // switchListing closes over what the deps already cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, currentNumber, activeLang, listings, sourceUrl])

  /** Attach title identity so playback/casting can record watch-state.
   *
   *  Memoised together with `playlist` below: VideoPane keys its per-episode
   *  state (resume point, auto-next countdown) on the episode object, so a
   *  fresh object on every render would wipe that state whenever anything
   *  re-renders this view. */
  const toPlayable = useCallback((e: EpisodeDetail, d: SeasonDetail): PlayableEpisode => {
    return {
      number: e.number,
      title: e.title,
      embed_urls: e.embed_urls,
      series_name: seriesName,
      season: d.is_film ? 0 : d.season,
      poster_url: posterUrl,
      page_url: sourceUrl,
      lang: activeLang,
      source: sourceId,
      // The highest number rather than the count, so a sparse playlist can't
      // make the library think the season has ended early.
      seasonEpisodes: d.episodes.length
        ? Math.max(...d.episodes.map(x => x.number))
        : undefined,
    }
  }, [seriesName, posterUrl, sourceUrl, activeLang, sourceId])

  const playlist: PlayableEpisode[] = useMemo(
    () => (detail
      ? detail.episodes.filter(playableHere).map(e => toPlayable(e, detail))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail, toPlayable, downloadedTitle, activeLang],
  )
  const index = Math.max(0, playlist.findIndex(e => e.number === currentNumber))
  const current: PlayableEpisode | undefined = playlist[index]
  const nextEp = playlist[index + 1]
  // Stable: VideoPane's countdown timer restarts whenever this identity changes.
  const nextNumber = nextEp?.number
  const advance = useCallback(
    () => { if (nextNumber !== undefined) setCurrentNumber(nextNumber) },
    [nextNumber],
  )

  // The downloaded copy of the episode on screen, when there is one. Memoised
  // on the path: the hook reads a new source object as a new episode, so a
  // fresh identity every render would restart playback.
  const downloadedPath = playing && current
    ? fileFor(downloadedTitles, seriesName, season, current.number, activeLang)?.path
    : undefined
  const downloadedSource = useMemo(
    () => (downloadedPath
      ? { proxy_url: downloadedFileUrl(downloadedPath), kind: 'mp4' as const, provider: DOWNLOADED_PROVIDER }
      : null),
    [downloadedPath],
  )

  const { providers, status, sources, active, select, markFailed, probing } =
    useProviderSources(
      playing ? (current?.embed_urls ?? NO_EMBEDS) : NO_EMBEDS,
      sourceId,
      // The download ranking decides playback too — one preference, not two.
      playbackOrder(settings.preferred_hosts, detail?.provider_order),
      downloadedSource,
    )
  const source = active ? sources[active] : null

  function setCurrent(ep: EpisodeDetail) {
    setCurrentNumber(ep.number)
    setPosition(0)
  }

  /** Play an episode in another language. The season refetches, so the wanted
   *  episode is remembered and picked up when the new detail lands. */
  function selectEpisodeLang(ep: EpisodeDetail, next: string) {
    if (next === activeLang && playableHere(ep)) { setCurrent(ep); return }
    // Already on disk in the language asked for — play it, don't go looking.
    if (playableIn(ep.number, ep.embed_urls, next)) { setCurrent(ep); setActiveLang(next); return }
    const target = listingWith(next, ep.number)
    if (target && !target.current) {
      switchListing(target, next, ep.number)
      return
    }
    setPendingNumber(ep.number)
    setPosition(0)
    setActiveLang(next)
  }

  /** Flip an episode's watched flag from the playlist. */
  function toggleWatched(ep: EpisodeDetail) {
    if (!detail) return
    setWatched(toPlayable(ep, detail), !watchedNumbers.has(ep.number))
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
    togglePlaylistCollapsed()
  }

  async function handleDownload() {
    if (!detail) return
    const filmFilename = detail.is_film ? sanitizeName(seriesName) + '.mp4' : null

    // Where each episode is taken from: the highest-ranked site that carries it
    // in this language, else the listing on screen. Ranking a site therefore
    // downloads from it without having to open it first.
    const fromRankedSite = (number: number) => {
      for (const id of settings.preferred_sites ?? []) {
        const listing = listings.find(l => l.source === id && l.embeds[number])
        if (listing) {
          return {
            embeds: listing.embeds[number],
            source: listing.source,
            page_url: listing.page_url,
          }
        }
      }
      return null
    }

    const items: DownloadItem[] = detail.episodes
      .filter(ep => checked.has(ep.number))
      .map(ep => {
        const from = fromRankedSite(ep.number)
        const embeds = from?.embeds ?? ep.embed_urls
        return {
          ...pickHost(embeds, settings.preferred_hosts),
          all_providers: embeds,
          episode_name: filmFilename ?? ep.filename,
          series_name: seriesName,
          season: detail.is_film ? 0 : detail.season,
          lang: activeLang,
          source: from?.source ?? sourceId,
          // Kept next to the file so the local library can show a poster and
          // reopen the title; the path itself records neither.
          poster_url: posterUrl,
          page_url: from?.page_url ?? sourceUrl,
        }
      })
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

  const downloadedLangs = useMemo(() => {
    const out: Record<number, string[]> = {}
    for (const e of detail?.episodes ?? []) {
      const langs = langsFor(downloadedTitle, e.number)
      if (langs.length) out[e.number] = langs
    }
    return out
  }, [downloadedTitle, detail])

  // The copy on disk, described for the sources panel. Languages are the ones
  // *this episode* is stored in, so a season you only partly downloaded shows
  // the row struck through on the episodes you never fetched.
  const downloadedRow = downloadedTitle
    ? {
        poster_url: downloadedTitle.poster_url || posterUrl,
        langs: currentNumber === null ? [] : langsFor(downloadedTitle, currentNumber),
        summary: `${downloadedTitle.files.length} ${
          downloadedTitle.files.length === 1 ? 'file' : 'files'
        } · ${fmtSize(downloadedTitle.size)}`,
      }
    : null
  const downloadedActive = active === DOWNLOADED_PROVIDER

  /** Play the copy on disk, switching language first when asked for another.
   *  A language switch refetches the season; the downloaded copy leads the
   *  provider order, so it is picked up again on the other side. */
  const playDownloaded = (nextLang?: string) => {
    if (nextLang && nextLang !== activeLang) { setActiveLang(nextLang); return }
    select(DOWNLOADED_PROVIDER)
  }

  // Streaming again means any host that isn't the file. Null until one has
  // been probed, which disables the control rather than selecting a dead source.
  const streamHost = providers.find(p => p !== DOWNLOADED_PROVIDER && sources[p]) ?? null

  const sourceControl = (
    <SourcesPanel
      listings={listings}
      episodeNumber={currentNumber}
      langs={allLangs}
      activeLang={activeLang}
      loading={siteSourcesLoading}
      // The file is its own row now, so it is not also offered as a host.
      currentHosts={providers.filter(p => p !== DOWNLOADED_PROVIDER)}
      hostStatus={status}
      activeHost={active}
      onSelectHost={select}
      onSelectSource={switchListing}
      onSelectLang={selectLang}
      downloaded={downloadedRow}
      downloadedActive={downloadedActive}
      onPlayDownloaded={playDownloaded}
      onStream={streamHost ? () => select(streamHost) : null}
    />
  )

  const list = detail && (
    <EpisodeList
      episodes={detail.episodes}
      currentNumber={currentNumber}
      checked={checked}
      watchedNumbers={watchedNumbers}
      progress={progress}
      langs={allLangs}
      activeLang={activeLang}
      epLangs={allEpLangs}
      epTitles={allEpTitles}
      downloadedLangs={downloadedLangs}
      isFilm={detail.is_film}
      season={season}
      seasons={showSeasons}
      onSelectSeason={switchSeason}
      // While browsing, picking an episode is the request to start playing it.
      onSelect={playing ? setCurrent : (ep => onRequestPlayback(ep.number))}
      onToggle={toggleEpisode}
      onToggleAll={toggleAll}
      onLang={selectLang}
      onToggleWatched={toggleWatched}
      onSelectEpisodeLang={selectEpisodeLang}
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
      {/* The player lives in a shared, persistent node so it survives navigation
          (mini-player, #20). It's driven from here even while minimised. */}
      {playerNode && (
      <InPortal node={playerNode}>
        {current && (
          <VideoPane
            ep={current}
            source={source}
            probing={probing}
            nextTitle={nextEp?.title ?? null}
            autoplay={autoplay}
            onSourceError={() => { if (active) markFailed(active) }}
            onAdvance={advance}
            onPosition={setPosition}
          />
        )}
      </InPortal>
      )}

      {/* Title bar — pinned to the viewport top on desktop so back / save
          controls stay reachable while scrolling. */}
      <div className="flex items-center gap-3 lg:sticky lg:top-0 lg:z-30 lg:bg-base-100 lg:py-2">
        <button
          // Real history back, so a search (with its query and filters in the
          // URL) is restored exactly; fall back to search on a deep link.
          onClick={() => { if (history.length > 1) history.back(); else navigate('search') }}
          aria-label="Back"
          className="btn btn-ghost btn-sm btn-square"
        >
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
              series: seriesName,
              season,
              label: seriesName,
              poster_url: posterUrl,
              page_url: sourceUrl,
              lang: activeLang,
              source: sourceId,
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

      {/* A dead or empty listing is exactly when switching site matters most,
          and the row under the player is not rendered then — so surface the
          source on its own here. */}
      {(error || (detail && detail.episodes.length === 0)) && sourceControl}

      {detail && detail.episodes.length > 0 && (
        <div className="lg:flex lg:gap-4 lg:items-start">
          {/* Desktop playlist column — collapsible */}
          <aside
            className={`hidden lg:flex lg:flex-col rounded-box border border-base-300 bg-base-200 overflow-hidden transition-[width] ${
              collapsed ? 'lg:w-12' : 'lg:w-80'
            } lg:h-[calc(100dvh-12rem)] lg:sticky lg:top-16 shrink-0`}
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
            {/* TMDB metadata above the player, on every breakpoint. Renders
                nothing without a key or a match, so the layout is unchanged
                then. Its own bottom border separates it from the player. */}
            <TitleHeader meta={meta} navigate={navigate} />

            {/* Sticky on mobile so the list scrolls under it; static on desktop.
                The browser always plays the browsed episode; casting to a TV is
                a separate, non-disruptive action (see OutputSwitcher). */}
            <div className="sticky top-14 z-20 -mx-4 px-4 py-2 bg-base-100 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent">
              <div className="aspect-video rounded-box overflow-hidden bg-base-200">
                {/* Only claim the shared video node while visible; when minimised
                    the mini-player owns it. */}
                {visible && (pipWindow && current ? (
                  // The player is in the floating window; this spot must not
                  // offer to start playback, which would look like a restart.
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-base-content/60 text-sm">
                    <span>Playing in picture-in-picture</span>
                    <button className="btn btn-sm" onClick={closePiP}>Bring it back</button>
                  </div>
                ) : playerNode && current ? (
                  <OutPortal node={playerNode} morph />
                ) : current ? (
                  // Browsing only: nothing has been claimed or started, so the
                  // poster stands in for the player until playback is asked for.
                  <button
                    onClick={() => onRequestPlayback(current.number)}
                    className="group relative w-full h-full flex items-center justify-center"
                    aria-label={`Play ${current.title}`}
                  >
                    {posterUrl && (
                      <img
                        src={posterUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-30 blur-[1px]"
                      />
                    )}
                    <span className="relative flex flex-col items-center gap-2 text-base-content/70 group-hover:text-base-content transition-colors">
                      <svg className="w-14 h-14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span className="text-sm">Play</span>
                    </span>
                  </button>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-base-content/40 text-sm">
                    Select an episode to start
                  </div>
                ))}
              </div>

              {/* Document PiP, not the browser's element PiP: it carries the
                  caption overlay and controls into the floating window, which
                  element PiP drops. Chromium-only, so hidden elsewhere.
                  Sits directly under the player, on the side the eye already
                  returns to, rather than tucked in a corner. */}
              {/* Both are "where does this play" choices, so they share a row —
                  and they sit inside the sticky container so they stay reachable
                  while the episode list scrolls. */}
              {playing && current && (
                <div className="pt-2 flex items-start gap-2 flex-wrap">
                  {!pipWindow && isDocumentPiPSupported() && (
                    <button
                      className="btn btn-sm btn-primary gap-2"
                      onClick={() => { void openDocumentPiP() }}
                      title="Play in a floating window that stays on top"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19 11h-8v6h8v-6zm4 8V4.98A2 2 0 0 0 21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 .02H3V4.97h18v14.05z" />
                      </svg>
                      Pop out
                    </button>
                  )}
                  <OutputSwitcher
                    episodes={playlist}
                    index={index}
                    source={source}
                    autoplay={autoplay}
                    handoffAt={position}
                    onSourceFailed={() => { if (active) markFailed(active) }}
                  />
                </div>
              )}
            </div>

            {/* Where the video comes from: the site first, then the hosts that
                site offers — left to right, site → host, which is also the order
                in which a failure is worth investigating. Output moved up into
                the sticky row beside the player. */}
            <div className="flex flex-col gap-3">
              {/* Hosts used to live on their own row; they are per-source, so
                  they belong on the source's row in the panel above. */}
              {sourceControl}
              <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
                {playing && current && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-base-content/70 ml-auto">
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        checked={autoplay}
                        onChange={e => setAutoplay(e.target.checked)}
                      />
                      Autoplay next
                    </label>
                  </>
                )}
              </div>
            </div>

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
                {tab === 'download' && downloadBar}
              </div>
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
          siteOptions={listings.map(l => ({ id: l.source, label: l.label }))}
          preferredSites={settings.preferred_sites}
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
