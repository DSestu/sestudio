import { useState } from 'react'
import type { ServerLan } from '../api'
import { useModalBack } from '../useModalBack'
import ResponsiveModal from './ResponsiveModal'

type Lan = NonNullable<ServerLan['lan']>

interface Props {
  lan: Lan
  /** Asks the server to check again; the modal closes once nothing is in the way. */
  onRecheck: () => Promise<void>
  onClose: () => void
}

const WHY: Record<NonNullable<Lan['problem']>, (lan: Lan) => string> = {
  firewall: () =>
    'Windows Firewall is blocking sestudio on this network, so casting to a TV and opening sestudio on your phone won’t work.',
  unreachable: lan =>
    `This PC’s network address${lan.ip ? ` (${lan.ip})` : ''} doesn’t answer, even from here, so casting to a TV and opening sestudio on your phone won’t work.`,
  offline: () =>
    'This PC isn’t on a network, so there’s nothing to cast to and no way in from your phone.',
}

/**
 * Shown on a page the server opened on localhost because phones and TVs can't
 * reach it: says why, and for a firewall block, how to let it through.
 */
export default function LanWarningModal({ lan, onRecheck, onClose }: Props) {
  useModalBack(true, onClose)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  // Checked again and still in the way (once cleared, the modal is gone).
  const [still, setStill] = useState(false)
  const problem = lan.problem ?? 'unreachable'
  const network = lan.network ?? 'Private'

  async function recheck() {
    setChecking(true)
    try {
      await onRecheck()
      setStill(true)
    } finally {
      setChecking(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(lan.program).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-lg">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-box bg-warning/15 text-warning" aria-hidden>
          <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7.5 3v5.25c0 4.6-3.1 8.4-7.5 9.75-4.4-1.35-7.5-5.15-7.5-9.75V6L12 3z" />
            <path strokeLinecap="round" d="M12 8.5v4" />
            <circle cx="12" cy="15.75" r=".9" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-balance">Phones and TVs can’t reach sestudio</h2>
          <p className="mt-1 text-sm text-base-content/70 text-pretty">{WHY[problem](lan)}</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-base-content/70">
        This tab runs on this PC, where everything else works.
      </p>

      {problem === 'firewall' && (
        <>
          <ol className="mt-4 space-y-2 text-sm">
            {[
              <>Open <b className="font-medium">Windows Security</b>, then <b className="font-medium">Firewall &amp; network protection</b>.</>,
              <>Choose <b className="font-medium">Allow an app through firewall</b>, then <b className="font-medium">Change settings</b>.</>,
              <>Tick <b className="font-medium">{network}</b> for the Python below. Not listed? Add it with <b className="font-medium">Allow another app</b>.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-base-300 text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <span className="text-pretty">{step}</span>
              </li>
            ))}
          </ol>
          {network === 'Public' && (
            <p className="mt-3 text-sm text-base-content/70 text-pretty">
              Windows has this network as <b className="font-medium">Public</b>. At home, set it to
              {' '}<b className="font-medium">Private</b> in Settings › Network &amp; internet instead, then tick Private.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2 rounded-box bg-base-200 py-1.5 pl-3 pr-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-base-content/80">{lan.program}</code>
            {navigator.clipboard && (
              <button className="btn btn-ghost btn-xs" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            )}
          </div>
        </>
      )}

      {still && !checking && (
        <p className="mt-4 text-sm text-warning" role="status">Still blocked. Check the steps, then try again.</p>
      )}

      <div className="modal-action">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Not now</button>
        <button className="btn btn-primary btn-sm" disabled={checking} onClick={() => { void recheck() }}>
          {checking && <span className="loading loading-spinner loading-xs" />}
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </ResponsiveModal>
  )
}
