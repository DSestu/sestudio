import { useState } from 'react'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { loadPlayerPrefs, qualityPref } from '../../playerPrefs'

/** Picks the quality the browser player plays at, beside the cast button, as
 *  the TV's is picked in the cast panel; remembered for the next video, and in
 *  the settings. Source, the default, is the video's own picture; Auto follows
 *  the connection. Hidden for a source with one quality. */
export default function BrowserQuality() {
  const controls = useBrowserPlayerControls()
  const [saved, setSaved] = useState(() => loadPlayerPrefs().quality)
  const heights = controls?.qualities ?? []
  if (!controls || heights.length < 2) return null
  const [best, ...lighter] = heights
  // Shown as what plays for it: the closest at or below, as the player picks.
  const shown = saved === 0 ? 'auto'
    : saved === undefined || saved >= best ? 'source'
      : String(lighter.find(h => h <= saved) ?? lighter.at(-1))
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">Quality</span>
      <select
        className="select select-sm select-bordered"
        value={shown}
        onChange={e => {
          const next = qualityPref(e.target.value)
          setSaved(next)
          controls.setQuality(next)
        }}
      >
        <option value="source">Source ({best}p)</option>
        <option value="auto">Auto</option>
        {lighter.map(h => <option key={h} value={h}>{h}p</option>)}
      </select>
    </label>
  )
}
