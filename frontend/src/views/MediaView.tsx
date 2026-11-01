import { useRef, useState, type ReactNode } from 'react'
import type { DownloadJob } from '../api'
import DownloadQueue from '../components/DownloadQueue'
import EmptyState from '../components/EmptyState'
import { clearDeviceDownloads, useDeviceDownloads } from '../deviceDownloads'
import { currentParams, patchParams, type View } from '../nav'

const TABS = [
  { id: 'collection', label: 'Collection' },
  { id: 'queue', label: 'Queue' },
] as const
type MediaTab = (typeof TABS)[number]['id']

interface Props {
  jobs: DownloadJob[]
  /** Jobs still running: opens the Queue tab, and its badge. */
  activeCount: number
  onCancel: (id: string) => void
  onClearHistory: () => void
  onNavigate: (v: View) => void
  /** What the finished jobs became: the downloaded-files listing. */
  downloadedLibrary: ReactNode
}

/** What is on disk (Collection) and what is on its way there (Queue). */
export default function MediaView({
  jobs, activeCount, onCancel, onClearHistory, onNavigate, downloadedLibrary,
}: Props) {
  const deviceDownloads = useDeviceDownloads()
  // Kept in the URL, so browser-back from a title reopens the tab it left.
  // Without one, a running download is the likelier reason to come here.
  const [tab, setTab] = useState<MediaTab>(
    () => TABS.find(t => t.id === currentParams().get('tab'))?.id
      ?? (activeCount > 0 ? 'queue' : 'collection'),
  )
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function changeTab(next: MediaTab) {
    setTab(next)
    patchParams({ tab: next })
  }

  /** Arrow keys move between tabs, as the tablist role promises. */
  function onTabKey(e: React.KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + TABS.length) % TABS.length
    changeTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold tracking-tight">Media</h2>

      <div role="tablist" aria-label="Media" className="tabs tabs-box w-full sm:w-fit">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[i] = el }}
            role="tab"
            id={`media-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`media-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => changeTab(t.id)}
            onKeyDown={e => onTabKey(e, i)}
            className={`tab flex-1 sm:flex-none gap-2 ${tab === t.id ? 'tab-active' : ''}`}
          >
            {t.label}
            {/* Collection counts itself in its toolbar; Queue shows the same
                number as the nav badge that brought you here. */}
            {t.id === 'queue' && activeCount > 0 && (
              <span className="badge badge-primary badge-sm">{activeCount}</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`media-panel-${tab}`} aria-labelledby={`media-tab-${tab}`}>
        {tab === 'collection' ? (
          downloadedLibrary
        ) : !jobs.length && !deviceDownloads.length ? (
          <EmptyState
            title="No downloads yet"
            message="Pick a season or episode and choose “Download” — progress shows up here, whether it lands on the server or on this device."
            action={{ label: 'Search', onClick: () => onNavigate('search') }}
          />
        ) : (
          <DownloadQueue
            jobs={jobs}
            deviceDownloads={deviceDownloads}
            onCancel={onCancel}
            onClearHistory={() => { onClearHistory(); clearDeviceDownloads() }}
          />
        )}
      </div>
    </div>
  )
}
