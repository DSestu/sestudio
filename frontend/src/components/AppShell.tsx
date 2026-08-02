import type { ReactNode } from 'react'
import type { Tab, View } from '../nav'

interface Destination {
  id: Tab
  label: string
  icon: ReactNode
}

const icon = (d: string) => (
  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)

const DESTINATIONS: Destination[] = [
  { id: 'home', label: 'Home', icon: icon('M3 12l9-9 9 9M5 10v10h14V10') },
  { id: 'search', label: 'Search', icon: icon('M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z') },
  { id: 'library', label: 'Library', icon: icon('M20.8 6.6a4.5 4.5 0 00-6.4 0L12 9l-2.4-2.4a4.5 4.5 0 10-6.4 6.4L12 21.5l8.8-8.5a4.5 4.5 0 000-6.4z') },
  { id: 'downloads', label: 'Downloads', icon: icon('M12 3v12m0 0l-4-4m4 4l4-4M4 19h16') },
]

interface Props {
  view: View
  onNavigate: (v: Tab) => void
  /** Rendered on the Downloads destination when non-zero. */
  downloadBadge?: number
  /** Opens the settings drawer. */
  onOpenSettings: () => void
  children: ReactNode
}

/**
 * App chrome: a persistent rail on `md:` and up, a bottom tab bar below it.
 * The content column scrolls independently on desktop so the rail stays put.
 */
export default function AppShell({ view, onNavigate, downloadBadge = 0, onOpenSettings, children }: Props) {
  return (
    <div className="min-h-dvh bg-base-100 md:flex">
      {/* Desktop rail */}
      <aside className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:h-dvh md:sticky md:top-0 border-r border-base-300 bg-base-200/40 px-3 py-5 gap-6">
        <Wordmark className="px-2" />
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {DESTINATIONS.map(d => (
            <button
              key={d.id}
              onClick={() => onNavigate(d.id)}
              aria-current={view === d.id ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-box px-3 py-2.5 text-sm font-medium transition-colors ${
                view === d.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'
              }`}
            >
              {d.icon}
              <span className="flex-1 text-left">{d.label}</span>
              {d.id === 'downloads' && downloadBadge > 0 && (
                <span className="badge badge-primary badge-sm">{downloadBadge}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-3 rounded-box px-3 py-2.5 text-sm font-medium text-base-content/60 hover:bg-base-300/60 hover:text-base-content transition-colors"
          >
            {icon('M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75')}
            Settings
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-base-300 bg-base-100/95 backdrop-blur px-4 h-14 pt-[env(safe-area-inset-top)]">
        <Wordmark />
        <button onClick={onOpenSettings} aria-label="Settings" className="btn btn-ghost btn-square btn-sm">
          {icon('M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75')}
        </button>
      </header>

      {/* Content column — bottom padding clears the mobile tab bar */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-base-300 bg-base-200/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        {DESTINATIONS.map(d => (
          <button
            key={d.id}
            onClick={() => onNavigate(d.id)}
            aria-current={view === d.id ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-14 py-2 text-[11px] font-medium transition-colors ${
              view === d.id ? 'text-primary' : 'text-base-content/50'
            }`}
          >
            {/* Active state is icon + label + rail, never colour alone */}
            {view === d.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" />}
            {d.icon}
            {d.label}
            {d.id === 'downloads' && downloadBadge > 0 && (
              <span className="absolute top-1.5 right-[22%] badge badge-primary badge-xs">{downloadBadge}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <h1 className={`text-xl font-bold tracking-tight ${className}`}>
      se<span className="text-primary">studio</span>
    </h1>
  )
}
