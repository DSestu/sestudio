import type { ReactNode } from 'react'

interface Props {
  onClose: () => void
  /** Extra classes for the modal-box (max-width, padding, flex layout…). */
  boxClassName?: string
  children: ReactNode
}

/**
 * App-standard modal shell: a bottom sheet on phones, a centered dialog from
 * `sm:` up. Backdrop click closes; clicks inside the box don't propagate.
 * (Pair with useModalBack in the owning component for back-button support.)
 */
export default function ResponsiveModal({ onClose, boxClassName = '', children }: Props) {
  return (
    <div className="modal modal-open modal-bottom sm:modal-middle" onClick={onClose}>
      <div className={`modal-box ${boxClassName}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
