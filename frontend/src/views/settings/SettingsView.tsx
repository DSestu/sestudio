import { useState, useSyncExternalStore, type ReactNode } from 'react'
import PageHeader from '../../components/PageHeader'
import type { AppSettings } from '../../api'
import { replaceParams } from '../../nav'
import { goBack } from '../../pageHeader'
import Downloads from './Downloads'
import Music from './Music'
import Notifications from './Notifications'
import Playback from './Playback'
import Server from './Server'
import Servers from './Servers'
import Share from './Share'
import Sources from './Sources'
import Subtitles from './Subtitles'
import { useSettingsStatus } from './useSettingsStatus'

export interface SettingsProps {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void | Promise<void>
}

type Group = 'Watching' | 'Finding & keeping' | 'This server'

interface Category {
  id: string
  name: string
  group: Group
  /** Stroke paths of a 24px icon. */
  icon: string
  page: (props: SettingsProps) => ReactNode
}

/** The categories, in the order and groups both layouts list them (docs/SPEC-settings.md §2). */
const CATEGORIES: Category[] = [
  { id: 'playback', name: 'Playback', group: 'Watching', icon: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM10 9.5v5l4.5-2.5z', page: p => <Playback {...p} /> },
  { id: 'subtitles', name: 'Subtitles', group: 'Watching', icon: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM7 13h4M13 13h4M7 16h7', page: () => <Subtitles /> },
  { id: 'sources', name: 'Sources & search', group: 'Finding & keeping', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18', page: p => <Sources {...p} /> },
  { id: 'downloads', name: 'Downloads', group: 'Finding & keeping', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14', page: p => <Downloads {...p} /> },
  { id: 'music', name: 'Music', group: 'Finding & keeping', icon: 'M9 18V6l11-2v12M6.5 15.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17.5 13.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z', page: p => <Music {...p} /> },
  { id: 'notifications', name: 'Notifications', group: 'Finding & keeping', icon: 'M6 16v-5a6 6 0 1112 0v5l1.5 2h-15zM10 20.5h4', page: p => <Notifications {...p} /> },
  { id: 'server', name: 'Server', group: 'This server', icon: 'M6 4h12a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zM6 13h12a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3a2 2 0 012-2zM8 7.5h.01M8 16.5h.01', page: p => <Server {...p} /> },
  { id: 'servers', name: 'Servers', group: 'This server', icon: 'M4 8h14l-3-3M20 16H6l3 3', page: () => <Servers /> },
  { id: 'share', name: 'Share sestudio', group: 'This server', icon: 'M12 15V4M8 8l4-4 4 4M5 13v6h14v-6', page: () => <Share /> },
]

const GROUPS: Group[] = ['Watching', 'Finding & keeping', 'This server']

const DESKTOP = '(min-width: 48rem)'

/** True at the `md:` breakpoint and up, where the categories sit beside the page. */
function useDesktop(): boolean {
  return useSyncExternalStore(
    cb => {
      const m = matchMedia(DESKTOP)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(DESKTOP).matches,
    () => true,
  )
}

function Icon({ d, className }: { d: string; className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/**
 * Settings as categories (docs/SPEC-settings.md). A phone opens on the list of
 * categories and each one is its own page (`#/settings?s=<id>`), so Back walks
 * from a category to the list. A desktop shows the list beside the open
 * category; picking another rewrites `s` in place, so Back leaves Settings.
 */
export default function SettingsView({ section, ...props }: SettingsProps & { section: string | null }) {
  const desktop = useDesktop()
  const [picked, setPicked] = useState(section)
  // A link to another category (or Back to the list) arrives as a new route.
  const [routed, setRouted] = useState(section)
  if (section !== routed) {
    setRouted(section)
    setPicked(section)
  }

  const open = CATEGORIES.find(c => c.id === picked) ?? (desktop ? CATEGORIES[0] : undefined)
  const { summary, problems } = useSettingsStatus(props.settings)
  const flagged = new Set(problems.map(p => p.category))

  if (!desktop) {
    if (!open) {
      return (
        <div className="flex flex-col gap-5">
          <PageHeader title="Settings" onBack={goBack} />
          {problems.map(p => (
            <a
              key={p.category}
              href={`#/settings?s=${p.category}`}
              className="flex items-start gap-2.5 rounded-[14px] bg-warning/12 p-3 text-[13px] leading-snug"
            >
              <Icon d="M12 4l9 16H3zM12 10v4M12 17h.01" className="size-[18px] shrink-0 text-warning" />
              <span>
                <span className="font-semibold text-warning">{p.title}</span> {p.text}{' '}
                <span className="text-primary whitespace-nowrap">{CATEGORIES.find(c => c.id === p.category)!.name} →</span>
              </span>
            </a>
          ))}
          {GROUPS.map(group => (
            <div key={group}>
              <h3 className="text-xs font-semibold text-base-content/50 px-1.5 pb-1.5">{group}</h3>
              <ul className="rounded-[14px] bg-base-200 overflow-hidden">
                {CATEGORIES.filter(c => c.group === group).map(c => (
                  <li key={c.id} className="group">
                    <a href={`#/settings?s=${c.id}`} className="flex items-center gap-3 pl-3 active:bg-base-300/60">
                      <span className="grid place-items-center size-8 shrink-0 rounded-[9px] bg-base-300">
                        <Icon d={c.icon} className="size-[18px]" />
                      </span>
                      {/* The separator starts after the icon, as in a native list. */}
                      <span className="flex-1 flex items-center gap-3 min-h-14 pr-3 border-base-300 group-not-first:border-t">
                        <span className="flex-1 min-w-0 py-2.5">
                          <span className="block text-[15px] font-medium leading-snug">{c.name}</span>
                          {summary[c.id] && (
                            <span className="block truncate text-[12.5px] text-base-content/50 mt-0.5">{summary[c.id]}</span>
                          )}
                        </span>
                        <Icon d="M9 6l6 6-6 6" className="size-4 text-base-content/35" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-6">
        {/* Back to the list; opened straight from a link, there is no list behind it. */}
        <PageHeader
          title={open.name}
          status="Settings"
          onBack={() => (history.length > 1 ? history.back() : (location.hash = '#/settings'))}
        />
        {open.page(props)}
      </div>
    )
  }

  function pick(id: string) {
    setPicked(id)
    replaceParams('settings', { s: id })
  }

  return (
    <>
    <PageHeader title="Settings" onBack={goBack} />
    <div className="grid grid-cols-[14.75rem_minmax(0,40rem)] gap-10 items-start">
      <nav aria-label="Settings" className="sticky top-28 flex flex-col">
        {GROUPS.map(group => (
          <div key={group} className="flex flex-col gap-0.5 pb-3">
            <h3 className="text-xs font-semibold text-base-content/45 px-3 pt-2 pb-1.5">{group}</h3>
            {CATEGORIES.filter(c => c.group === group).map(c => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                aria-current={c === open ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-left transition-colors ${
                  c === open ? 'bg-primary/18 text-primary' : 'text-base-content/75 hover:bg-base-200 hover:text-base-content'
                }`}
              >
                <Icon d={c.icon} className="size-[18px] opacity-80" />
                <span className="flex-1">{c.name}</span>
                {flagged.has(c.id) && (
                  <span className="size-2 rounded-full bg-warning" title={problems.find(p => p.category === c.id)!.title}>
                    <span className="sr-only">Needs attention</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div key={open!.id} className="flex flex-col gap-6 min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">{open!.name}</h2>
        {open!.page(props)}
      </div>
    </div>
    </>
  )
}
