import { useEffect } from 'react'
import { useCastState } from '../../cast'
import { useDlnaState } from '../../dlnaControl'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { DEFAULT_HUE, fmtBpm } from './format'
import { openPlayer, togglePlay, usePosition } from './player'

/** The strip that stays on every page while a track is current: opens the player. */
export default function PlayerBar() {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  const item = q.items[q.current]
  const track = item && info(item.track_id)
  const analysis = useAnalysis(item?.track_id)
  const position = usePosition(q, track?.duration ?? 0)
  // Above the Now-Casting bar when a cast is up; the page's bottom padding clears both (AppShell reads --music-bar).
  const castUp = useCastState().connected
  const dlnaUp = useDlnaState().connected
  const casting = castUp || dlnaUp
  const shown = !!item
  useEffect(() => {
    if (!shown) return
    document.documentElement.style.setProperty('--music-bar', '4.5rem')
    return () => { document.documentElement.style.removeProperty('--music-bar') }
  }, [shown])
  if (!item) return null
  const hue = analysis?.hue ?? DEFAULT_HUE
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open the player"
      onClick={openPlayer}
      onKeyDown={e => { if (e.key === 'Enter') openPlayer() }}
      className="fixed z-40 glass rounded-2xl h-16 flex items-center gap-3 px-3 cursor-pointer inset-x-3 bottom-[calc(var(--dock-clear)+0.5rem+var(--lift))] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[min(36rem,calc(100vw-9rem))] md:bottom-[calc(1rem+var(--lift))]"
      style={{ '--lift': casting ? '4.5rem' : '0rem' } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className="size-10 shrink-0 rounded-lg grid place-items-center"
        style={{ background: `oklch(24% .05 ${hue})`, color: `oklch(76% .14 ${hue})` }}
      >
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
      </span>
      <div className="flex-1 min-w-0">
        <b className="block truncate text-sm font-medium">{track?.title ?? '…'}</b>
        <span className="block truncate text-xs text-base-content/60">
          {track?.artist}
          {analysis?.bpm && <span className="tabular-nums"> · {fmtBpm(analysis.bpm)} BPM</span>}
        </span>
      </div>
      <button
        aria-label={q.playing ? 'Pause' : 'Play'}
        className="size-10 rounded-xl bg-primary text-primary-content grid place-items-center"
        onClick={e => { e.stopPropagation(); togglePlay(q.playing, position) }}
      >
        {q.playing ? (
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        ) : (
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <button aria-label="Expand the player" className="size-10 rounded-xl grid place-items-center hover:bg-white/8" onClick={e => { e.stopPropagation(); openPlayer() }}>
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
      </button>
    </div>
  )
}
