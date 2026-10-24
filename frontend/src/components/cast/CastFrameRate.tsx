import { useState } from 'react'
import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'
import { useMediaOptions } from '../../useMediaOptions'
import { AiSetupNotice } from '../AiSetupProgress'
import FrameRatePicker from '../FrameRatePicker'

/** Picks the frame rate a TV is sent at, and remembers it for the next cast.
 *  Hidden when the source offers nothing besides its own rate. */
export default function CastFrameRate({ url, onChange, disabled }: {
  /** The media to list rates for; omitted, what was last sent to a DLNA TV. */
  url?: string
  /** Told the rate (0 for the source's own) after it is saved. */
  onChange?: (fps: number) => void
  disabled?: boolean
}) {
  const options = useMediaOptions(url)
  const [saved, setSaved] = useState(() => loadPlayerPrefs().tvFps ?? 0)
  const rates = options?.frame_rates ?? []
  // The AI rates come once the server has set itself up for them: its progress.
  const setup = options?.preparing && <AiSetupNotice />
  if (!options?.fps || !rates.length) return setup || null
  return (
    <>
      <FrameRatePicker
        label="TV frame rate"
        source={options.fps}
        rates={rates}
        // A rate this source does not offer plays as the source's own.
        value={rates.includes(saved) ? saved : 0}
        disabled={disabled}
        onChange={fps => {
          setSaved(fps)
          savePlayerPrefs({ tvFps: fps || undefined })
          onChange?.(fps)
        }}
      />
      {setup}
    </>
  )
}
