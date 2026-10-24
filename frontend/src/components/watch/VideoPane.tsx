import { useEffect, useRef, useState } from 'react'
import {
  isHLSProvider, MediaPlayer, MediaProvider, Track, type MediaPlayerInstance, type VideoQuality,
} from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { castLive, mediaPlayhead, type StreamSource } from '../../api'
import { useMediaOptions } from '../../useMediaOptions'
import { setBrowserAiShown, useBrowserAiShown, useBrowserFps, useBrowserQuality } from '../../browserFps'
import { ladderUrlOf, withFps } from '../../frameRates'
import type { PlayableEpisode } from '../../providers'
import { getProgress, saveProgress, setWatched, watchKey } from '../../watchState'
import { endBrowserPlayback, sameEpisode, startBrowserPlayback, updateBrowserPlayback, useCastSession } from '../../playbackSession'
import { setBrowserPlayerControls } from '../../browserPlayerControls'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'
import { applySubtitleStyle } from '../../subtitleStyle'
import { usePiPWindow } from '../../pipSession'
import BufferingInfo, { bufferedAhead } from './BufferingInfo'

/** Persist progress at most every SAVE_INTERVAL ms of playback. */
const SAVE_INTERVAL = 5000

/** Saved position worth resuming from, or null (unwatched and not near the end). */
function resumePointFor(ep: PlayableEpisode): number | null {
  const saved = getProgress(ep)
  return saved && !saved.watched && saved.duration > 0 && saved.position < saved.duration * 0.95
    ? saved.position
    : null
}

interface Props {
  ep: PlayableEpisode
  source: StreamSource | null
  probing: boolean
  /** Why there is no source *yet*, when the wait is expected (a copy being
   *  rebuilt on the server) rather than a search that came up empty. */
  pending?: string | null
  /** Title of the episode queued after this one, if any. */
  nextTitle: string | null
  autoplay: boolean
  onSourceError: () => void
  onAdvance: () => void
  /** Report the live position outward (for cast handoff). */
  onPosition: (seconds: number) => void
}

/**
 * In-browser playback surface. The player element is never unmounted between
 * episodes — its `src` is swapped only once the next source is ready, so an
 * autoplay transition preserves fullscreen (the browser won't let us re-enter
 * fullscreen without a user gesture on `ended`).
 */
/** Play the rendition of *qualities* at *height*, or the closest below it (the
 *  lightest if none is). Setting `selected` switches without a request event. */
function pickQuality(qualities: readonly VideoQuality[], height: number): void {
  if (!qualities.length) return
  const fits = qualities.filter(q => q.height <= height)
  const pick = fits.length
    ? fits.reduce((a, b) => (b.height > a.height ? b : a))
    : qualities.reduce((a, b) => (b.height < a.height ? b : a))
  if (!pick.selected) pick.selected = true
}

/** Drop what hls.js buffered past the next segment and fetch it again: the
 *  same level (or Auto again) asked for, which it takes as a switch. */
function refetchAhead(player: MediaPlayerInstance | null): void {
  const provider = player?.provider
  if (!isHLSProvider(provider) || !provider.instance) return
  const hls = provider.instance
  hls.nextLevel = hls.autoLevelEnabled ? -1 : hls.currentLevel
}

/** How many seconds hls.js reads ahead, changed as it plays. */
function setReadAhead(player: MediaPlayerInstance | null, seconds: number): void {
  const provider = player?.provider
  if (isHLSProvider(provider) && provider.instance) provider.instance.config.maxBufferLength = seconds
}

export default function VideoPane({
  ep, source, probing, pending = null, nextTitle, autoplay, onSourceError, onAdvance, onPosition,
}: Props) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const lastSaveRef = useRef(0)
  // `resumeTo` is the pending resume seek, applied once the source can play.
  // State (not a ref) so it can be re-armed during render when the episode changes.
  const [resumeTo, setResumeTo] = useState<number | null>(() => resumePointFor(ep))
  // Auto-next countdown (seconds remaining); null when not counting.
  const [nextIn, setNextIn] = useState<number | null>(null)

  const [displaySource, setDisplaySource] = useState<StreamSource | null>(null)
  if (source && source !== displaySource) setDisplaySource(source)

  // Frame rate: only the server's own playlists (a stored file, or a provider's
  // stream it re-encodes) can be sent at another one. Their options say which
  // rates this source and machine allow; the saved pick applies when allowed,
  // and is tried before they are known rather than loading twice.
  const ladderUrl = ladderUrlOf(displaySource)
  const known = useMediaOptions(ladderUrl ?? undefined, ladderUrl !== null)
  const fps = useBrowserFps()
  const playingFps = !fps || !known || known.frame_rates.includes(fps) ? fps : 0
  // The rate a video loads at. A change while it plays goes to the server under
  // the video's own `live` id, as a cast's does, and the player fetches again
  // what it had buffered past the next segment: no reload, no jump.
  // At the source's own quality and frame rate, the video untouched — the
  // host's stream, or the file — when there is such a thing: nothing to encode.
  // Anything else, AI frames on the source's quality included, is the server's
  // re-encoding; moving between the two reloads the player where it was.
  const quality = useBrowserQuality()
  const direct = displaySource?.direct
  const untouched = Boolean(direct) && quality === undefined && !playingFps
  const [loaded, setLoaded] = useState(() => ({
    url: ladderUrl, untouched, fps: playingFps, live: crypto.randomUUID(),
  }))
  if (loaded.url !== ladderUrl || loaded.untouched !== untouched) {
    setLoaded({ url: ladderUrl, untouched, fps: playingFps, live: crypto.randomUUID() })
  }
  const mediaUrl = !displaySource ? ''
    : untouched && direct ? direct.url
      : ladderUrl ? `${withFps(ladderUrl, loaded.fps)}&live=${loaded.live}`
        : displaySource.proxy_url
  const mediaKind = untouched && direct ? direct.kind : displaySource?.kind
  const sentFps = useRef<Record<string, number>>({})
  useEffect(() => {
    if (!loaded.url || loaded.untouched) return
    if (playingFps === (sentFps.current[loaded.live] ?? loaded.fps)) return
    sentFps.current[loaded.live] = playingFps
    castLive(loaded.live, 0, playingFps).then(() => refetchAhead(playerRef.current)).catch(() => {})
  }, [loaded, playingFps])

  // Whether AI frames are on screen, from the frames the video decodes a
  // second: the server sends the source's rate until the drawn ones are ready.
  const sourceFps = known?.fps ?? 0

  // While AI frames are asked for, say where it plays every few seconds: the
  // server draws from just past there. It answers how far ahead it has them
  // drawn, which is how far the player reads ahead — never so far that it
  // asks for segments not drawn yet and is sent the source's rate — and
  // whether to swap: fetch again what it buffered at the source's rate, so
  // AI frames show from the next segment rather than after that plays out.
  // Swapped once until they show: a refetch empties the buffer past the next
  // segment, and asked twice it would empty it again before it refilled.
  const aiShown = useBrowserAiShown()
  const drawing = Boolean(ladderUrl && sourceFps && playingFps > sourceFps)
  useEffect(() => {
    if (!drawing || !ladderUrl) return
    let live = true
    let swapped = false
    const tell = async () => {
      const p = playerRef.current
      if (!p || p.paused) return
      const { swap, ready } = await mediaPlayhead(ladderUrl, p.currentTime)
      if (!live) return
      setReadAhead(p, Math.min(30, Math.max(8, ready - 6)))
      if (swap && !swapped && !aiShown) {
        swapped = true
        refetchAhead(p)
      }
    }
    const timer = window.setInterval(() => { void tell() }, 2000)
    return () => { live = false; window.clearInterval(timer) }
  }, [drawing, ladderUrl, aiShown])

  // Seconds the player reads ahead: hls.js's own half minute, or little more
  // than a segment to start with while AI frames are asked for — whatever it
  // holds at the source's rate plays before them. The check-in above raises it
  // as far as the server has them drawn.
  const readAhead = sourceFps && playingFps > sourceFps ? 8 : 30
  const readAheadRef = useRef(readAhead)
  useEffect(() => {
    readAheadRef.current = readAhead
    setReadAhead(playerRef.current, readAhead)
  }, [readAhead])

  useEffect(() => {
    setBrowserAiShown(false)
    if (!sourceFps || playingFps <= sourceFps) return
    let last: { frames: number; at: number } | null = null
    const timer = window.setInterval(() => {
      const video = playerRef.current?.el?.querySelector('video')
      if (!video || video.paused || video.seeking) { last = null; return }
      const now = { frames: video.getVideoPlaybackQuality().totalVideoFrames, at: performance.now() }
      if (last && now.at > last.at) {
        const rate = (now.frames - last.frames) / ((now.at - last.at) / 1000)
        setBrowserAiShown(rate > sourceFps * 1.2)
      }
      last = now
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sourceFps, playingFps, loaded.live])

  // Drives the layout choice below: the small (mobile) layout drops the
  // timeline, which is wrong for a popped-out window.
  const pipWindow = usePiPWindow()

  // Open/refresh the playback session for the current episode.
  useEffect(() => { startBrowserPlayback(ep) }, [ep])
  useEffect(() => () => endBrowserPlayback(), [])

  // Hand-off: when the episode shown here is the one now casting to a TV, pause
  // local playback so we don't double up audio. Casting a *different* episode
  // leaves this player running (dual playback — issue #19).
  const castSession = useCastSession()
  const castedSameEp = sameEpisode(castSession?.episode, ep)
  useEffect(() => {
    if (castedSameEp) playerRef.current?.pause()
  }, [castedSameEp])

  // Expose play/pause + paused state to out-of-view surfaces (the mini-player).
  const [paused, setPaused] = useState(true)
  const [qualities, setQualities] = useState<number[]>([])
  useEffect(() => {
    setBrowserPlayerControls({
      qualities,
      isPaused: paused,
      playPause: () => {
        const p = playerRef.current
        if (!p) return
        if (p.paused) void p.play(); else p.pause()
      },
      resumeAt: (seconds: number) => {
        const p = playerRef.current
        if (!p) return
        p.currentTime = seconds
        void p.play()
      },
      position: () => playerRef.current?.currentTime ?? 0,
      bufferedAhead: () => {
        const p = playerRef.current
        return p ? bufferedAhead(p.state.buffered, p.state.currentTime) : 0
      },
      height: () => playerRef.current?.state.quality?.height ?? 0,
    })
  }, [paused, qualities])
  useEffect(() => () => setBrowserPlayerControls(null), [])

  // A quality picked while it plays: Auto, or the rendition closest below.
  useEffect(() => {
    const p = playerRef.current
    if (!p || p.qualities.length < 2) return
    if (quality === 0) p.qualities.autoSelect()
    else pickQuality(p.qualities.toArray(), quality ?? Infinity)
  }, [quality, mediaUrl])

  // Push the saved caption appearance onto :root. vidstack's own Caption Styles
  // menu writes the same variables but only for the session, so without this a
  // tuned setup is lost on reload.
  useEffect(() => { applySubtitleStyle() }, [])

  // Remember the subtitle track the user selects. `mode-change` also fires when
  // a source loads and vidstack applies `preferredLang`, which is harmless — it
  // just rewrites the same value.
  useEffect(() => {
    const tracks = playerRef.current?.textTracks
    if (!tracks) return
    const onModeChange = () => {
      savePlayerPrefs({ subtitleLang: tracks.selected?.language ?? null })
    }
    tracks.addEventListener('mode-change', onModeChange)
    return () => tracks.removeEventListener('mode-change', onModeChange)
  }, [])

  // Re-arm the resume position when the episode changes. Done during render
  // (not in an effect) so it lands in the same pass as the episode switch.
  // Keyed on episode identity, not object identity: a re-render of the parent
  // can hand us an equal-but-new object, and disarming on that would cancel a
  // running auto-next countdown.
  const epKey = watchKey(ep.series_name, ep.season, ep.number)
  const [armedEp, setArmedEp] = useState(epKey)
  if (armedEp !== epKey) {
    setArmedEp(epKey)
    setResumeTo(resumePointFor(ep))
    setNextIn(null)
  }

  // A new source for the *same* episode — another audio track, a fallback to a
  // different host, the untouched stream for the re-encoded one or back —
  // reloads the media, and a reload starts at zero: it resumes where it played,
  // or failing that where progress was last saved. Skipped on the first
  // source, which the initial state already armed.
  const srcKey = mediaUrl
  const [armedSrc, setArmedSrc] = useState(srcKey)
  const [heldAt, setHeldAt] = useState<{ key: string; at: number } | null>(null)
  if (armedSrc !== srcKey) {
    setArmedSrc(srcKey)
    if (armedSrc && srcKey) {
      setResumeTo(heldAt?.key === epKey ? heldAt.at : resumePointFor(ep))
    }
  }

  // Pending retry of a refused autoplay; cleared on unmount so a torn-down
  // player never starts playing into nothing.
  const retryRef = useRef(0)
  useEffect(() => () => window.clearTimeout(retryRef.current), [])

  /** Ask for playback again after vidstack's own attempt was refused.
   *
   *  It asks the moment the player reports it can play. For a source the server
   *  transcodes as it goes, that lands before the first segment has been
   *  encoded: the request is refused for want of data, and nothing repeats it,
   *  so a player that becomes ready half a second later sits there paused.
   *
   *  Guarded on `started`, which is false only while nothing has played yet —
   *  so this can never restart something the viewer paused by hand. */
  function handleAutoPlayFail() {
    let tries = 0
    const retry = () => {
      const p = playerRef.current
      if (!p || castedSameEp || p.state.started || !p.paused || tries++ >= 5) return
      p.play().catch(() => { retryRef.current = window.setTimeout(retry, 500) })
    }
    retryRef.current = window.setTimeout(retry, 400)
  }

  // Tick the auto-next countdown; the advance happens in the timer callback.
  useEffect(() => {
    if (nextIn === null) return
    const t = window.setTimeout(() => {
      if (nextIn <= 1) { setNextIn(null); onAdvance() }
      else setNextIn(nextIn - 1)
    }, 1000)
    return () => window.clearTimeout(t)
  }, [nextIn, onAdvance])

  function handleCanPlay() {
    const p = playerRef.current
    if (!p) return
    // Restore persisted preferences on every (re)loaded source.
    const prefs = loadPlayerPrefs()
    p.volume = prefs.volume
    p.muted = prefs.muted
    p.playbackRate = prefs.rate
    // vidstack matches `preferredLang` against the track languages itself, so
    // this re-selects the chosen subtitles on each new source. Left alone when
    // the user has never picked, so the host's own `default` track still wins.
    if (prefs.subtitleLang !== undefined) {
      p.textTracks.preferredLang = prefs.subtitleLang
    }
    // A freshly loaded source restarts the save throttle.
    lastSaveRef.current = 0
    if (resumeTo !== null) {
      setResumeTo(null)
      p.currentTime = resumeTo
    }
  }

  /** Re-selects the remembered quality whenever a source lists its own.
   *  Setting `selected` switches the rendition without a request event, so
   *  this never reads back as the user picking. */
  function handleQualitiesChange(list: VideoQuality[]) {
    setQualities([...new Set(list.map(q => q.height))].sort((a, b) => b - a))
    const wanted = loadPlayerPrefs().quality
    // The source's own picture unless Auto (0) was picked: its best rendition.
    if (wanted !== 0 && list.length > 1) pickQuality(list, wanted ?? Infinity)
  }

  function handleTimeUpdate() {
    const p = playerRef.current
    if (!p) return
    updateBrowserPlayback(p.currentTime, p.duration)
    onPosition(p.currentTime)
    // Held to the second, for a reload of this episode (see `armedSrc`).
    const second = Math.floor(p.currentTime)
    if (second > 0 && (heldAt?.key !== epKey || heldAt.at !== second)) {
      setHeldAt({ key: epKey, at: second })
    }
    const now = Date.now()
    if (now - lastSaveRef.current >= SAVE_INTERVAL) {
      lastSaveRef.current = now
      saveProgress(ep, p.currentTime, p.duration)
    }
  }

  function handleEnded() {
    setWatched(ep, true)
    if (autoplay && nextTitle) setNextIn(5)
  }

  return (
    <div className="relative bg-black w-full h-full flex items-center justify-center overflow-hidden">
      {displaySource && (
        <MediaPlayer
          ref={playerRef}
          onProviderChange={provider => {
            if (isHLSProvider(provider)) {
              provider.config = { ...provider.config, maxBufferLength: readAheadRef.current }
            }
          }}
          className="w-full h-full"
          title={ep.title}
          src={{
            src: mediaUrl,
            type: mediaKind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
          }}
          autoPlay={!castedSameEp}
          playsInline
          // Shortcuts (k/space, f, m, c for captions, arrows to seek) default to
          // firing only once the player itself has focus. On `document` they work
          // straight after page load; with two players mounted vidstack routes
          // input to the most recently active one, so the mini-player is safe.
          keyTarget="document"
          onQualitiesChange={handleQualitiesChange}
          onCanPlay={handleCanPlay}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={handleTimeUpdate}
          onVolumeChange={() => {
            const p = playerRef.current
            if (p) savePlayerPrefs({ volume: p.volume, muted: p.muted })
          }}
          onRateChange={() => {
            const p = playerRef.current
            if (p) savePlayerPrefs({ rate: p.playbackRate })
          }}
          onEnded={handleEnded}
          onAutoPlayFail={handleAutoPlayFail}
          onError={onSourceError}
        >
          {/* Keyed on the source kind: vidstack's React outlet renders one
              <video> for both HLS and plain MP4 and only wires a provider to it
              when the element mounts. Swapping HLS→MP4 in place (a streamed
              host claims the screen, then the copy on disk wins the probe)
              tears down hls.js and never creates the MP4 provider — the player
              sits on a spinner for ever. Remounting the outlet, not the whole
              player, keeps fullscreen across the swap. */}
          <MediaProvider key={displaySource.kind}>
            {/* Sidecar subtitles. Keyed by URL so swapping episodes replaces the
                tracks rather than reusing the previous episode's cues. */}
            {(displaySource.subtitles ?? []).map((sub) => (
              <Track
                key={sub.proxy_url}
                src={sub.proxy_url}
                kind="subtitles"
                label={sub.label}
                language={sub.lang}
                default={sub.default}
                type="vtt"
              />
            ))}
          </MediaProvider>
          {/* In the PiP window the large layout is forced. The default picks
              the small (mobile) layout below a width breakpoint, and a 480px
              PiP window falls under it — that layout drops the timeline and
              most controls, leaving only a centre play button. */}
          <DefaultVideoLayout
            icons={defaultLayoutIcons}

            smallLayoutWhen={pipWindow ? false : undefined}
          />
          {/* Untouched, nothing is being encoded: what it waits on is the host. */}
          <BufferingInfo
            source={untouched && direct
              ? { ...displaySource, kind: direct.kind, transcode_url: undefined }
              : displaySource}
          />
        </MediaPlayer>
      )}

      {/* Auto-next countdown */}
      {nextIn !== null && nextTitle && (
        <div className="absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-sm text-white/70">Up next</p>
          <p className="font-semibold text-white">{nextTitle}</p>
          <p className="text-3xl font-bold text-white tabular-nums">{nextIn}</p>
          <div className="flex gap-2">
            <button onClick={() => { setNextIn(null); onAdvance() }} className="btn btn-sm btn-primary">Play now</button>
            <button onClick={() => setNextIn(null)} className="btn btn-sm btn-ghost text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Overlays: initial testing / no source / dead source */}
      {!displaySource && (probing || pending) && (
        <div className="flex items-center gap-3 text-white/60 px-6 text-center">
          <span className="loading loading-spinner loading-lg" /> {pending ?? 'Testing sources…'}
        </div>
      )}
      {!displaySource && !probing && !pending && !source && (
        <p className="text-error text-sm px-6 text-center">
          No playable source for this episode.
        </p>
      )}
      {displaySource && !probing && !source && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-center px-6">
          <p className="text-error text-sm">This episode has no working source. Pick another below.</p>
        </div>
      )}
    </div>
  )
}
