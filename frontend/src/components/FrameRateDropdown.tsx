import { useRef } from 'react'
import { fpsLabel, isDrawn } from '../frameRates'
import AiBadge from './AiBadge'

/** The frame rate picker folded into one button, for a phone's width: the
 *  rate playing, opening onto the others. A native select cannot hold the AI
 *  mark, so this is a menu. */
export default function FrameRateDropdown({ label, source, rates, value, onChange }: {
  /** What it picks, for screen readers: the button itself shows only a rate. */
  label: string
  /** The source's own frame rate. */
  source: number
  /** Rates on offer besides it. */
  rates: number[]
  /** The rate picked, 0 for the source's own. */
  value: number
  onChange: (fps: number) => void
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const name = (fps: number) => (fps ? String(fps) : fpsLabel(source))
  return (
    <details ref={menu} className="dropdown">
      <summary className="btn btn-sm btn-outline gap-1.5" aria-label={`${label}: ${value ? `${value} fps` : fpsLabel(source)}`}>
        {value ? `${value} fps` : fpsLabel(source)}
        {isDrawn(value, source) && <AiBadge />}
        <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <ul className="menu dropdown-content bg-base-200 rounded-box z-20 mt-1 w-32 p-1 shadow-lg">
        {[0, ...rates].map(fps => (
          <li key={fps}>
            <button
              type="button"
              className={`justify-between ${value === fps ? 'menu-active' : ''}`}
              aria-pressed={value === fps}
              onClick={() => {
                onChange(fps)
                if (menu.current) menu.current.open = false
              }}
            >
              {name(fps)}
              {isDrawn(fps, source) && <AiBadge />}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
