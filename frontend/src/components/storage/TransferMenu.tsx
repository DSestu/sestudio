import { useRef } from 'react'

export const COPY_ICON = 'M8 8h12v12H8zM16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2'
export const MOVE_ICON = 'M3 12h14M12 6l6 6-6 6M21 4v16'

export function TransferIcon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** The ⋯ on a file or folder: Copy to… and Move to… (SPEC-storage §9, X2). */
export default function TransferMenu({ name, onPick, className = '' }: {
  /** Named in the button's label, for screen readers. */
  name: string
  onPick: (mode: 'copy' | 'move') => void
  className?: string
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const pick = (mode: 'copy' | 'move') => {
    if (menu.current) menu.current.open = false
    onPick(mode)
  }
  return (
    // Its clicks stay here: the row or card under it would otherwise play or open.
    <details ref={menu} className={`dropdown dropdown-end ${className}`} onClick={e => e.stopPropagation()}>
      <summary
        className="btn btn-ghost btn-square btn-xs list-none text-base-content/50"
        aria-label={`More for ${name}`}
        title="Copy or move"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </summary>
      <ul className="menu dropdown-content z-30 mt-1 p-1 w-40 bg-base-200 rounded-box shadow-xl border border-base-300">
        <li><button type="button" onClick={() => pick('copy')}><TransferIcon d={COPY_ICON} /> Copy to…</button></li>
        <li><button type="button" onClick={() => pick('move')}><TransferIcon d={MOVE_ICON} /> Move to…</button></li>
      </ul>
    </details>
  )
}
