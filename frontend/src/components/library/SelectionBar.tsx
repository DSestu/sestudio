import type { ReactNode } from 'react'

export interface BulkAction {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  destructive?: boolean
}

interface Props {
  count: number
  total: number
  onSelectAll: () => void
  onCancel: () => void
  actions: BulkAction[]
  /** Shown when a bulk mutation was rejected and the store rolled back. */
  error?: string | null
}

/**
 * The action bar for selection mode.
 *
 * On mobile it takes the tab bar's slot rather than stacking above it: three
 * fixed `z-40` layers already exist (tab bar, Now-Casting bar, mini-player) and
 * a fourth would push fixed chrome to roughly a quarter of a short screen.
 * AppShell hides the tab bar while this is up, so total chrome height is
 * unchanged and the cast bar stays exactly where it was (#26).
 */
export default function SelectionBar({
  count, total, onSelectAll, onCancel, actions, error,
}: Props) {
  const allSelected = count > 0 && count === total

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="fixed inset-x-0 md:left-56 bottom-0 z-40 border-t border-base-300 bg-base-200/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      {error && (
        <p role="alert" className="px-4 pt-2 text-xs text-error">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2 px-3 py-2 min-h-16">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium whitespace-nowrap">{count} selected</span>
          <button
            onClick={onSelectAll}
            className="text-xs text-base-content/50 hover:text-primary transition-colors text-left"
          >
            {allSelected ? 'Select none' : 'Select all'}
          </button>
        </div>

        <div className="flex-1" />

        {actions.map(action => (
          <button
            key={action.id}
            onClick={action.onSelect}
            disabled={count === 0}
            aria-label={action.label}
            title={action.label}
            className={`btn btn-sm gap-1.5 ${action.destructive ? 'btn-error btn-outline' : 'btn-ghost'}`}
          >
            {action.icon}
            {/* Labels appear once there's room; icons carry them on a phone. */}
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        ))}

        <button onClick={onCancel} className="btn btn-sm btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  )
}
