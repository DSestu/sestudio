import { useSyncExternalStore } from 'react'
import { dismiss, getNote, subscribe } from './toast'

/** The player's toast, with its Undo. */
export default function ToastBar() {
  const n = useSyncExternalStore(subscribe, getNote)
  if (!n) return null
  // Above the crate when it is open.
  const crate = document.querySelector('aside[data-addp]')?.getBoundingClientRect()
  return (
    <div
      key={n.id}
      role="status"
      style={{ bottom: crate ? innerHeight - crate.top + 12 : 24 }}
      className="fixed left-1/2 z-90 -translate-x-1/2 flex items-center gap-4 rounded-xl bg-black/80 px-4 h-11 text-[13px] font-medium text-base-content shadow-lg max-w-[calc(100vw-32px)]"
    >
      <span className="truncate">{n.text}</span>
      {n.undo && (
        <button className="shrink-0 h-9 -mr-2 px-2 rounded-lg font-semibold text-primary hover:bg-white/10" onClick={() => { n.undo!(); dismiss() }}>
          Undo
        </button>
      )}
    </div>
  )
}
