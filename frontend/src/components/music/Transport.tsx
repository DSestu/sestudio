import { useRef, useState } from 'react'
import { queueActions, type QueueState } from '../../musicQueue'
import { engine } from './engine'
import { fmtTime } from './format'
import { wake } from './idle'
import { bar as hold } from './scrub'
import { togglePlay } from './player'
import CastStrip from './CastStrip'
import SendToTv from './SendToTv'

const SEEK_KEYS: Record<string, number> = { ArrowRight: 5, ArrowLeft: -5, PageUp: 30, PageDown: -30 }

function Seek({ position, duration, readOnly = false }: { position: number; duration: number; readOnly?: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  // While dragging the bar shows (and the sound follows) the pointer, not the server.
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? position
  const at = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
  }
  // The timeline follows the drag too (scrub.ts `bar`, held here).
  const follow = (s: number) => {
    hold.pos = s
    hold.t0 = 0
    wake()
  }
  const seekTo = (s: number) => {
    const t = Math.max(0, Math.min(duration, s))
    hold.pos = t
    hold.t0 = performance.now()
    engine.seek(t)
    void queueActions.transport('seek', { position: t })
  }
  return (
    <div className="flex items-center gap-3 text-xs text-base-content/45 tabular-nums">
      <span>{fmtTime(shown)}</span>
      {readOnly ? (
        <div className="flex-1 h-1 rounded-full bg-white/16">
          <div className="h-full rounded-full bg-primary" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
        </div>
      ) : (
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${fmtTime(shown)} of ${fmtTime(duration)}`}
        className="group relative flex-1 h-5 flex items-center cursor-pointer touch-none"
        onPointerDown={e => {
          if (!duration) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrub(at(e))
          engine.seek(at(e))
          follow(at(e))
        }}
        onPointerMove={e => {
          if (scrub === null) return
          setScrub(at(e))
          engine.seek(at(e))
          follow(at(e))
        }}
        onPointerUp={e => {
          if (scrub !== null) seekTo(at(e))
          setScrub(null)
        }}
        onPointerCancel={() => {
          hold.pos = null
          wake()
          setScrub(null)
        }}
        onKeyDown={e => {
          const d = SEEK_KEYS[e.key]
          if (d === undefined) return
          e.preventDefault()
          seekTo(position + d)
        }}
      >
        <div className={`w-full rounded-full bg-white/16 transition-[height] ${scrub !== null ? 'h-1.5' : 'h-1 group-hover:h-1.5'}`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${duration ? (shown / duration) * 100 : 0}%` }} />
        </div>
        <span
          className={`absolute size-3.5 -ml-[7px] rounded-full bg-primary shadow transition-opacity ${scrub !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ left: `${duration ? (shown / duration) * 100 : 0}%` }}
        />
        {scrub !== null && (
          <span
            className="absolute -top-6 -translate-x-1/2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-base-content"
            style={{ left: `${(scrub / duration) * 100}%` }}
          >
            {fmtTime(scrub)}
          </span>
        )}
      </div>
      )}
      <span>{fmtTime(duration)}</span>
    </div>
  )
}

const stepBtn = 'size-12 short:size-10 rounded-xl bg-white/6 grid place-items-center hover:bg-white/10 disabled:opacity-40'

/** Seek row and transport (SPEC-music-player §5.6). The cast button and the "Playing on" strip sit with it.
 * On a phone on its side it is one row: previous, play, next, the seek bar, cast; the "Playing on" strip floats above it. */
export default function Transport({ q, position, duration, tv = false }: { q: QueueState; position: number; duration: number; tv?: boolean }) {
  const idle = q.current < 0
  if (tv) return <div className="w-105"><Seek position={position} duration={duration} readOnly /></div>
  return (
    <div className="relative flex flex-col gap-3 w-full short:flex-row short:items-center short:gap-2.5">
      <div className="short:order-1 short:flex-1 short:min-w-0 short:mx-1.5">
        <Seek position={position} duration={duration} />
      </div>
      <div className="flex items-center justify-center gap-3.5 short:contents">
        <button className={stepBtn} aria-label="Previous" disabled={idle} onClick={() => void queueActions.transport('prev')}>
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6v12l-9-6zM6 6v12" /></svg>
        </button>
        <button
          className="size-16 short:size-12 rounded-[22px] short:rounded-2xl bg-primary text-primary-content grid place-items-center disabled:opacity-40"
          aria-label={q.playing ? 'Pause' : 'Play'}
          data-play
          disabled={idle}
          onClick={() => togglePlay(q.playing, position)}
        >
          {q.playing ? (
            <svg className="size-7" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          ) : (
            <svg className="size-7" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button className={stepBtn} aria-label="Next" disabled={idle} onClick={() => void queueActions.transport('next')}>
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6v12l9-6zM18 6v12" /></svg>
        </button>
        <div className="short:order-2">
          <SendToTv className="size-12 short:size-10 rounded-xl bg-white/6 hover:bg-white/10" />
        </div>
      </div>
      <div className="short:absolute short:bottom-full short:inset-x-0 short:mb-2">
        <CastStrip />
      </div>
    </div>
  )
}
