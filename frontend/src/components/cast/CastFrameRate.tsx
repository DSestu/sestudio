import { useEffect, useState } from 'react'
import { mediaOptions } from '../../api'
import { fpsLabel, isDrawn } from '../../frameRates'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'
import AiBadge from '../AiBadge'

/** The most frames a second a TV or a Chromecast is sent: few decode more. */
const TV_MAX_FPS = 60

/** Picks the frame rate a TV is sent at, and remembers it for the next cast.
 *  Buttons rather than a select, which cannot hold the AI mark. Hidden when the
 *  source offers nothing besides its own rate. */
export default function CastFrameRate({ url, onChange, disabled }: {
  /** The media to list rates for; omitted, what was last sent to a DLNA TV. */
  url?: string
  /** Told the rate (0 for the source's own) after it is saved. */
  onChange?: (fps: number) => void
  disabled?: boolean
}) {
  const [source, setSource] = useState(0)
  const [rates, setRates] = useState<number[]>([])
  const [saved, setSaved] = useState(() => loadPlayerPrefs().tvFps ?? 0)
  useEffect(() => {
    let live = true
    mediaOptions(url).then(options => {
      if (!live) return
      setSource(options.fps)
      setRates(options.frame_rates.filter(rate => rate <= TV_MAX_FPS))
    })
    return () => { live = false }
  }, [url])

  if (!source || !rates.length) return null
  // A rate this source does not offer plays as the source's own.
  const shown = rates.includes(saved) ? saved : 0
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <span className="text-base-content/60">Frame rate</span>
      <div className="join">
        {[0, ...rates].map(fps => (
          <button
            key={fps}
            type="button"
            disabled={disabled}
            aria-pressed={shown === fps}
            onClick={() => {
              setSaved(fps)
              savePlayerPrefs({ tvFps: fps || undefined })
              onChange?.(fps)
            }}
            className={`join-item btn btn-sm gap-1.5 ${shown === fps ? 'btn-primary' : 'btn-ghost border-base-300'}`}
          >
            {fps ? fpsLabel(fps) : `Original · ${fpsLabel(source)}`}
            {isDrawn(fps, source) && <AiBadge />}
          </button>
        ))}
      </div>
    </div>
  )
}
