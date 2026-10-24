import { isDrawn } from '../../frameRates'
import { loadPlayerPrefs } from '../../playerPrefs'
import { useMediaOptions } from '../../useMediaOptions'
import PerformancePanel from '../PerformancePanel'

/** The performance graphs of a cast the server re-encodes. Without the
 *  receiver's own buffer or connection: neither a Chromecast nor a TV tells a
 *  sender those. */
export default function CastPerformance({ url, position }: {
  /** The Chromecast's playlist; omitted for the DLNA TV. */
  url?: string
  position: number
}) {
  const options = useMediaOptions(url)
  // Read each render: the bar re-renders with every position update.
  const fps = loadPlayerPrefs().tvFps ?? 0
  const ai = Boolean(options?.frame_rates.includes(fps) && isDrawn(fps, options.fps))
  return <PerformancePanel url={url} ai={ai} position={() => position} />
}
