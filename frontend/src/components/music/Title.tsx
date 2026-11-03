import type { Analysis, TrackInfo } from '../../musicQueue'
import { fmtBpm } from './format'

/** Artist line (with the tempo and a dot that beats at it) over the big title. */
export default function Title({ info, analysis, position }: { info?: TrackInfo; analysis: Analysis | null; position: number }) {
  const bpm = analysis?.bpm
  const beat = bpm ? 60 / bpm : 0
  // Phase the dot on the beat grid so it flashes with the track.
  const delay = bpm ? -(((position - (analysis?.beat0 ?? 0)) % beat) + beat) % beat : 0
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[15px] text-base-content/60">
        <span className="truncate">{info?.artist || 'Unknown artist'}</span>
        {bpm && (
          <>
            <span className="shrink-0 tabular-nums">{fmtBpm(bpm)} BPM</span>
            {/* key: restart the animation on a new track so the phase is right */}
            <span
              key={info?.id}
              aria-hidden="true"
              className="size-2 rounded-full bg-primary shrink-0 animate-[music-beat_var(--beat)_linear_infinite]"
              style={{ '--beat': `${beat}s`, animationDelay: `${delay}s` } as React.CSSProperties}
            />
          </>
        )}
      </div>
      <h2 className="mt-1 truncate font-bold leading-[.95] tracking-[-.04em] text-[clamp(2.25rem,8vw,6rem)] pb-1">
        {info?.title ?? ''}
      </h2>
    </div>
  )
}
