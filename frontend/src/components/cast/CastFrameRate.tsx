import { useEffect, useRef, useState } from 'react'
import { mediaAiShown } from '../../api'
import { isDrawn } from '../../frameRates'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'
import { useMediaOptions } from '../../useMediaOptions'
import FrameRateDropdown from '../FrameRateDropdown'

/** How often to ask what a Chromecast shows. */
const ASK_EVERY_MS = 2000

/** Picks the frame rate a TV is sent at, and remembers it for the next cast.
 *  The browser player's dropdown, with its marks: while casting, whether the
 *  AI frames are on screen yet. Hidden when the source offers nothing besides
 *  its own rate. */
export default function CastFrameRate({ url, onChange, disabled, position }: {
  /** The media to list rates for; omitted, what was last sent to a DLNA TV. */
  url?: string
  /** Told the rate (0 for the source's own) after it is saved. */
  onChange?: (fps: number) => void
  disabled?: boolean
  /** Where the cast plays, while it does; omitted before it starts. */
  position?: number
}) {
  const options = useMediaOptions(url)
  const [saved, setSaved] = useState(() => loadPlayerPrefs().tvFps ?? 0)
  const rates = options?.frame_rates ?? []
  const value = rates.includes(saved) ? saved : 0
  const drawn = Boolean(options && isDrawn(value, options.fps))
  const casting = position !== undefined

  // A Chromecast plays the server's segments, which are the source's rate until
  // the drawn ones are ready: asked which it is at. A DLNA TV is sent one
  // stream, drawn throughout.
  const [shown, setShown] = useState(false)
  const at = useRef(position ?? 0)
  useEffect(() => { at.current = position ?? 0 })
  useEffect(() => {
    if (!casting || !drawn || !url) return
    let live = true
    const ask = () => mediaAiShown(url, at.current).then(next => { if (live) setShown(next) })
    void ask()
    const timer = window.setInterval(() => { void ask() }, ASK_EVERY_MS)
    return () => { live = false; window.clearInterval(timer); setShown(false) }
  }, [casting, drawn, url])
  const onScreen = casting && drawn && (url ? shown : true)

  if (!options?.fps || !rates.length) return null
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">TV frame rate</span>
      <FrameRateDropdown
        label="TV frame rate"
        source={options.fps}
        rates={rates}
        // A rate this source does not offer plays as the source's own.
        value={value}
        disabled={disabled}
        inline
        waiting={casting && drawn && !onScreen}
        live={onScreen}
        onChange={fps => {
          setSaved(fps)
          savePlayerPrefs({ tvFps: fps || undefined })
          onChange?.(fps)
        }}
      />
    </div>
  )
}
