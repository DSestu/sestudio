import { fpsLabel, isDrawn } from '../frameRates'
import AiBadge from './AiBadge'

/** A row of frame rates to pick from, the source's own first, those drawn by
 *  AI marked. Buttons rather than a select, which cannot hold the mark. */
export default function FrameRatePicker({ source, rates, value, onChange, disabled }: {
  /** The source's own frame rate. */
  source: number
  /** Rates on offer besides it. */
  rates: number[]
  /** The rate picked, 0 for the source's own. */
  value: number
  onChange: (fps: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <span className="text-base-content/60">Frame rate</span>
      {/* Separate buttons, not a joined group, so a phone's width wraps them. */}
      <div className="flex flex-wrap gap-1">
        {[0, ...rates].map(fps => (
          <button
            key={fps}
            type="button"
            disabled={disabled}
            aria-pressed={value === fps}
            onClick={() => onChange(fps)}
            className={`btn btn-sm gap-1.5 ${value === fps ? 'btn-primary' : 'btn-ghost border-base-300'}`}
          >
            {fps ? fpsLabel(fps) : `Original · ${fpsLabel(source)}`}
            {isDrawn(fps, source) && <AiBadge />}
          </button>
        ))}
      </div>
    </div>
  )
}
