import { useEffect, useRef, useState } from 'react'
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import type { StreamSource } from '../../api'
import type { PlayableEpisode } from '../../providers'
import { getProgress, saveProgress, setWatched, watchKey } from '../../watchState'
import { endBrowserPlayback, sameEpisode, startBrowserPlayback, updateBrowserPlayback, useCastSession } from '../../playbackSession'
import { setBrowserPlayerControls } from '../../browserPlayerControls'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'
import { applySubtitleStyle } from '../../subtitleStyle'
import { usePiPWindow } from '../../pipSession'

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
export default function VideoPane({
  ep, source, probing, nextTitle, autoplay, onSourceError, onAdvance, onPosition,
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
  useEffect(() => {
    setBrowserPlayerControls({
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
    })
  }, [paused])
  useEffect(() => () => setBrowserPlayerControls(null), [])

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

  function handleTimeUpdate() {
    const p = playerRef.current
    if (!p) return
    updateBrowserPlayback(p.currentTime, p.duration)
    onPosition(p.currentTime)
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
          className="w-full h-full"
          title={ep.title}
          src={{
            src: displaySource.proxy_url,
            type: displaySource.kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
          }}
          autoPlay={!castedSameEp}
          playsInline
          // Shortcuts (k/space, f, m, c for captions, arrows to seek) default to
          // firing only once the player itself has focus. On `document` they work
          // straight after page load; with two players mounted vidstack routes
          // input to the most recently active one, so the mini-player is safe.
          keyTarget="document"
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
          onError={onSourceError}
        >
          <MediaProvider>
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
      {!displaySource && probing && (
        <div className="flex items-center gap-3 text-white/60">
          <span className="loading loading-spinner loading-lg" /> Testing sources…
        </div>
      )}
      {!displaySource && !probing && !source && (
        <p className="text-error text-sm px-6 text-center">No playable source for this episode.</p>
      )}
      {displaySource && !probing && !source && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-center px-6">
          <p className="text-error text-sm">This episode has no working source. Pick another below.</p>
        </div>
      )}
    </div>
  )
}
