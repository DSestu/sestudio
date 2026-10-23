import { useEffect, useState } from 'react'
import { mediaOptions } from '../../api'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'

/** Offered while the source's own size is unknown; the server clamps a pick
 *  to what the source has. */
const FALLBACK = [720, 480, 360, 240, 144]

/** Picks the quality a TV is sent at, and remembers it for the next cast.
 *  The list is the source's own: its size as Best, then every step below. */
export default function CastQuality({ url, onChange, disabled }: {
  /** The media to list qualities for; omitted, what was last sent to a DLNA TV. */
  url?: string
  /** Told the height (0 for the best) after it is saved, e.g. to re-send
   *  what is playing. */
  onChange?: (quality: number) => void
  disabled?: boolean
}) {
  // Heights best first, the source's own first; empty until known.
  const [heights, setHeights] = useState<number[]>([])
  const [saved, setSaved] = useState(() => loadPlayerPrefs().tvQuality ?? 0)
  useEffect(() => {
    let live = true
    mediaOptions(url).then(options => { if (live) setHeights(options.heights) })
    return () => { live = false }
  }, [url])

  const steps = heights.length ? heights.slice(1) : FALLBACK
  // Shown as what the server sends for it: Best when it is this source's size
  // or more, else the nearest step at or below it.
  const shown = !saved || (heights.length && saved >= heights[0])
    ? 0
    : (steps.find(h => h <= saved) ?? 0)
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">Quality</span>
      <select
        className="select select-sm select-bordered"
        disabled={disabled}
        value={shown}
        onChange={e => {
          const height = Number(e.target.value)
          setSaved(height)
          savePlayerPrefs({ tvQuality: height || undefined })
          onChange?.(height)
        }}
      >
        <option value={0}>{heights.length ? `Best (${heights[0]}p)` : 'Best'}</option>
        {steps.map(h => <option key={h} value={h}>{h}p</option>)}
      </select>
    </label>
  )
}
