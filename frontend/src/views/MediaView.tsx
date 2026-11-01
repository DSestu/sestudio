import { useState, type ReactNode } from 'react'
import type { DownloadJob } from '../api'
import DownloadQueue from '../components/DownloadQueue'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
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

  function changeTab(next: MediaTab) {
    setTab(next)
    patchParams({ tab: next })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* The page name and its tabs live in the top card. */}
      <PageHeader
        title="Media"
        status={activeCount > 0
          ? <><em className="not-italic text-primary font-semibold">{activeCount}</em> downloading</>
          : undefined}
        tabs={TABS.map(t => ({ ...t, count: t.id === 'queue' && activeCount > 0 ? activeCount : undefined }))}
        tab={tab}
        onTab={changeTab}
      />
      <div role="tabpanel" id={`media-panel-${tab}`} aria-label={TABS.find(t => t.id === tab)?.label}>
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
