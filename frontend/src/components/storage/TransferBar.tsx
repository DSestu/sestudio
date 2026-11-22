import { useEffect } from 'react'
import { fmtSize } from '../../downloadedLibrary'
import { setSelectionActive } from '../../selectionMode'
import type { TransferEntry } from '../../transfers'
import Check from './Check'
import { COPY_ICON, MOVE_ICON, TransferIcon } from './TransferMenu'

/**
 * What select mode in the Tree or Browse has picked, and where to send it
 * (SPEC-storage §9, X2, option T2). Takes the tab bar's slot on a phone, like the
 * Library's selection bar.
 */
export default function TransferBar({ names, entries, onSend }: {
  /** What is ticked, by name: "Bleach, Stargate SG-1". */
  names: string[]
  entries: TransferEntry[]
  onSend: (mode: 'copy' | 'move') => void
}) {
  useEffect(() => {
    setSelectionActive(true)
    return () => setSelectionActive(false)
  }, [])
  const size = entries.reduce((n, e) => n + e.file.size, 0)
  return (
    <div
      role="toolbar"
      aria-label="Copy or move what is selected"
      className="fixed inset-x-0 md:left-56 bottom-0 z-40 border-t border-base-300 bg-base-200/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center gap-2 px-3 py-2 min-h-16">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-sm font-semibold">
            {entries.length} {entries.length === 1 ? 'file' : 'files'} · {fmtSize(size)}
          </p>
          <p className="text-xs text-base-content/50 truncate">{names.length ? names.join(', ') : 'Nothing selected'}</p>
        </div>
        <button disabled={!entries.length} onClick={() => onSend('copy')} className="btn btn-sm btn-primary gap-1.5">
          <TransferIcon d={COPY_ICON} /> Copy to…
        </button>
        <button disabled={!entries.length} onClick={() => onSend('move')} className="btn btn-sm btn-outline gap-1.5">
          <TransferIcon d={MOVE_ICON} /> Move to…
        </button>
      </div>
    </div>
  )
}

/** Above the Tree or Browse: Select, or while selecting, Select all and Cancel. */
export function SelectStrip({ picking, count, all, onStart, onAll, onCancel }: {
  picking: boolean
  count: number
  /** Whether every item in view is ticked. */
  all: boolean | 'part'
  onStart: () => void
  onAll: (on: boolean) => void
  onCancel: () => void
}) {
  if (!picking) {
    return (
      <div className="flex justify-end">
        <button onClick={onStart} className="btn btn-ghost btn-xs gap-1.5">
          <TransferIcon d={COPY_ICON} className="w-3.5 h-3.5" /> Select to copy or move
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-box bg-base-300/50">
      <Check state={all} label="Select all" onChange={onAll} />
      <span className="text-sm">Select all</span>
      <span className="text-xs text-base-content/50 ml-auto">{count} selected</span>
      <button onClick={onCancel} className="btn btn-ghost btn-xs">Cancel</button>
    </div>
  )
}
