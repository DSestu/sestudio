import type { StreamSource } from '../../api'
import { setBrowserFps, useBrowserAiShown, useBrowserFps } from '../../browserFps'
import { isDrawn, ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import { AiSetupNotice } from '../AiSetupProgress'
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
  const aiShown = useBrowserAiShown()
  const rates = options?.frame_rates ?? []
  // The AI rates come once the server has set itself up for them: its progress.
  const setup = options?.preparing && <div className="basis-full"><AiSetupNotice /></div>
  if (!options?.fps || !rates.length) return setup || null
  const pick = {
    label: 'Frame rate',
    source: options.fps,
    rates,
    value: rates.includes(fps) ? fps : 0,
    onChange: setBrowserFps,
    // AI asked for, the source's rate on screen meanwhile.
    waiting: isDrawn(fps, options.fps) && rates.includes(fps) && !aiShown,
    live: isDrawn(fps, options.fps) && rates.includes(fps) && aiShown,
  }
  return (
    <>
      <div className="md:hidden"><FrameRateDropdown {...pick} /></div>
      <div className="hidden md:block"><FrameRatePicker {...pick} /></div>
      {setup}
    </>
  )
}
