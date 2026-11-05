import { useState } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import StepBody from './steps'
import { STEP_TITLES } from './titles'
import { closeHarmonyBasics, useHarmonyBasicsOpen } from './store'

/**
 * The beginner explainer: a dialog with the step list beside it on desktop, a full-screen pager with
 * dots on phones. Mount once (App); open it from anywhere with openHarmonyBasics().
 */
export default function HarmonyBasics() {
  const open = useHarmonyBasicsOpen()
  useModalBack(open, closeHarmonyBasics)
  return open ? <Basics /> : null
}

function Basics() {
  const [k, setK] = useState(0)
  const last = k === STEP_TITLES.length - 1
  return (
    <ResponsiveModal
      onClose={closeHarmonyBasics}
      boxClassName="flex h-dvh max-h-none w-full max-w-none flex-col gap-4 rounded-none p-4 sm:h-[34rem] sm:max-h-[90dvh] sm:max-w-3xl sm:flex-row sm:rounded-box sm:p-6"
    >
      <nav aria-label="Steps" className="hidden w-52 shrink-0 flex-col gap-0.5 sm:flex">
        <h2 className="mb-2 text-lg font-semibold">Harmony basics</h2>
        {STEP_TITLES.map((title, i) => (
          <button
            key={title}
            aria-current={i === k ? 'step' : undefined}
            onClick={() => setK(i)}
            className={`flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === k ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:bg-base-200'}`}
          >
            <i className="w-4 text-xs not-italic tabular-nums opacity-60">{i + 1}</i>{title}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center sm:hidden">
          <h2 className="flex-1 text-lg font-semibold">Harmony basics</h2>
          <button onClick={closeHarmonyBasics} aria-label="Close" className="btn btn-ghost btn-sm btn-circle">✕</button>
        </div>
        <div className="flex gap-1.5 sm:hidden" role="group" aria-label="Steps">
          {STEP_TITLES.map((title, i) => (
            <button key={title} onClick={() => setK(i)} aria-label={`Step ${i + 1}: ${title}`} aria-current={i === k ? 'step' : undefined} className="relative hit h-1.5 flex-1 rounded-full">
              <span className={`absolute inset-0 rounded-full ${i <= k ? 'bg-primary' : 'bg-white/12'}`} />
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="text-xs text-base-content/50">Step {k + 1} of {STEP_TITLES.length}</div>
          <div className="mt-1 flex flex-col gap-3">
            <h3 className="text-xl font-semibold tracking-tight">{STEP_TITLES[k]}</h3>
            <StepBody k={k} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setK(k - 1)} disabled={k === 0} className="btn btn-ghost btn-sm">Back</button>
          <span className="flex-1" />
          <button onClick={last ? closeHarmonyBasics : () => setK(k + 1)} className="btn btn-primary btn-sm">{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </ResponsiveModal>
  )
}
