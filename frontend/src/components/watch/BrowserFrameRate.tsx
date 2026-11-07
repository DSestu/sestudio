import type { AppSettings, StreamSource } from '../../api'
import { setBrowserFps, useBrowserAiShown, useBrowserFps } from '../../browserFps'
import { isDrawn, ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import AiHeldFrames from '../AiHeldFrames'
import { AiSetupNotice } from '../AiSetupProgress'
import FrameRateDropdown from '../FrameRateDropdown'

/** The frame rate the browser player plays at, picked in the watch page's
 *  Playback controls rather than the player's settings menu — which its small
 *  (phone) layout does not show — right of the quality. Hidden for a source
 *  that can only play at its own rate. The AI rates' finer settings, the same
 *  as in Settings, sit beside it. */
export default function BrowserFrameRate({ source, settings, onUpdateSettings }: {
  source: StreamSource | null
  settings: AppSettings
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<unknown> | void
}) {
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
      <div className="flex items-center gap-2 text-sm">
        <span className="text-base-content/60">Frame rate</span>
        <FrameRateDropdown {...pick} />
      </div>
      {setup}
      {/* Shown directly in the Playback controls, not folded away (docs/SPEC-below-player.md). */}
      {rates.some(rate => isDrawn(rate, options.fps)) && (
        <label className="flex items-center gap-2 text-sm" title="Anime: let AI draw smoothly across drawings held for several frames">
          <span className="text-base-content/60">AI frames</span>
          <AiHeldFrames
            id="player-ai-max-hold"
            className="select select-sm select-bordered w-auto"
            value={settings.ai_max_hold ?? 0}
            onChange={hold => void onUpdateSettings({ ai_max_hold: hold })}
          />
        </label>
      )}
    </>
  )
}
