import { useEffect, useRef } from 'react'
import { clockSkew, getQueue, positionNow, useMusicQueue, type Analysis, type TrackInfo } from '../../musicQueue'
import { keyDisplay } from '../../harmony'
import { useSummary } from '../../musicMeta'
import { useTheory } from '../../musicTheory'
import { engine, useSyncStatus } from './engine'
import { fmtBpm } from './format'
import { normBar0 } from './timeline/sampling'

/** A dot that flashes on every beat of the playing track, bigger on the downbeat. */
function BeatDot({ bpm, bar0, duration }: { bpm: number; bar0: number; duration: number }) {
  const dot = useRef<HTMLSpanElement>(null)
  const playing = useMusicQueue().playing
  useEffect(() => {
    let id = 0
    const frame = () => {
      // Paused: one frame to dim it, then nothing moves.
      if (playing) id = requestAnimationFrame(frame)
      const q = getQueue()
      const ph = (positionNow(q, clockSkew(), Date.now(), duration || Infinity) - engine.lag - bar0) / (60 / bpm)
      const fr = ph - Math.floor(ph)
      const on = q.playing
      const flash = Math.pow(1 - fr, 3)
      const down = ((Math.floor(ph) % 4) + 4) % 4 === 0
      const el = dot.current
      if (!el) return
      el.style.opacity = on ? String(0.25 + 0.75 * flash) : '.3'
      el.style.transform = `scale(${on && down ? 1 + 0.6 * flash : 1})`
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [bpm, bar0, duration, playing])
  return <span ref={dot} aria-hidden="true" className="size-2 rounded-full bg-current shrink-0" />
}

/** Artist line (with the tempo and a dot that beats at it) over the big title. */
export default function Title({ info, analysis }: { info?: TrackInfo; analysis: Analysis | null }) {
  const bpm = analysis?.bpm
  const sync = useSyncStatus()
  const summary = useSummary(info?.id)
  const key = keyDisplay(useTheory(), summary)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[15px] text-base-content/60">
        <span className="truncate">{[info?.artist || 'Unknown artist', info?.album].filter(Boolean).join(' · ')}</span>
        {bpm && (
          // A beat sync shows both tempos, in amber while it locks and Signal Blue once it has.
          <span className={`shrink-0 inline-flex items-center gap-1.5 tabular-nums ${sync ? (sync.locked ? 'text-primary' : 'text-[oklch(80%_.12_75)]') : ''}`}>
            {/* key: a new track restarts the loop on its own grid */}
            <BeatDot key={info?.id} bpm={bpm} bar0={normBar0(bpm, analysis?.bar0)} duration={info?.duration ?? 0} />
            {sync ? `${fmtBpm(sync.from)} → ${fmtBpm(sync.to)}` : `${fmtBpm(bpm * engine.rate)} BPM`}
          </span>
        )}
        {key && <span className="shrink-0 tabular-nums" style={{ color: key.color }}>{key.text}</span>}
      </div>
      <h2 className="mt-1 truncate font-bold leading-[.95] tracking-[-.04em] text-[clamp(2.25rem,8vw,6rem)] short:text-[32px] pb-1">
        {info?.title ?? ''}
      </h2>
    </div>
  )
}
