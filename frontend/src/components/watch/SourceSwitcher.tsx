import { useEffect, useRef, useState } from 'react'
import type { AlternateSource } from '../../useAlternateSources'

interface Props {
  sources: AlternateSource[]
  loading: boolean
  /** Opening the menu is what triggers the cross-site lookup. */
  onOpenChange: (open: boolean) => void
  onSelect: (source: AlternateSource) => void
}

/**
 * Which site the open title is playing from, and a way to move to another.
 *
 * The label is always shown — knowing the source matters even when there is
 * nowhere else to go, since it explains why the languages, episode list and
 * stream quality differ between two listings of the same title. Alternatives
 * are looked up only once the menu is opened (see useAlternateSources).
 */
export default function SourceSwitcher({
  sources, loading, onOpenChange, onSelect,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = sources.find(s => s.current) ?? sources[0]
  const others = sources.filter(s => !s.current)

  function toggle() {
    const next = !open
    setOpen(next)
    onOpenChange(next)
  }

  // Dismiss on outside click and on Escape, like the other popovers.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!current) return null

  return (
    <div ref={ref} className="relative">
      {/* Sized like the host chips beside it, so the two read as peer controls
          on one row rather than a label next to buttons. */}
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="The site this title is played from"
        className="btn sm:btn-sm btn-outline gap-1 max-w-[14rem] font-normal"
      >
        <span className="truncate">{current.label}</span>
        <svg
          className={`w-2.5 h-2.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-40 w-64 rounded-box bg-base-200 p-1.5 shadow-lg border border-base-300"
        >
          <p className="text-[10px] uppercase tracking-wide text-base-content/40 px-1.5 pb-1">
            Watch this title from
          </p>
          <ul className="flex flex-col gap-0.5">
            {sources.map(src => (
              <li key={`${src.source}-${src.page_url}`}>
                <button
                  role="option"
                  aria-selected={src.current}
                  disabled={src.current}
                  onClick={() => { setOpen(false); onSelect(src) }}
                  className={`w-full flex items-center gap-2 text-left rounded px-1.5 py-1 transition-colors ${
                    src.current ? 'bg-base-300/60 cursor-default' : 'hover:bg-base-300'
                  }`}
                >
                  {src.poster_url ? (
                    <img src={src.poster_url} alt="" loading="lazy" className="w-6 aspect-[2/3] object-cover rounded-sm shrink-0" />
                  ) : (
                    <span className="w-6 aspect-[2/3] rounded-sm bg-base-300 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs leading-tight truncate">{src.label}</span>
                    <span className="block text-[10px] leading-tight text-base-content/50 truncate">
                      {src.current ? 'Playing' : src.series_name}
                      {!src.current && src.year ? ` · ${src.year}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {loading && (
            <p className="text-[11px] text-base-content/50 px-1.5 py-1">
              Checking other sites…
            </p>
          )}
          {!loading && others.length === 0 && (
            <p className="text-[11px] text-base-content/50 px-1.5 py-1">
              No other site has this title.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
