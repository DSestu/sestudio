import type { DownloadJob } from '../api'
import DownloadQueue from '../components/DownloadQueue'
import EmptyState from '../components/EmptyState'
import { clearDeviceDownloads, useDeviceDownloads } from '../deviceDownloads'
import type { View } from '../nav'

interface Props {
  jobs: DownloadJob[]
  onCancel: (id: string) => void
  onClearHistory: () => void
  onNavigate: (v: View) => void
}

export default function DownloadsView({ jobs, onCancel, onClearHistory, onNavigate }: Props) {
  const deviceDownloads = useDeviceDownloads()

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold tracking-tight">Downloads</h2>
      {!jobs.length && !deviceDownloads.length ? (
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
  )
}
