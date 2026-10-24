import type { StreamSource } from '../../api'
import { setBrowserFps, useBrowserFps } from '../../browserFps'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import FrameRateDropdown from '../FrameRateDropdown'
import FrameRatePicker from '../FrameRatePicker'

/** The frame rate the browser player plays at, picked beside the cast button
 *  rather than in the player's settings menu — which its small (phone) layout
 *  does not show. A dropdown on a phone, a row of buttons wider. Hidden for a
 *  source that can only play at its own rate. */
export default function BrowserFrameRate({ source }: { source: StreamSource | null }) {
  const url = ladderUrlOf(source)
  const options = useMediaOptions(url ?? undefined, url !== null)
  const fps = useBrowserFps()
  const controls = useBrowserPlayerControls()
  const rates = options?.frame_rates ?? []
  if (!options?.fps || !rates.length) return null
  const pick = {
    label: 'Frame rate',
    source: options.fps,
    rates,
    value: rates.includes(fps) ? fps : 0,
    onChange: (next: number) => {
      // The new playlist starts at zero: it resumes where this one is now.
      controls?.holdPosition()
      setBrowserFps(next)
    },
  }
  return (
    <>
      <div className="md:hidden"><FrameRateDropdown {...pick} /></div>
      <div className="hidden md:block"><FrameRatePicker {...pick} /></div>
    </>
  )
}
