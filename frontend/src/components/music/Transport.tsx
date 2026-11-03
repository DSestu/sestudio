import { useRef, useState } from 'react'
import { queueActions, type QueueState } from '../../musicQueue'
import { engine } from './engine'
import { fmtTime } from './format'
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
  const seekTo = (s: number) => {
    const t = Math.max(0, Math.min(duration, s))
    engine.seek(t)
    void queueActions.transport('seek', { position: t })
  }
  return (
    <div className="flex items-center gap-3 text-xs text-base-content/45 tabular-nums">
      <span className="w-9 text-right">{fmtTime(shown)}</span>
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
        }}
        onPointerMove={e => {
          if (scrub === null) return
          setScrub(at(e))
          engine.seek(at(e))
        }}
        onPointerUp={e => {
          if (scrub !== null) seekTo(at(e))
          setScrub(null)
        }}
        onPointerCancel={() => setScrub(null)}
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
      <span className="w-9">{fmtTime(duration)}</span>
    </div>
  )
}

const stepBtn = 'size-12 rounded-xl bg-white/6 grid place-items-center hover:bg-white/10 disabled:opacity-40'

/** Seek row and transport (SPEC-music-player §5.6). The cast button and the "Playing on" strip sit with it. */
export default function Transport({ q, position, duration, tv = false }: { q: QueueState; position: number; duration: number; tv?: boolean }) {
  const idle = q.current < 0
  if (tv) return <div className="w-105"><Seek position={position} duration={duration} readOnly /></div>
  return (
    <div className="flex flex-col gap-3 w-full md:w-105">
      <Seek position={position} duration={duration} />
      <div className="flex items-center justify-center gap-3.5">
        <button className={stepBtn} aria-label="Previous" disabled={idle} onClick={() => void queueActions.transport('prev')}>
          <svg className="size-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9.5 12z" /></svg>
        </button>
        <button
          className="size-16 rounded-[22px] bg-primary text-primary-content grid place-items-center disabled:opacity-40"
          aria-label={q.playing ? 'Pause' : 'Play'}
          data-play
          disabled={idle}
          onClick={() => togglePlay(q.playing, position)}
        >
          {q.playing ? (
            <svg className="size-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg className="size-7" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button className={stepBtn} aria-label="Next" disabled={idle} onClick={() => void queueActions.transport('next')}>
          <svg className="size-6" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z" /></svg>
        </button>
        <SendToTv />
      </div>
      <CastStrip />
    </div>
  )
}
