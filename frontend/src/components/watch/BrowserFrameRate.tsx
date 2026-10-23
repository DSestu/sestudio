import type { StreamSource } from '../../api'
import { setBrowserFps, useBrowserFps } from '../../browserFps'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import FrameRatePicker from '../FrameRatePicker'

/** The frame rate the browser player plays at, picked under the player rather
 *  than in its settings menu — which the player's small (phone) layout does
 *  not show. Hidden for a source that can only play at its own rate. */
export default function BrowserFrameRate({ source }: { source: StreamSource | null }) {
  const url = ladderUrlOf(source)
  const options = useMediaOptions(url ?? undefined, url !== null)
  const fps = useBrowserFps()
  const controls = useBrowserPlayerControls()
  const rates = options?.frame_rates ?? []
  if (!options?.fps || !rates.length) return null
  return (
    <FrameRatePicker
      source={options.fps}
      rates={rates}
      value={rates.includes(fps) ? fps : 0}
      onChange={next => {
        // The new playlist starts at zero and resumes from the saved position:
        // saved now, not on the next tick of the player's save throttle.
        controls?.savePosition()
        setBrowserFps(next)
      }}
    />
  )
}
