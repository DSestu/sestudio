import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A glass sheet from the bottom of the screen, over a scrim (phone). Closes on
 *  the scrim, the ✕, or Esc. */
export default function BottomSheet({ title, open, onClose, children, className = '' }: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Extra classes on the sheet, e.g. to make it a centred dialog on desktop. */
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div onClick={onClose} aria-hidden="true" className="absolute inset-0 bg-black/45 animate-[sheet-fade_200ms_ease-out] motion-reduce:animate-none" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`glass absolute inset-x-0 bottom-0 rounded-t-[20px] px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto animate-[sheet-up_280ms_var(--ease-smooth)] motion-reduce:animate-none ${className}`}
      >
        <span aria-hidden="true" className="block mx-auto mb-2.5 w-9 h-1 rounded-full bg-base-content/25" />
        <div className="flex items-center mb-3">
          <h2 className="flex-1 font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-sm btn-ghost btn-square">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
