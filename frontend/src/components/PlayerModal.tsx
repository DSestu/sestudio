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

interface Props {
  episodes: PlayableEpisode[]
  startIndex: number
  onClose: () => void
}

/** Persist progress at most every SAVE_INTERVAL ms of playback. */
const SAVE_INTERVAL = 5000

export default function PlayerModal({ episodes, startIndex, onClose }: Props) {
  useModalBack(true, onClose)
  const [index, setIndex] = useState(startIndex)
  const [autoplay, setAutoplay] = useState(true)
  const playerRef = useRef<MediaPlayerInstance>(null)
  const lastSaveRef = useRef(0)
  // Position to restore once the (persistent) player can play the new source.
  const resumeToRef = useRef<number | null>(null)
  const [resumedFrom, setResumedFrom] = useState<number | null>(null)

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

  // Per-episode setup: open the playback session and arm the resume position.
  useEffect(() => {
    startPlayback(ep, 'browser')
    const saved = getProgress(ep)
    const resumable = saved && !saved.watched && saved.duration > 0
      && saved.position < saved.duration * 0.95 ? saved.position : null
    resumeToRef.current = resumable
    setResumedFrom(resumable)
    lastSaveRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep])

  // Close the session when the modal goes away.
  useEffect(() => () => endPlayback('browser'), [])

  function handleCanPlay() {
    const target = resumeToRef.current
    if (target !== null && playerRef.current) {
      resumeToRef.current = null
      playerRef.current.currentTime = target
    }
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
    if (autoplay && hasNext) setIndex(i => i + 1)
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
              onEnded={handleEnded}
              onError={() => { if (active) markFailed(active) }}
            >
              <MediaProvider />
              <DefaultVideoLayout icons={defaultLayoutIcons} />
            </MediaPlayer>
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
    </ResponsiveModal>
  )
}
