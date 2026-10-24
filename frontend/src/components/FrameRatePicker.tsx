import { fpsLabel, GLOW_EASE, isDrawn, LIVE_GLOW } from '../frameRates'
import AiBadge from './AiBadge'

/** A row of frame rates to pick from, the source's own first, those drawn by
 *  AI marked. Buttons rather than a select, which cannot hold the mark. */
/** "Live" beside a rate whose AI frames are on screen. */
export function LiveTag() {
  return <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">live</span>
}

export default function FrameRatePicker({ label, source, rates, value, onChange, disabled, waiting, live }: {
  /** Says whose rate it is: the browser's and the TV's are remembered apart. */
  label: string
  /** The source's own frame rate. */
  source: number
  /** Rates on offer besides it. */
  rates: number[]
  /** The rate picked, 0 for the source's own. */
  value: number
  onChange: (fps: number) => void
  disabled?: boolean
  /** The rate picked is drawn by AI, and those frames are not on screen yet. */
  waiting?: boolean
  /** The rate picked is drawn by AI, and those frames are on screen. */
  live?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <span className="text-base-content/60">{label}</span>
      {/* Separate buttons, not a joined group, so a phone's width wraps them. */}
      <div className="flex flex-wrap gap-1">
        {[0, ...rates].map(fps => (
          <button
            key={fps}
            type="button"
            disabled={disabled}
            aria-pressed={value === fps}
            title={fps ? undefined : 'The original frame rate'}
            onClick={() => onChange(fps)}
            className={`btn btn-sm gap-1.5 ${GLOW_EASE} ${value === fps ? 'btn-primary' : 'btn-ghost border-base-300'} ${live && value === fps ? LIVE_GLOW : ''}`}
          >
            {/* "fps" once, on the source's own rate: the rest read as numbers. */}
            {fps ? fps : fpsLabel(source)}
            {live && value === fps && <LiveTag />}
            {isDrawn(fps, source) && <AiBadge waiting={waiting && value === fps} />}
          </button>
        ))}
      </div>
    </div>
  )
}
