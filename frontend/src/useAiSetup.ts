import { useEffect, useState } from 'react'
import { getAiSetup, type AiSetup } from './api'

/** Steps of the AI setup while it runs, as the user reads them. */
export const SETUP_STEPS: Record<string, string> = {
  starting: 'Starting',
  runtime: 'Installing the AI runtime (can be a few GB with an NVIDIA GPU)',
  model: 'Downloading the AI model',
  measure: 'Preparing the GPU and measuring its speed (minutes the first time with TensorRT)',
}

export function isSettingUp(setup: AiSetup | null): boolean {
  return setup !== null && setup.step in SETUP_STEPS
}

/** The AI setup's state, asked again every moment while it runs — and while it
 *  has not started yet when *followIdle*, as the server starts it on a first
 *  ask for a video's frame rates. The setter takes an answer got elsewhere. */
export function useAiSetup(followIdle = false): [AiSetup | null, (s: AiSetup) => void] {
  const [setup, setSetup] = useState<AiSetup | null>(null)
  const poll = setup === null || isSettingUp(setup) || (followIdle && setup.step === 'idle')
  useEffect(() => {
    if (!poll) return
    const timer = window.setTimeout(
      () => void getAiSetup().then(setSetup).catch(() => {}),
      setup === null ? 0 : 1500,
    )
    return () => window.clearTimeout(timer)
  }, [setup, poll])
  return [setup, setSetup]
}
