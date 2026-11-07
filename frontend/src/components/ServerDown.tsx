import { useState } from 'react'
import { timeAgo } from '../notifications'
import { recheckActiveServer, switchServer, thisMachine, useActiveServer } from '../servers'

/** The server in use stopped answering (docs/SPEC-remote-servers.md §4 D): one
 *  card above the page, "Check again" and "Use this machine". The switch stays,
 *  so a short Tailscale drop recovers by itself. */
export default function ServerDown() {
  const active = useActiveServer()
  const [busy, setBusy] = useState(false)
  if (!active?.down) return null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <div role="alert" className="mb-5 flex flex-col items-center rounded-[14px] bg-base-200 px-6 py-8 text-center">
      <svg className="mb-2 size-9 text-base-content/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h14l-3-3M20 16H6l3 3" />
      </svg>
      <h2 className="text-base font-semibold">{active.name} is not answering</h2>
      <p className="mt-1 max-w-sm text-sm text-base-content/60">
        {active.lastSeen ? `Last seen ${timeAgo(active.lastSeen)}. ` : ''}Is Tailscale on? Playing and casting from it stopped.
      </p>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(recheckActiveServer)}>Check again</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => switchServer(null))}>
          Use {thisMachine().toLowerCase()}
        </button>
      </div>
    </div>
  )
}
