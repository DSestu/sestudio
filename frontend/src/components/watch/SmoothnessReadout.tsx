import { useEffect, useState } from 'react'
import { useBrowserPlayerControls } from '../../browserPlayerControls'

/** Seconds a dropped frame keeps the readout from saying "Smooth". */
const RECENT = 10

/**
 * One line on how smoothly the browser plays (docs/SPEC-below-player.md):
 * "● Smooth · 23.9 fps shown · 0 dropped", from the video's own frame counts,
 * sampled every second. Details opens the full performance graphs.
 */
export default function SmoothnessReadout({ details, onDetails }: { details: boolean; onDetails: () => void }) {
  const controls = useBrowserPlayerControls()
  const [stat, setStat] = useState<{ fps: number; dropped: number; dropping: boolean } | null>(null)
  useEffect(() => {
    if (!controls) return
    let prev = controls.frames()
    let at = performance.now()
    const start = prev?.dropped ?? 0
    let lastDrop = -Infinity
    const timer = window.setInterval(() => {
      const now = controls.frames()
      const t = performance.now()
      if (now && prev) {
        if (now.dropped > prev.dropped) lastDrop = t
        const shown = (now.total - now.dropped) - (prev.total - prev.dropped)
        setStat({ fps: Math.max(0, shown) / ((t - at) / 1000), dropped: now.dropped - start, dropping: t - lastDrop < RECENT * 1000 })
      }
      prev = now
      at = t
    }, 1000)
    return () => window.clearInterval(timer)
  }, [controls])

  const paused = controls?.isPaused
  const [tone, word] = !stat ? ['bg-base-content/30', 'Measuring…']
    : paused ? ['bg-base-content/30', 'Paused']
      : stat.dropping ? ['bg-warning', 'Dropping frames'] : ['bg-success', 'Smooth']
  return (
    <div className="flex items-center gap-2 text-xs text-base-content/60 tabular-nums">
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${tone}`} />
      <span>
        {word}
        {stat && !paused && ` · ${stat.fps.toFixed(1)} fps shown`}
        {stat && ` · ${stat.dropped} dropped`}
      </span>
      <button type="button" onClick={onDetails} aria-expanded={details} className="ml-1 text-primary hover:underline underline-offset-3">
        {details ? 'Hide details' : 'Details'}
      </button>
    </div>
  )
}
