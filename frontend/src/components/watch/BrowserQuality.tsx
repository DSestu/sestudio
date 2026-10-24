import { setBrowserQuality, useBrowserQuality } from '../../browserFps'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { ladderUrlOf } from '../../frameRates'
import type { StreamSource } from '../../api'
import { qualityPref } from '../../playerPrefs'
import { useMediaOptions } from '../../useMediaOptions'

/** Picks the quality the browser player plays at, beside the cast button, as
 *  the TV's is picked in the cast panel; remembered for the next video, and in
 *  the settings. Source, the default, is the video's own picture — played
 *  untouched where it can be; Auto follows the connection. Hidden for a source
 *  with one quality. */
export default function BrowserQuality({ source }: { source: StreamSource | null }) {
  const controls = useBrowserPlayerControls()
  const quality = useBrowserQuality()
  // The server's ladder where it re-encodes, else the renditions playing.
  const url = ladderUrlOf(source)
  const options = useMediaOptions(url ?? undefined, url !== null)
  const heights = (url ? options?.heights : controls?.qualities) ?? []
  if (heights.length < 2) return null
  const [best, ...lighter] = heights
  // Shown as what plays for it: the closest at or below, as the player picks.
  const shown = quality === 0 ? 'auto'
    : quality === undefined || quality >= best ? 'source'
      : String(lighter.find(h => h <= quality) ?? lighter.at(-1))
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">Quality</span>
      <select
        className="select select-sm select-bordered"
        value={shown}
        onChange={e => setBrowserQuality(qualityPref(e.target.value))}
      >
        <option value="source">Source ({best}p)</option>
        <option value="auto">Auto</option>
        {lighter.map(h => <option key={h} value={h}>{h}p</option>)}
      </select>
    </label>
  )
}
