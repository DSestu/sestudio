import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { togglePlaylistCollapsed, usePlaylistCollapsed } from '../playlistCollapsed'
import type {
  AppSettings, DownloadDestination, DownloadItem, EpisodeDetail, SeasonDetail,
} from '../api'
import type { DownloadedTrack, StreamSubtitle } from '../api'
import {
  checkDownloads, DOWNLOADED_SOURCE, downloadedFileUrl, downloadedHlsUrl,
  downloadedTracks, postDownloads,
} from '../api'
import ConfirmDownloadModal from '../components/ConfirmDownloadModal'
import { pickHost } from '../downloadPrefs'
import EmptyState from '../components/EmptyState'
import SaveToggles from '../components/SaveToggles'
import WatchToggle from '../components/WatchToggle'
import TitleHeader from '../components/season/TitleHeader'
import EpisodeList from '../components/watch/EpisodeList'
import OutputSwitcher from '../components/watch/OutputSwitcher'
import BrowserFrameRate from '../components/watch/BrowserFrameRate'
import BrowserPerformance from '../components/watch/BrowserPerformance'
import BrowserQuality from '../components/watch/BrowserQuality'
import SourcesPanel from '../components/watch/SourcesPanel'
import VideoPane from '../components/watch/VideoPane'
import { listingKey, useAlternateSources } from '../useAlternateSources'
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
import { DOWNLOADED_PROVIDER, orderProviders, playbackOrder, type PlayableEpisode } from '../providers'
import { useProviderSources } from '../useProviderSources'
import {
  fileFor, fmtSize, langsFor, sanitizeName, titleFor, useDownloadedLibrary,
} from '../downloadedLibrary'
import { useBrowserPlayerControls } from '../browserPlayerControls'
import { useTmdb } from '../useTmdb'
import { setWatched, useWatchState, watchKey } from '../watchState'

/** Stable reference — useProviderSources resets on embedUrls identity change. */
const NO_EMBEDS: Record<string, string> = {}

/** Stable reference for the same reason: the local source is memoised on its
 *  subtitle list, and a fresh [] each render would restart playback. */
const NO_SUBTITLES: StreamSubtitle[] = []
const NO_AUDIO: DownloadedTrack[] = []

// The phone's version of the desktop queue and now-playing line: one job per
// tab. Details is not among them: the TMDB metadata sits below the player.
const MOBILE_TABS = ['episodes', 'sources', 'output'] as const
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
  /** The sources panel under the now-playing line (desktop). */
  const [sourcesOpen, setSourcesOpen] = useState(false)
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
    Object.keys(embeds).length > 0 || langsFor(downloadedTitle, number, lang).includes(lang)
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

  // The open site could not serve the title at all (senpai's ad gate, a dead
  // mirror) and nothing it came with could either: move to the best-ranked
  // other site whose listing loaded, rather than stop on an error.
  const fallbackIds = error && !detail
    ? listings.filter(l => !l.current && !l.failed && Object.keys(l.embeds).length).map(l => l.source)
    : []
  const fallbackTo = orderProviders(fallbackIds, settings.preferred_sites)[0]
  useEffect(() => {
    const next = listings.find(l => l.source === fallbackTo && !l.current)
    if (next) switchListing(next)
    // Once per site found: `listings` changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackTo])

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
    const seen = new Set<string>([listingKey(next.source, next.page_url)])
    for (const alt of carried) {
      const key = listingKey(alt.src, alt.url)
      if (!alt.url || seen.has(key)) continue
      seen.add(key)
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
  // Captions for the copy on disk. A stored file's subtitles are either muxed
  // into it or sitting beside it as `.vtt`, and neither reaches a `<video>` by
  // itself — the server lists both and serves them as WebVTT, which is the one
  // thing a `<track>` element can load. Keyed on the path, so switching episode
  // drops the previous episode's cues instead of showing them over the new one.
  // Stored with the path they belong to, so a stale answer for the previous
  // episode is never read as this one's — and so the reset on switching happens
  // during render rather than in the effect, which would cost an extra pass.
  const [subs, setSubs] = useState<{
    path?: string; list: StreamSubtitle[]; audio: DownloadedTrack[]; playable?: boolean
  }>({ list: NO_SUBTITLES, audio: NO_AUDIO })
  useEffect(() => {
    if (!downloadedPath) return
    let live = true
    downloadedTracks(downloadedPath).then(tracks => {
      if (!live) return
      setSubs({
        path: downloadedPath,
        audio: tracks.audio,
        playable: tracks.playable,
        list: tracks.subtitles
          // A picture-based track has no text to show; it is reported so the
          // reason is knowable, and skipped so the menu holds nothing dead.
          .filter(t => t.text && t.url)
          .map(t => ({
            proxy_url: t.url as string,
            lang: t.lang,
            label: t.label,
            default: t.default,
          })),
      })
    })
    return () => { live = false }
  }, [downloadedPath])
  const fresh = subs.path === downloadedPath
  const downloadedSubs = fresh ? subs.list : NO_SUBTITLES
  const downloadedAudio = fresh ? subs.audio : NO_AUDIO

  // Which audio track to play; 0 (the file's own first) until asked otherwise.
  // Reset per file, because track 2 of one episode has nothing to do with track
  // 2 of the next — and a stale index would silently play the wrong language.
  const [audioIndex, setAudioIndex] = useState(0)
  const [audioFor, setAudioFor] = useState(downloadedPath)
  if (audioFor !== downloadedPath) { setAudioFor(downloadedPath); setAudioIndex(0) }
  // Guards against an index left over from a file that had more tracks.
  const audioTrack = audioIndex < downloadedAudio.length ? audioIndex : 0

  const downloadedSource = useMemo(
    // Held until the tracks are known, so the audio track to encode is.
    // Always HLS, even for a file the browser could open as it is: the server's
    // playlist carries every quality from the source down, which is what lets
    // the player drop to a lighter one on a slow link. The wanted audio track is
    // encoded into the segments, so switching costs only a new playlist.
    () => (downloadedPath && fresh
      ? {
        proxy_url: downloadedHlsUrl(downloadedPath, audioTrack),
        kind: 'hls' as const,
        // A TV cannot follow HLS; it gets the file, and the server re-encodes
        // it on the way if the TV would not play it. Track 0 untouched: a copy
        // of it would re-encode audio the TV plays.
        dlna_url: downloadedFileUrl(downloadedPath, audioTrack || undefined),
        provider: DOWNLOADED_PROVIDER,
        subtitles: downloadedSubs,
        // The file itself at the source's quality, when a browser plays it as
        // it is — its first voice only: another needs a copy built around it.
        direct: subs.playable && audioTrack === 0
          ? { url: downloadedFileUrl(downloadedPath), kind: 'mp4' as const }
          : undefined,
      }
      : null),
    [downloadedPath, fresh, audioTrack, downloadedSubs, subs.playable],
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
  // The copy on disk is being read (tracks, then the decode check). On a drive
  // that spun down this takes many seconds, which a bare spinner reads as a hang.
  const openingNotice = downloadedPath && (!fresh || status[DOWNLOADED_PROVIDER] === 'loading')
    ? 'Waking the disk and starting the transcode — a sleeping drive can take up to 30 s…'
    : null

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
      const langs = langsFor(downloadedTitle, e.number, activeLang)
      if (langs.length) out[e.number] = langs
    }
    return out
  }, [downloadedTitle, detail, activeLang])

  // The copy on disk, described for the sources panel. Languages are the ones
  // *this episode* is stored in, so a season you only partly downloaded shows
  // the row struck through on the episodes you never fetched.
  const downloadedRow = downloadedTitle
    ? {
        poster_url: downloadedTitle.poster_url || posterUrl,
        langs: currentNumber === null ? [] : langsFor(downloadedTitle, currentNumber, activeLang),
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

  // Desktop only: the queue folds to a strip for a wider player. It sits in
  // the list header, so the queue spends one row on chrome, not two.
  const collapseButton = (
    <button
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand playlist' : 'Collapse playlist'}
      title={collapsed ? 'Expand playlist' : 'Collapse playlist'}
      className="hidden lg:inline-flex btn btn-ghost btn-xs btn-square"
    >
      <svg className={`w-4 h-4 ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
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
      headerAction={collapseButton}
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

  // Below desktop the player docks instead of staying whole: it scrolls with
  // the page until only its bottom third (seek bar, time, fullscreen) is left
  // under the top bar, and the part leaving the screen dims as it goes. Both
  // follow the measured player, so the dock holds at any width and zoom.
  const playerBox = useRef<HTMLDivElement>(null)
  const [dock, setDock] = useState({ top: 0, progress: 0 })
  const hasEpisodes = Boolean(detail?.episodes.length)
  useEffect(() => {
    const wide = matchMedia('(min-width: 64rem)')
    // From md the sidebar layout's search bar (4rem) is what sits on top.
    const tablet = matchMedia('(min-width: 48rem)')
    let frame = 0
    const measure = () => {
      frame = 0
      const box = playerBox.current
      if (!box || wide.matches) {
        setDock(d => (d.top || d.progress ? { top: 0, progress: 0 } : d))
        return
      }
      const bar = tablet.matches ? 64 : 56
      const { top, height } = box.getBoundingClientRect()
      const travel = (height * 2) / 3
      const progress = travel ? Math.min(Math.max(bar - top, 0), travel) / travel : 0
      // 8px is the wrapper's top padding, which docks above the bar too.
      const next = { top: Math.round(bar - 8 - travel), progress }
      setDock(d => (d.top === next.top && Math.abs(d.progress - progress) < 0.01 ? d : next))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    schedule()
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    wide.addEventListener('change', schedule)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
      wide.removeEventListener('change', schedule)
    }
  }, [hasEpisodes])
  const docked = dock.progress > 0.98
  const controls = useBrowserPlayerControls()

  // The version playing, said in one line: language, site, host. On desktop it
  // is the switch that opens the sources panel; a failed source opens the panel
  // by itself, since that is exactly when switching matters.
  const currentListing = listings.find(l => l.current)
  const versionLabel = [
    activeLang.toUpperCase(),
    downloadedActive ? 'On disk' : (currentListing?.label ?? sourceId),
    !downloadedActive && active ? active : null,
  ].filter(Boolean) as string[]
  const sourceFailed = playing && !probing && !source
  const sourcesShown = sourcesOpen || sourceFailed
  // Phone: the same moment opens the Sources tab, so a dead player is never
  // left without the way out on screen.
  // Adjusted during render, as the audio track is above, rather than in an effect.
  const [failedSeen, setFailedSeen] = useState(false)
  if (sourceFailed !== failedSeen) {
    setFailedSeen(sourceFailed)
    if (sourceFailed && !matchMedia('(min-width: 64rem)').matches) setTab('sources')
  }

  const episodeLabel = current && !detail?.is_film
    ? `E${String(current.number).padStart(2, '0')} · ${current.title}`
    : seriesName

  // Phone: the language as a chip; the Sources tab does the rest.
  const langChip = (
    <span className="badge badge-sm badge-primary font-bold shrink-0">{activeLang.toUpperCase()}</span>
  )

  const autoplayToggle = (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-base-content/70">
      <input
        type="checkbox"
        className="toggle toggle-primary toggle-sm"
        checked={autoplay}
        onChange={e => setAutoplay(e.target.checked)}
      />
      Autoplay next
    </label>
  )

  // Audio tracks, for the copy on disk. Only shown when the file actually has a
  // choice to make, and only while it is the thing playing — a streamed host
  // serves one track and has nothing to switch between. The server builds the
  // chosen track (no browser can pick one), so the first use of a track pauses
  // briefly and later ones are instant.
  const audioPicker = active === DOWNLOADED_PROVIDER && downloadedAudio.length > 1 && (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">Audio</span>
      <select
        className="select select-sm select-bordered"
        value={audioTrack}
        onChange={e => setAudioIndex(Number(e.target.value))}
      >
        {downloadedAudio.map(track => (
          <option key={track.index} value={track.index}>
            {track.label}
          </option>
        ))}
      </select>
    </label>
  )

  // Document PiP, not the browser's element PiP: it carries the caption overlay
  // and controls into the floating window, which element PiP drops.
  // Chromium-only, so hidden elsewhere.
  const popOut = !pipWindow && isDocumentPiPSupported() && (
    <button
      className="btn btn-sm btn-ghost gap-2"
      onClick={() => { void openDocumentPiP() }}
      title="Play in a floating window that stays on top"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 11h-8v6h8v-6zm4 8V4.98A2 2 0 0 0 21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 .02H3V4.97h18v14.05z" />
      </svg>
      Pop out
    </button>
  )

  const quality = <BrowserQuality source={source} />
  const frameRate = <BrowserFrameRate source={source} settings={settings} onUpdateSettings={onUpdateSettings} />

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
            pending={openingNotice}
            nextTitle={nextEp?.title ?? null}
            autoplay={autoplay}
            onSourceError={() => { if (active) markFailed(active) }}
            onAdvance={advance}
            onPosition={setPosition}
          />
        )}
      </InPortal>
      )}

      {/* Title bar. On desktop the search bar above it is the pinned one. */}
      <div className="flex items-center gap-3">
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
          <h2 className="font-semibold text-lg tracking-tight truncate">{seriesName}</h2>
          <p className="text-base-content/50 text-xs truncate">
            {[
              detail && (detail.is_film ? 'Film' : `Season ${detail.season}`),
              meta?.year,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {detail && (
          <div className="flex items-center gap-2">
            {/* Labelled, not an icon: between the star and the heart a bare bell
                read as decoration and nobody found it. */}
            <WatchToggle
              pageUrl={sourceUrl}
              source={sourceId}
              seriesName={seriesName}
              posterUrl={posterUrl}
              isFilm={Boolean(detail.is_film)}
              variant="button"
            />
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
          </div>
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
          and the player layout below is not rendered then — so surface the
          source on its own here. With episodes on screen it already has a
          place in that layout, and a copy here would push the player down. */}
      {(error || detail) && !detail?.episodes.length && sourceControl}

      {detail && detail.episodes.length > 0 && (
        <div
          className={`flex flex-col gap-4 lg:grid lg:items-start lg:gap-5 ${
            collapsed ? 'lg:grid-cols-[minmax(0,1fr)_3rem]' : 'lg:grid-cols-[minmax(0,1fr)_24rem]'
          }`}
        >
          {/* Now playing: the player first, then one line saying what plays and
              where it goes. */}
          <div className="min-w-0 flex flex-col gap-3">
            {/* Below desktop it docks with its bottom third showing (see dock
                above); static on desktop. The browser always plays the browsed
                episode; casting to a TV is a separate, non-disruptive action
                (see OutputSwitcher). */}
            <div
              className="sticky top-14 z-20 -mx-4 px-4 py-2 bg-base-100 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent"
              style={dock.top ? { top: dock.top } : undefined}
            >
              {/* As it docks the picture dims, through the video alone so the
                  controls and captions stay sharp; docked, the control row's
                  title gives its place to the play button below. */}
              <div
                ref={playerBox}
                className={`relative aspect-video rounded-box overflow-hidden bg-base-200 [&_video]:[filter:brightness(var(--dock-dim,1))] ${
                  docked ? '[&_.vds-chapter-title]:invisible' : ''
                }`}
                style={{ '--dock-dim': 1 - 0.65 * dock.progress } as CSSProperties}
              >
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
                    {(meta?.backdrop_url || posterUrl) && (
                      <img
                        src={meta?.backdrop_url || posterUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-40"
                      />
                    )}
                    <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-primary text-primary-content transition-transform group-hover:scale-105">
                      <svg className="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-base-content/40 text-sm">
                    Select an episode to start
                  </div>
                ))}
                {docked && (
                  <>
                    {/* Tapping the dimmed picture brings the whole player back. */}
                    <button
                      type="button"
                      onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}
                      aria-label="Show the whole player"
                      className="lg:hidden absolute inset-x-0 top-0 h-[72%] z-10 flex items-end justify-center pb-1"
                    >
                      <span aria-hidden="true" className="w-10 h-1 rounded-full bg-base-content/50" />
                    </button>
                    {/* The phone player's own play button sits mid-picture,
                        which the dock cuts off; this one stands in for it. */}
                    {playing && controls && (
                      <button
                        type="button"
                        onClick={controls.playPause}
                        aria-label={controls.isPaused ? 'Play' : 'Pause'}
                        className="lg:hidden absolute left-1/2 -translate-x-1/2 top-[calc(66.7%+0.5rem)] z-10 btn btn-circle btn-sm bg-base-100/80 border-0"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          {controls.isPaused
                            ? <path d="M8 5v14l11-7z" />
                            : <path d="M6 5h4v14H6zM14 5h4v14h-4z" />}
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* The now-playing line: episode, the version playing, the output. */}
            <div className="flex flex-col gap-3">
              <div className={`items-center gap-x-3 gap-y-2 flex-wrap ${playing && current ? 'hidden lg:flex' : 'flex'}`}>
                <h3 className="font-semibold tracking-tight text-base lg:text-lg min-w-0 truncate max-w-full">
                  {episodeLabel}
                </h3>
                <span className="lg:hidden">{langChip}</span>
                {/* Desktop: the version as one switch over the sources panel. */}
                <button
                  type="button"
                  onClick={() => setSourcesOpen(o => !o)}
                  aria-expanded={sourcesShown}
                  aria-controls="watch-sources"
                  title="Change language, site or host"
                  className="hidden lg:inline-flex items-center gap-0.5 h-8 rounded-full border border-base-300 bg-base-200 p-0.5 text-sm hover:border-base-content/30 transition-colors"
                >
                  <span className="px-2.5 h-full grid place-items-center rounded-full bg-primary text-primary-content font-bold">
                    {versionLabel[0]}
                  </span>
                  <span className="px-2 text-base-content/75">{versionLabel.slice(1).join(' · ')}</span>
                  <svg
                    className={`w-4 h-4 mr-1.5 text-base-content/50 transition-transform ${sourcesShown ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Where the video goes. Send to TV stays on every breakpoint; the
                  finer controls sit here on desktop and in the Output tab on a
                  phone. */}
              {playing && current && (
                <div className="flex items-start gap-2 flex-wrap">
                  <OutputSwitcher
                    episodes={playlist}
                    index={index}
                    source={source}
                    autoplay={autoplay}
                    handoffAt={position}
                  >
                    {/* Phone: the episode title sits on the Send to TV row, ahead
                        of the button, so casting is never a scroll away. */}
                    <div className="lg:hidden order-first flex-1 min-w-0 flex items-center gap-2">
                      <h3 className="font-semibold tracking-tight min-w-0 truncate">{episodeLabel}</h3>
                      {langChip}
                    </div>
                    {/* Desktop: one toolbar. Where it goes, then how it plays,
                        then Autoplay at the end; the AI settings fold below. */}
                    <div className="hidden lg:contents [&>details]:order-last">
                      {popOut}
                      <span aria-hidden="true" className="w-px h-5 bg-base-300 mx-1" />
                      {quality}
                      {frameRate}
                      {audioPicker}
                      <div className="ml-auto">{autoplayToggle}</div>
                    </div>
                  </OutputSwitcher>
                </div>
              )}

              {/* Desktop: the sources panel opens in place under the line rather
                  than over the video, so what follows moves down instead of
                  being covered. */}
              {sourcesShown && (
                <div id="watch-sources" className="hidden lg:block">{sourceControl}</div>
              )}
              {playing && current && (
                <div className="hidden lg:block"><BrowserPerformance source={source} /></div>
              )}
            </div>

            {/* About the title: right under the controls, on every breakpoint.
                Renders nothing without a TMDB key or a match. */}
            <div className="order-last mt-5"><TitleHeader meta={meta} navigate={navigate} /></div>

            {/* Phone: everything the desktop shows alongside, one tab at a time. */}
            <div className="lg:hidden">
              <div role="tablist" className="tabs tabs-box w-full">
                {MOBILE_TABS.map(t => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`tab flex-1 capitalize ${tab === t ? 'tab-active' : ''}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                {tab === 'episodes' && (
                  // Bounded to the space between the pinned player and the tab
                  // bar, so the list scrolls inside itself, opens on the episode
                  // playing, and keeps the download bar in reach.
                  <div className="h-[calc(100dvh-9.5rem-(100vw-2rem)*9/16-env(safe-area-inset-bottom))] min-h-72 flex flex-col rounded-box border border-base-300 bg-base-200 overflow-hidden">
                    <div className="flex-1 min-h-0">{list}</div>
                    {downloadBar}
                  </div>
                )}
                {tab === 'sources' && sourceControl}
                {tab === 'output' && (
                  playing && current ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {quality}
                        {frameRate}
                        {audioPicker}
                      </div>
                      {autoplayToggle}
                      <BrowserPerformance source={source} />
                    </div>
                  ) : (
                    <p className="text-sm text-base-content/60">Start an episode to pick the quality and frame rate.</p>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Desktop queue: opens on the episode playing, with what comes next
              below it. Collapsible to a strip for a wider player. */}
          <aside
            className={`hidden lg:flex lg:flex-col rounded-box border border-base-300 bg-base-200 overflow-hidden lg:sticky lg:top-16 lg:h-[calc(100dvh-5.5rem)]`}
          >
            {collapsed ? (
              <>
              <div className="flex justify-center py-2 border-b border-base-300">{collapseButton}</div>
              <button
                onClick={toggleCollapsed}
                className="flex-1 flex items-start justify-center pt-3 text-base-content/50 hover:text-base-content"
                aria-label="Expand playlist"
              >
                <span className="[writing-mode:vertical-rl] text-xs tracking-wide">
                  {detail.episodes.length} episodes
                </span>
              </button>
              </>
            ) : (
              <>
                <div className="flex-1 min-h-0">{list}</div>
                {downloadBar}
              </>
            )}
          </aside>

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
