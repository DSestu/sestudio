import type { StreamSource } from '../../api'
import { useBrowserFps } from '../../browserFps'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { isDrawn, ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import PerformancePanel from '../PerformancePanel'

/** The performance graphs under the player, while it plays frames drawn by AI. */
export default function BrowserPerformance({ source }: { source: StreamSource | null }) {
  const url = ladderUrlOf(source)
  const options = useMediaOptions(url ?? undefined, url !== null)
  const fps = useBrowserFps()
  const controls = useBrowserPlayerControls()
  if (!url || !controls || !options?.frame_rates.includes(fps) || !isDrawn(fps, options.fps)) return null
  return <PerformancePanel url={url} position={controls.position} clientAhead={controls.bufferedAhead} />
}
