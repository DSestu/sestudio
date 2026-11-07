import { useEffect, useRef, useState } from 'react'
import { useBarsHidden } from '../../barsHidden'
import { useCastState } from '../../cast'
import { useDlnaState } from '../../dlnaControl'
import { keyDisplay } from '../../harmony'
import { useSummary } from '../../musicMeta'
import { useTheory } from '../../musicTheory'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { usePhoneStrip } from '../../phoneStrip'
import BarAura from './BarAura'
import { DEFAULT_HUE, fmtBpm } from './format'
import SendToTv from './SendToTv'
import { dragPlayer, openPlayer, primePlayer, releasePlayer, unprimePlayer, stopFromBar, togglePlay, useBarMemory, useLayerCovered, usePosition } from './player'
import { speed } from './presence'

/** The strip shown while music plays, joined onto the phone dock like the video mini-player: opens the player. */
export default function PlayerBar({ onMusicPage }: { onMusicPage: boolean }) {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  const item = q.items[q.current]
  const track = item && info(item.track_id)
  const analysis = useAnalysis(item?.track_id)
  const sum = useSummary(item?.track_id)
  const key = keyDisplay(useTheory(), sum)
  const position = usePosition(q, track?.duration ?? 0)
  // A drag up from the bar: the player's card follows the thumb (SPEC-music-player-motion §4).
  const drag = useRef<{ y: number; top: number; on: boolean; samples: [number, number][] } | null>(null)
  // The click a touch may fire after a drag must not open the player again; the next press clears it.
  const dragged = useRef(false)
  const covered = useLayerCovered()
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
  // A drag up from the bar (touch, mouse or pen): the player's card follows, its top edge on the pointer (SPEC-music-player-motion §4).
  const start = (y: number, onButton: boolean) => {
    drag.current = { y, top: self.current!.getBoundingClientRect().top, on: false, samples: [] }
    // Not from a button: a press on Play or Stop must not mount the player.
    if (!onButton) primePlayer()
  }
  const move = (y: number, at: number) => {
    const d = drag.current
    if (!d) return
    if (!d.on) {
      if (Math.abs(y - d.y) < 8) return
      if (y > d.y) { drag.current = null; return }
      d.on = true
    }
    d.samples.push([at, y])
    dragPlayer((d.y - y) / d.top)
  }
  const end = (y: number | null, at: number) => {
    const d = drag.current
    drag.current = null
    if (!d?.on) { if (y === null) releasePlayer(0, 0); else unprimePlayer(); return }
    dragged.current = true
    releasePlayer(y === null ? 0 : speed(d.samples, at), y === null ? 0 : y - d.y)
  }

  return (
    <>
      <div
        ref={self}
        role="button"
        tabIndex={0}
        aria-label="Open the player"
        onPointerDown={e => {
          dragged.current = false
          // Mouse and pen: a drag up from the bar grows the player under the pointer, as a thumb does on a phone.
          // Not from a button: capturing the pointer would take the button's click.
          if (e.pointerType === 'touch' || e.button !== 0 || (e.target as Element).closest('button')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          start(e.clientY, false)
        }}
        onPointerMove={e => { if (e.pointerType !== 'touch') move(e.clientY, e.timeStamp) }}
        onPointerUp={e => { if (e.pointerType !== 'touch') end(e.clientY, e.timeStamp) }}
        onPointerCancel={e => { if (e.pointerType !== 'touch') end(null, 0) }}
        onClick={() => { if (!dragged.current) openPlayer() }}
        onKeyDown={e => { if (e.key === 'Enter') openPlayer() }}
        // Touch: drag the bar up and the player grows under the thumb, its top edge on the finger.
        onTouchStart={e => start(e.touches[0].clientY, (e.target as Element).closest('button') !== null)}
        onTouchMove={e => move(e.touches[0].clientY, e.timeStamp)}
        onTouchEnd={e => end(e.changedTouches[0].clientY, e.timeStamp)}
        onTouchCancel={() => end(null, 0)}
        // Phone: sits on the dock's top edge as one glass object with it, under it in
        // stacking so it rises out from behind; drops into the dock's place while the dock is away.
        className={`fixed glass h-16 flex items-center gap-3 px-3 cursor-pointer select-none touch-none md:z-40 md:rounded-2xl md:left-1/2 md:-translate-x-1/2 md:w-[min(36rem,calc(100vw-9rem))] md:bottom-[calc(1rem+var(--lift))] max-md:z-[39] max-md:inset-x-3 max-md:bottom-(--dock-top) max-md:pl-2.5 max-md:transition-[translate,border-radius] max-md:duration-300 max-md:ease-out max-md:animate-dock-rise motion-reduce:transition-none motion-reduce:animate-none ${
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
            {key && <span style={{ color: key.color }}> · {key.text}</span>}
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
      {!covered && <BarAura bar={self} q={q} duration={track?.duration ?? 0} />}
    </>
  )
}
