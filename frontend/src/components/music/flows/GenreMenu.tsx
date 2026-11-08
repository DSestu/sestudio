import { useEffect, useRef } from 'react'

// A genre chip's menu (SPEC-flows-tab §2, other doors): show its albums (what a chip did before),
// play it as a flow, or send it to the Flows tab's From bar. Pinned under the chip.

export default function GenreMenu({ at, genre, onShow, onFlow, onAdd, onClose }: {
  at: DOMRect; genre: string; onShow: () => void; onFlow: () => void; onAdd: () => void; onClose: () => void
}) {
  const box = useRef<HTMLUListElement>(null)
  // Focus goes back to whatever opened this when it closes.
  useEffect(() => { const back = document.activeElement as HTMLElement | null; return () => back?.focus?.() }, [])
  useEffect(() => {
    box.current?.querySelector('button')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (box.current && !box.current.contains(t) && !t.closest?.('[data-flow-toggle]')) onClose()
    }
    window.addEventListener('keydown', esc)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('pointerdown', down) }
  }, [onClose])
  const item = (label: string, act: () => void) => (
    <li><button onClick={() => { onClose(); act() }} className="w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/7 focus-visible:bg-white/7">{label}</button></li>
  )
  return (
    <ul
      ref={box} role="menu" aria-label={genre}
      className="fixed z-50 w-56 rounded-xl bg-base-200 p-1 shadow-xl outline-1 outline-white/10"
      style={{ left: Math.max(8, Math.min(at.left, window.innerWidth - 232)), top: at.bottom + 6 }}
    >
      {item('Show these albums', onShow)}
      {item('Play as a flow…', onFlow)}
      {item('Add to Flows › From', onAdd)}
    </ul>
  )
}
