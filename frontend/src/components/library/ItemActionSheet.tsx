import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import ResponsiveModal from '../ResponsiveModal'
import { useModalBack } from '../../useModalBack'

export interface SheetAction {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  /** Renders in the error colour and sits last — for removals. */
  destructive?: boolean
}

interface Props {
  title: string
  subtitle?: string
  actions: SheetAction[]
  onClose: () => void
}

/**
 * Labelled actions for one library item — a bottom sheet on phones, a centered
 * dialog from `sm:` up (whatever ResponsiveModal does).
 *
 * Exists because the Watching surfaces need more than the two save toggles, and
 * a poster card has nowhere to put five controls. Every row is text plus icon;
 * nothing here is icon-only.
 */
export default function ItemActionSheet({ title, subtitle, actions, onClose }: Props) {
  useModalBack(true, onClose)
  const firstRef = useRef<HTMLButtonElement>(null)

  // Focus the first action on open so the sheet is usable from the keyboard.
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ordered = [...actions].sort(
    (a, b) => Number(a.destructive ?? false) - Number(b.destructive ?? false),
  )

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-sm p-0">
      <div className="px-5 py-4 border-b border-base-300">
        <h2 className="font-semibold truncate">{title}</h2>
        {subtitle && <p className="text-base-content/60 text-sm mt-0.5 truncate">{subtitle}</p>}
      </div>
      <ul className="p-2">
        {ordered.map((action, i) => (
          <li key={action.id}>
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => {
                action.onSelect()
                onClose()
              }}
              className={`flex w-full items-center gap-3 rounded-box px-3 min-h-11 text-sm font-medium transition-colors hover:bg-base-300/60 ${
                action.destructive ? 'text-error' : ''
              }`}
            >
              <span className="shrink-0 opacity-70">{action.icon}</span>
              <span className="flex-1 text-left">{action.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </ResponsiveModal>
  )
}
