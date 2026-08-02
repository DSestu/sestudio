import { useEffect, useRef, useState } from 'react'
import { MediaPlayer, MediaProvider, type MediaPlayerInstance } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import type { StreamSource } from '../api'
import ProviderChips from './ProviderChips'
import ResponsiveModal from './ResponsiveModal'
import { useProviderSources } from '../useProviderSources'
import { useModalBack } from '../useModalBack'
import type { PlayableEpisode } from '../providers'
import { getProgress, markWatched, saveProgress } from '../watchState'
import { endPlayback, startPlayback, updatePlayback } from '../playbackSession'
import { loadPlayerPrefs, savePlayerPrefs } from '../playerPrefs'
import CastModal from './CastModal'

interface Props {
  episodes: PlayableEpisode[]
  startIndex: number
  onClose: () => void
}

/** Persist progress at most every SAVE_INTERVAL ms of playback. */
const SAVE_INTERVAL = 5000

/** Saved position worth resuming from, or null (unwatched and not near the end). */
function resumePointFor(ep: PlayableEpisode): number | null {
  const saved = getProgress(ep)
  return saved && !saved.watched && saved.duration > 0 && saved.position < saved.duration * 0.95
    ? saved.position
    : null
}

export default function PlayerModal({ episodes, startIndex, onClose }: Props) {
  useModalBack(true, onClose)
  const [index, setIndex] = useState(startIndex)
  const [autoplay, setAutoplay] = useState(true)
  const playerRef = useRef<MediaPlayerInstance>(null)
  const lastSaveRef = useRef(0)
  // Position to restore once the (persistent) player can play the new source.
  const [resumedFrom, setResumedFrom] = useState<number | null>(() => resumePointFor(episodes[startIndex]))
  const resumeToRef = useRef<number | null>(resumedFrom)
  // Auto-next countdown (seconds remaining); null when not counting.
  const [nextIn, setNextIn] = useState<number | null>(null)
  // Handoff: position captured when the cast picker opens; null = picker closed.
  const [castFromPosition, setCastFromPosition] = useState<number | null>(null)

  const ep = episodes[index]
  const hasNext = index < episodes.length - 1

  const { providers, status, sources, active, select, markFailed, probing } = useProviderSources(ep.embed_urls)
  const activeSource = active ? sources[active] : null

  // The player element is never unmounted between episodes — its `src` is
  // swapped only once the next source is ready. Keeping the same element mounted
  // means an autoplay transition preserves fullscreen (the browser won't let us
  // re-enter fullscreen without a user gesture on `ended`).
  const [displaySource, setDisplaySource] = useState<StreamSource | null>(null)
  if (activeSource && activeSource !== displaySource) setDisplaySource(activeSource)

  // Open/refresh the playback session for the current episode.
  useEffect(() => { startPlayback(ep, 'browser') }, [ep])

  // Re-arm the resume position when the episode changes. Done during render
  // (not in an effect) so it lands in the same pass as the episode switch.
  const [armedEp, setArmedEp] = useState(ep)
  if (armedEp !== ep) {
    setArmedEp(ep)
    const point = resumePointFor(ep)
    resumeToRef.current = point
    setResumedFrom(point)
    setNextIn(null)
    lastSaveRef.current = 0
  }

  // Tick the auto-next countdown; the advance happens in the timer callback.
  useEffect(() => {
    if (nextIn === null) return
    const t = window.setTimeout(() => {
      if (nextIn <= 1) advanceNow()
      else setNextIn(nextIn - 1)
    }, 1000)
    return () => window.clearTimeout(t)
  }, [nextIn])

  function advanceNow() {
    setNextIn(null)
    setIndex(i => i + 1)
  }

  // Close the session when the modal goes away.
  useEffect(() => () => endPlayback('browser'), [])

  function handleCanPlay() {
    const p = playerRef.current
    if (!p) return
    // Restore persisted preferences on every (re)loaded source.
    const prefs = loadPlayerPrefs()
    p.volume = prefs.volume
    p.muted = prefs.muted
    p.playbackRate = prefs.rate
    const target = resumeToRef.current
    if (target !== null) {
      resumeToRef.current = null
      p.currentTime = target
    }
  }

  function handleVolumeChange() {
    const p = playerRef.current
    if (p) savePlayerPrefs({ volume: p.volume, muted: p.muted })
  }

  function handleRateChange() {
    const p = playerRef.current
    if (p) savePlayerPrefs({ rate: p.playbackRate })
  }

  function handleTimeUpdate() {
    const p = playerRef.current
    if (!p) return
    updatePlayback(p.currentTime, p.duration)
    const now = Date.now()
    if (now - lastSaveRef.current >= SAVE_INTERVAL) {
      lastSaveRef.current = now
      saveProgress(ep, p.currentTime, p.duration)
    }
  }

  function startOver() {
    resumeToRef.current = null
    setResumedFrom(null)
    if (playerRef.current) playerRef.current.currentTime = 0
  }

  function handleEnded() {
    markWatched(ep)
    if (autoplay && hasNext) setNextIn(5)
  }

  /** Handoff: pause here, remember the position, open the cast target picker. */
  function openCastPicker() {
    const p = playerRef.current
    p?.pause()
    setCastFromPosition(p?.currentTime ?? 0)
  }

  if (!ep) return null

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-4xl p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-base-300">
          <h2 className="font-semibold text-base truncate">{ep.title}</h2>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-base-content/70" title="Play the next episode automatically">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={autoplay}
                onChange={e => setAutoplay(e.target.checked)}
              />
              Autoplay
            </label>
            <button
              onClick={openCastPicker}
              title="Cast to TV from here"
              aria-label="Cast to TV from here"
              className="btn btn-ghost btn-square sm:btn-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01" />
              </svg>
            </button>
            <button
              onClick={() => setIndex(i => i + 1)}
              disabled={!hasNext}
              title="Next episode"
              className="btn btn-ghost btn-square sm:btn-sm"
              aria-label="Next episode"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5v14l8-7zM16 5h2v14h-2z" /></svg>
            </button>
            <button onClick={onClose} className="btn btn-circle btn-ghost sm:btn-sm" aria-label="Close">✕</button>
          </div>
        </div>

        {/* Providers */}
        <div className="px-6 py-3 border-b border-base-300">
          <ProviderChips providers={providers} active={active} status={status} onSelect={select} />
        </div>

        {/* Video — persistent element, src swapped per episode */}
        <div className="relative bg-black aspect-video flex items-center justify-center">
          {displaySource && (
            <MediaPlayer
              ref={playerRef}
              className="w-full h-full"
              title={ep.title}
              src={{
                src: displaySource.proxy_url,
                type: displaySource.kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
              }}
              autoPlay
              playsInline
              onCanPlay={handleCanPlay}
              onTimeUpdate={handleTimeUpdate}
              onVolumeChange={handleVolumeChange}
              onRateChange={handleRateChange}
              onEnded={handleEnded}
              onError={() => { if (active) markFailed(active) }}
            >
              <MediaProvider />
              <DefaultVideoLayout icons={defaultLayoutIcons} />
            </MediaPlayer>
          )}

          {/* Auto-next countdown */}
          {nextIn !== null && hasNext && (
            <div className="absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-sm text-white/70">Up next</p>
              <p className="font-semibold text-white">{episodes[index + 1].title}</p>
              <p className="text-3xl font-bold text-white tabular-nums">{nextIn}</p>
              <div className="flex gap-2">
                <button onClick={advanceNow} className="btn btn-sm btn-primary">Play now</button>
                <button onClick={() => setNextIn(null)} className="btn btn-sm btn-ghost text-white">Cancel</button>
              </div>
            </div>
          )}

          {/* Resumed indicator — lets the user restart from the beginning. */}
          {displaySource && resumedFrom !== null && (
            <button
              onClick={startOver}
              className="absolute top-3 right-3 z-10 btn btn-sm bg-black/70 border-none text-white hover:bg-black/90"
            >
              ↺ Start over
            </button>
          )}

          {/* Overlays: initial testing / no source / next-episode failure */}
          {!displaySource && probing && (
            <div className="flex items-center gap-3 text-base-content/50">
              <span className="loading loading-spinner loading-lg" /> Testing sources…
            </div>
          )}
          {!displaySource && !probing && !activeSource && (
            <p className="text-error text-sm px-6 text-center">No playable source for this episode.</p>
          )}
          {displaySource && !probing && !activeSource && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-center px-6">
              <p className="text-error text-sm">This episode has no working source. Pick another above{hasNext ? ' or skip ▶▶' : ''}.</p>
            </div>
          )}
        </div>

        {/* Handoff target picker — casting closes this player, the floating
            cast pill takes over as the session's controller. */}
        {castFromPosition !== null && (
          <CastModal
            episodes={episodes}
            startIndex={index}
            resumeAt={castFromPosition}
            onCastStarted={onClose}
            onClose={() => setCastFromPosition(null)}
          />
        )}
    </ResponsiveModal>
  )
}
