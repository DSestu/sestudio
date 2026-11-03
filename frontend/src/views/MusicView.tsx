import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'

export default function MusicView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Music" />
      <EmptyState title="Music" message="Your music will appear here." />
    </div>
  )
}
