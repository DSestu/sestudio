import { useEffect, useRef } from 'react'
import { useAnalysis, useMusicQueue, useTrackInfo, type QueueState, type TrackInfo } from '../../musicQueue'
import { DEFAULT_HUE, sky } from './format'
import { closePlayer, usePosition } from './player'
import Background from './background/Background'
import { useLook } from './background/settings'
import Queue from './Queue'
import type { PaletteName } from './timeline/palette'
import { tlook } from './timeline/render'
import Timeline from './timeline/Timeline'
import Title from './Title'
import Transport from './Transport'

/** The strip along the bottom; the canvas itself covers the whole layer, behind everything. */
function TimelineSlot({ q, info, palette }: { q: QueueState; info: (id: string) => TrackInfo | undefined; palette: PaletteName }) {
  return (
    <div data-slot="timeline" className="flex-1 min-h-16 md:flex-none md:absolute md:inset-x-0 md:bottom-0 md:h-[34vh]">
      <Timeline q={q} info={info} palette={palette} />
    </div>
  )
}

/** The full-screen player, over the whole app (rail and dock included). `tv` is the station's picture: no controls, no sound, no cursor. */
export default function Layer({ tv = false }: { tv?: boolean }) {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  const item = q.items[q.current]
  const track = item && info(item.track_id)
  const analysis = useAnalysis(item?.track_id)
  const position = usePosition(q, track?.duration ?? 0)
  const touch = useRef<number | null>(null)
  const look = useLook()
  useEffect(() => { Object.assign(tlook, look.tl) }, [look.tl])

  useEffect(() => {
    if (tv) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlayer()
      else if (e.key === ' ' && !(e.target as HTMLElement).closest('button, [role=slider], [role=button], input')) {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-play]')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tv])

  return (
    <div
      role="dialog"
      aria-label="Music player"
      className={`fixed inset-0 z-70 flex flex-col md:block overflow-hidden text-base-content ${tv ? 'cursor-none select-none' : ''}`}
      style={{ background: sky(analysis?.hue ?? DEFAULT_HUE) }}
      // Swipe down closes it on a phone, except from inside the queue (which scrolls).
      onTouchStart={e => { touch.current = (e.target as HTMLElement).closest('[data-queue]') ? null : e.touches[0].clientY }}
      onTouchEnd={e => {
        if (touch.current !== null && e.changedTouches[0].clientY - touch.current > 90) closePlayer()
        touch.current = null
      }}
    >
      <Background />
      {!tv && <button
        aria-label="Close the player"
        onClick={closePlayer}
        className="absolute left-3.5 top-3.5 md:left-8 md:top-4.5 z-10 size-10 rounded-xl glass grid place-items-center"
      >
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>}
      <div className="pt-19 px-5.5 md:pt-29.5 md:pl-34 md:pr-96 min-w-0">
        <Title info={track} analysis={analysis} position={position} />
      </div>
      <TimelineSlot q={q} info={info} palette={look.tlPal} />
      <div className="px-3.5 pt-3.5 md:absolute md:left-34 md:top-62.5 md:p-0">
        <Transport q={q} position={position} duration={track?.duration ?? 0} tv={tv} />
      </div>
      <div className="p-3 h-[34dvh] shrink-0 md:absolute md:p-0 md:top-18 md:right-5 md:w-87.5 md:h-107.5">
        <Queue q={q} info={info} tv={tv} />
      </div>
    </div>
  )
}
