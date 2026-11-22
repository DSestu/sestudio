import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// A rail button's panel (Custom, Sort): drawn over the page beside the button, so the explorer's
// edges never clip it, above the phone sheet (daisyUI .modal is z 999); kept on screen; Esc or a click outside closes it and focus returns.

export default function RailPopover({ icon, label, title, pressed, className, width, children }: {
  icon: ReactNode
  label: string
  title: string
  pressed?: boolean
  className: string
  width: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) { setPos(null); return } // eslint-disable-line react-hooks/set-state-in-effect -- closed: forget the spot
    const b = button.current!.getBoundingClientRect()
    const h = panel.current?.offsetHeight ?? 0
    const w = panel.current?.offsetWidth ?? 0
    setPos({ left: Math.max(8, Math.min(b.right + 6, window.innerWidth - w - 8)), top: Math.max(8, Math.min(b.top, window.innerHeight - h - 8)) })
  }, [open])
  // Placed: focus goes in, on the lit choice if there is one.
  useEffect(() => {
    if (pos) (panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus()
  }, [pos])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key) }
  }, [open])
  return (
    <>
      <button ref={button} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-pressed={pressed} title={title} className={className}>
        {icon}<span>{label}</span>
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label={label} className={`scroll-thin fixed z-1000 max-h-[calc(100dvh-16px)] overflow-y-auto rounded-xl bg-base-300 p-2 shadow-xl outline-1 outline-white/10 ${width}`}
          style={pos ?? { left: -9999, top: 0 }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
