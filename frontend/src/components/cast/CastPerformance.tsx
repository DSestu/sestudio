import { isDrawn } from '../../frameRates'
import { loadPlayerPrefs } from '../../playerPrefs'
import { useMediaOptions } from '../../useMediaOptions'
import PerformancePanel from '../PerformancePanel'

/** The performance graphs of a cast whose frames AI draws. Without the
 *  receiver's own buffer: neither a Chromecast nor a TV tells a sender that. */
export default function CastPerformance({ url, position }: {
  /** The Chromecast's playlist; omitted for the DLNA TV. */
  url?: string
  position: number
}) {
  const options = useMediaOptions(url)
  // Read each render: the bar re-renders with every position update.
  const fps = loadPlayerPrefs().tvFps ?? 0
  if (!options?.frame_rates.includes(fps) || !isDrawn(fps, options.fps)) return null
  return <PerformancePanel url={url} position={() => position} />
}
