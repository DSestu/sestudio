import { useEffect, useRef, useState } from 'react'
import { useBarsHidden } from '../../barsHidden'
import { useCastState } from '../../cast'
import { useDlnaState } from '../../dlnaControl'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { usePhoneStrip } from '../../phoneStrip'
import BarAura from './BarAura'
import { DEFAULT_HUE, fmtBpm } from './format'
import SendToTv from './SendToTv'
import { openPlayer, stopFromBar, togglePlay, useBarMemory, usePosition } from './player'

/** The strip shown while music plays, joined onto the phone dock like the video mini-player: opens the player. */
export default function PlayerBar({ onMusicPage }: { onMusicPage: boolean }) {
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
  const away = useBarsHidden()
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const { heard, stopped } = useBarMemory()
  const self = useRef<HTMLDivElement>(null)
  // On a phone the Now-Casting bar holds the dock's strip slot (it carries the music when that's on the TV).
  const shown = !!item && !stopped && (q.playing || heard || onMusicPage) && (desktop || !casting)
  usePhoneStrip(shown && !desktop)
  useEffect(() => {
    if (!shown) return
    document.documentElement.style.setProperty('--music-bar', '4.5rem')
    return () => { document.documentElement.style.removeProperty('--music-bar') }
  }, [shown])
  if (!shown) return null
  const hue = analysis?.hue ?? DEFAULT_HUE
  return (
    <>
      <div
        ref={self}
        role="button"
        tabIndex={0}
        aria-label="Open the player"
        onClick={openPlayer}
        onKeyDown={e => { if (e.key === 'Enter') openPlayer() }}
        // Phone: sits on the dock's top edge as one glass object with it, under it in
        // stacking so it rises out from behind; drops into the dock's place while the dock is away.
        className={`fixed glass h-16 flex items-center gap-3 px-3 cursor-pointer select-none md:z-40 md:rounded-2xl md:left-1/2 md:-translate-x-1/2 md:w-[min(36rem,calc(100vw-9rem))] md:bottom-[calc(1rem+var(--lift))] max-md:z-[39] max-md:inset-x-3 max-md:bottom-(--dock-top) max-md:pl-2.5 max-md:transition-[translate,border-radius] max-md:duration-300 max-md:ease-out max-md:animate-dock-rise motion-reduce:transition-none motion-reduce:animate-none ${
          away ? 'max-md:translate-y-[4.125rem] max-md:rounded-2xl' : 'max-md:translate-y-[calc(-1*var(--discover-lift,0px))] max-md:rounded-t-2xl'
        }`}
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
          className="relative hit size-10 shrink-0 rounded-xl bg-primary text-primary-content grid place-items-center"
          onClick={e => { e.stopPropagation(); togglePlay(q.playing, position) }}
        >
          {q.playing ? (
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <SendToTv className="relative hit size-10 shrink-0 rounded-xl hover:bg-white/8" />
        <button aria-label="Stop" title="Stop" className="relative hit size-10 shrink-0 rounded-xl grid place-items-center text-error hover:bg-white/8" onClick={e => { e.stopPropagation(); stopFromBar(q.playing, position) }}>
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
        </button>
        <button aria-label="Expand the player" className="relative hit size-10 shrink-0 rounded-xl place-items-center hover:bg-white/8 hidden md:grid" onClick={e => { e.stopPropagation(); openPlayer() }}>
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
        </button>
      </div>
      <BarAura bar={self} q={q} duration={track?.duration ?? 0} />
    </>
  )
}
