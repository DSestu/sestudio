import { useState, type CSSProperties } from 'react'
import { pollWatcher, retryHealthSite, type Health } from '../../api'
import { issueFacts, okFacts } from '../../homeHealth'
import Widget from './Widget'

interface Props {
  health: Health
  /** Ask the server again, after a retry. */
  onReload: () => void
  onOpenSettings: () => void
  lone?: boolean
  style?: CSSProperties
}

/** Home's Health when something is wrong: the worst issue and its retry
 *  (docs/SPEC-home-dashboard.md §3). A broken amber pulse runs along the top. */
export default function HealthWidget({ health, onReload, onOpenSettings, lone, style }: Props) {
  const [busy, setBusy] = useState(false)
  const issue = health.issues[0]

  const retry = () => {
    setBusy(true)
    const call = issue.retry === 'site' ? retryHealthSite(issue.id!) : pollWatcher(Number(issue.id))
    call.catch(() => {}).then(onReload).finally(() => setBusy(false))
  }

  return (
    <Widget
      size="S"
      lone={lone}
      style={style}
      title="Health"
      badge={health.issues.length}
      onOpen={onOpenSettings}
      // The header's count is a warning, not news: recolour Widget's badge.
      frame="pt-4 [&_h2_.bg-primary]:bg-warning [&_h2_.bg-primary]:text-warning-content"
      icon={
        <svg className="absolute inset-x-0 top-0 h-3.5 w-full text-warning" viewBox="0 0 170 14" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path vectorEffect="non-scaling-stroke" d="M0 8 H40 L46 2 L52 12 L58 8 H92 L99 8 M106 8 L110 1 L116 13 L121 8 H170" />
        </svg>
      }
    >
      <p className="flex items-start gap-1.5 text-[13px] font-medium leading-snug line-clamp-3">
        <svg className="w-4 h-4 mt-px shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <span>{issue.message}</span>
      </p>
      <p className="mt-1 text-xs text-base-content/50 truncate">{issueFacts(health, issue)}</p>
      {issue.retry && issue.id && (
        <button type="button" onClick={retry} disabled={busy} className="btn btn-ghost btn-xs self-start mt-auto">
          Retry
        </button>
      )}
    </Widget>
  )
}

/** Under Home's grid when all is good: a steady green pulse and the facts. */
export function HealthStatusLine({ health }: { health: Health }) {
  const facts = okFacts(health)
  return (
    <p className="flex items-center gap-2.5 pt-3 border-t border-base-300 text-xs">
      <svg className="w-11 h-3 shrink-0 text-success" viewBox="0 0 44 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M0 7 H10 L13 2 L16 11 L19 7 H44" />
      </svg>
      <b className="font-semibold text-success">All good</b>
      {facts && <span className="truncate text-base-content/50">{facts}</span>}
    </p>
  )
}
