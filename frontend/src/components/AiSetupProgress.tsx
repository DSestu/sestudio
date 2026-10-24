import type { AiSetup } from '../api'
import { isSettingUp, SETUP_STEPS, useAiSetup } from '../useAiSetup'

/** The running step and a bar: filled to the share done where the step can
 *  tell (the download), else moving. Nothing once the setup is not running. */
export default function AiSetupProgress({ setup }: { setup: AiSetup | null }) {
  if (!setup || !isSettingUp(setup)) return null
  const label = SETUP_STEPS[setup.step]
  return (
    <div className="flex flex-col gap-1 text-xs text-base-content/60" role="status">
      <span>
        {label}
        {setup.progress !== null && ` — ${Math.round(setup.progress * 100)}%`}
      </span>
      {setup.progress !== null ? (
        <progress className="progress progress-primary w-full" value={setup.progress} max={1} aria-label={label} />
      ) : (
        <progress className="progress progress-primary w-full" aria-label={label} />
      )}
    </div>
  )
}

/** The setup's progress where AI frame rates will appear, while the server
 *  fetches what they need on first use. */
export function AiSetupNotice() {
  const [setup] = useAiSetup(true)
  if (!isSettingUp(setup)) return null
  return (
    <div className="max-w-sm">
      <AiSetupProgress setup={setup} />
    </div>
  )
}
