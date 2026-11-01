import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { GLASS_BUTTON, pageHeaderMounted } from '../pageHeader'
import { AWAY, useBarsHidden } from '../barsHidden'

// The phone's top card (docs/SPEC-nav-redesign.md §4.2): one floating glass
// card per page with its name, a status line, a ⋯ menu of the page's actions
// and, when the page has tabs, a second row with them. A page renders
// <PageHeader>; AppShell shows a default card (wordmark + Settings) on pages
// that don't (see pageHeader.ts).

const gearIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
  </svg>
)

/** Settings, at the end of the card's first row. A plain hash link: the router follows the hash. */
export function SettingsButton() {
  return (
    <a href="#/settings" aria-label="Settings" className={GLASS_BUTTON}>{gearIcon}</a>
  )
}

/**
 * The floating glass card itself, phones only. Publishes its height as
 * --top-card-h so the page below starts clear of it.
 */
export function TopCard({ children }: { children: ReactNode }) {
  const card = useRef<HTMLElement>(null)
  const away = useBarsHidden()
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const root = document.documentElement
    const publish = () => { if (el.offsetHeight) root.style.setProperty('--top-card-h', `${el.offsetHeight}px`) }
    publish()
    const watch = new ResizeObserver(publish)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <header
      ref={card}
      className={`md:hidden fixed inset-x-3 top-[calc(0.625rem+env(safe-area-inset-top))] z-40 glass rounded-2xl pl-5 pr-2.5 py-2.5 transition-[translate,opacity] ${AWAY(away, "-translate-y-[calc(100%+1.5rem)]")}`}
    >
      {children}
    </header>
  )
}

/** Name and status line, the left of the card's first row. */
export function CardTitle({ title, status }: { title: ReactNode; status?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 flex flex-col justify-center leading-tight">
      <h2 className="text-xl font-semibold tracking-tight truncate">{title}</h2>
      {status && <p className="mt-0.5 text-xs text-base-content/60 truncate">{status}</p>}
    </div>
  )
}

export interface HeaderTab<T extends string> {
  id: T
  label: string
  count?: number
}

interface Props<T extends string> {
  title: ReactNode
  /** One short line under the title; counts in it read best wrapped in <em>. */
  status?: ReactNode
  /** Shows a back button before the title instead of the page being a destination. */
  onBack?: () => void
  /** The page's actions, behind the ⋯ button. */
  menu?: ReactNode
  tabs?: HeaderTab<T>[]
  tab?: T
  onTab?: (id: T) => void
}

export default function PageHeader<T extends string>({ title, status, onBack, menu, tabs, tab, onTab }: Props<T>) {
  useEffect(() => { pageHeaderMounted(1); return () => pageHeaderMounted(-1) }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Any tap outside the menu, or Escape, folds it.
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  const index = tabs ? Math.max(0, tabs.findIndex(t => t.id === tab)) : 0
  return (
    <TopCard>
      <div className="flex items-center gap-2 min-h-11">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className={`${GLASS_BUTTON} -ml-2.5 mr-1`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <CardTitle title={title} status={status} />
        {menu && (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="More"
              aria-expanded={menuOpen}
              className={GLASS_BUTTON}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            <div
              inert={!menuOpen}
              className={`absolute right-0 top-12 z-10 w-64 rounded-2xl bg-base-200 border border-white/10 shadow-xl p-3 flex flex-col gap-3 origin-top-right transition-[scale,opacity] duration-200 ease-smooth motion-reduce:transition-opacity ${
                menuOpen ? 'scale-100 opacity-100' : 'scale-92 opacity-0 pointer-events-none'
              }`}
            >
              {menu}
            </div>
          </div>
        )}
        {!onBack && <SettingsButton />}
      </div>
      {tabs && onTab && (
        <div
          role="tablist"
          className="relative grid mt-2.5 -ml-2.5 rounded-xl bg-black/22 p-0.75"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {/* The pill slides under the selected tab, as in the dock. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0.75 left-0.75 rounded-[9px] bg-primary/24 transition-transform duration-300 ease-smooth motion-reduce:transition-none"
            style={{ width: `calc((100% - 0.375rem) / ${tabs.length})`, transform: `translateX(${index * 100}%)` }}
          />
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => onTab(t.id)}
              className={`relative h-8.5 rounded-[9px] flex items-center justify-center gap-1.5 text-[13px] transition-colors ${
                t.id === tab ? 'text-base-content font-semibold' : 'text-base-content/70 font-medium'
              }`}
            >
              <span className="truncate">{t.label}</span>
              {t.count !== undefined && <span className="text-[11px] opacity-70 tabular-nums">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
    </TopCard>
  )
}
